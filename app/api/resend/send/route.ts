import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FOLLOW_UP_DAYS, statusAfterSend } from "@/lib/contacts";
import {
  buildMessageText,
  formatFrom,
  replySubject,
  resolveSenderIdentity,
  senderIdentityProblem,
} from "@/lib/outreach";
import { jurisdictionRefusal, suppressionRefusal } from "@/lib/outreach-gates";
import {
  isFatalResendError,
  listUnsubscribeHeader,
  RESEND_KEY_MISSING,
  resendClient,
  sleep,
} from "@/lib/resend";
import type { Account } from "@/lib/types";

// POST /api/resend/send — send email from the CRM, for businesses with sendVia "resend"
// (docs/ROADMAP.md D23). One route for the single composer send and the waitlist invite
// batch: the batch is just a longer list, so the two cannot drift onto different gates.
//
// Unlike POST /api/gmail/draft this SENDS. There is no draft and no second human step in
// Gmail, so the review step is the composer / invite preview, and the client confirms
// before calling this. What the client previewed is what arrives here: templates are
// rendered client-side, and the server adds only the footer — the same footer the preview
// shows, from the same function.
//
// The recipient is NOT a request field. It is read from the account row, so the address
// the gates check and the address the mail goes to are the same value by construction.
//
// Messages go one at a time rather than through /emails/batch: batch is all-or-nothing on
// validation, and per-recipient results are what the operator needs when one address in
// nine is bad. Nine sequential calls sit well under Resend's 10 requests/second.

type SendItem = {
  accountId?: unknown;
  subject?: unknown;
  body?: unknown;
  acknowledgeJurisdiction?: unknown;
  // An inbound Interaction id. The server looks up its Message-ID itself rather than
  // accepting header values from the client.
  inReplyTo?: unknown;
};

type SendResult =
  | { accountId: string; ok: true; account: Account; warning?: string }
  | {
      accountId: string;
      ok: false;
      error: string;
      requiresAcknowledgement?: true;
    };

const MAX_PER_REQUEST = 100;

export async function POST(request: NextRequest) {
  let payload: { sends?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const sends = payload.sends;
  if (!Array.isArray(sends) || sends.length === 0) {
    return NextResponse.json(
      { error: "sends must be a non-empty list." },
      { status: 400 }
    );
  }
  if (sends.length > MAX_PER_REQUEST) {
    return NextResponse.json(
      { error: `At most ${MAX_PER_REQUEST} messages per request.` },
      { status: 400 }
    );
  }
  for (const item of sends as SendItem[]) {
    if (
      typeof item?.accountId !== "string" ||
      typeof item.subject !== "string" ||
      !item.subject.trim() ||
      typeof item.body !== "string" ||
      !item.body.trim()
    ) {
      return NextResponse.json(
        { error: "Every message needs an accountId, a subject, and a body." },
        { status: 400 }
      );
    }
  }

  // Configuration failures first, before any per-recipient work: these are the same answer
  // for every message, so they are request-level errors rather than nine identical rows.
  const resend = resendClient();
  if (!resend) {
    return NextResponse.json({ error: RESEND_KEY_MISSING }, { status: 501 });
  }
  // Fail closed. 500 rather than 400 is right: the caller did nothing wrong, the
  // deployment is misconfigured — same as the Gmail route.
  const identity = resolveSenderIdentity();
  const identityProblem = senderIdentityProblem(identity);
  if (identityProblem) {
    return NextResponse.json({ error: identityProblem }, { status: 500 });
  }

  const items = sends as SendItem[];
  const accounts = await prisma.account.findMany({
    where: { id: { in: items.map((i) => i.accountId as string) } },
    include: {
      project: {
        select: { name: true, fromEmail: true, fromName: true, sendVia: true },
      },
    },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const results: SendResult[] = [];
  let fatal: string | null = null;

  for (const item of items) {
    const accountId = item.accountId as string;
    const subject = (item.subject as string).trim();
    const fail = (error: string, extra?: { requiresAcknowledgement: true }) =>
      results.push({ accountId, ok: false, error, ...extra });

    // Once Resend has said "no" for a reason that applies to every message — a bad key,
    // an unverified domain, a spent quota — the rest of the list gets that answer without
    // another call.
    if (fatal) {
      fail(fatal);
      continue;
    }

    const account = byId.get(accountId);
    if (!account) {
      fail("No such contact.");
      continue;
    }
    if (account.project.sendVia !== "resend") {
      fail(
        `${account.project.name} sends through Gmail drafts, not Resend. Use Create ` +
          `Gmail draft instead.`
      );
      continue;
    }
    const from = formatFrom(account.project);
    if (!from || !account.project.fromEmail) {
      fail(
        `${account.project.name} has no Send-from address. Set one in the project's ` +
          `settings.`
      );
      continue;
    }
    if (!account.email) {
      fail(`${account.name} has no email address on file.`);
      continue;
    }

    const refusal =
      (await suppressionRefusal(account.name, account.email)) ??
      jurisdictionRefusal(account, item.acknowledgeJurisdiction === true);
    if (refusal) {
      if (refusal.requiresAcknowledgement) {
        fail(refusal.error, { requiresAcknowledgement: true });
      } else {
        fail(`${refusal.error} Nothing was sent.`);
      }
      continue;
    }

    // Threading. In-Reply-To + References is what makes the recipient's client file this
    // under their own message rather than starting a new conversation.
    const headers: Record<string, string> = {
      "List-Unsubscribe": listUnsubscribeHeader(account.project.fromEmail),
    };
    let finalSubject = subject;
    if (typeof item.inReplyTo === "string") {
      const parent = await prisma.interaction.findFirst({
        where: { id: item.inReplyTo, accountId: account.id },
        select: { messageId: true, subject: true },
      });
      if (parent?.messageId) {
        headers["In-Reply-To"] = parent.messageId;
        headers["References"] = parent.messageId;
        // The composer pre-fills "Re: …", but an edited subject still has to read as a
        // reply or Gmail starts a new thread regardless of the headers.
        if (!/^re:/i.test(finalSubject)) finalSubject = replySubject(parent.subject);
      }
    }

    const text = buildMessageText(item.body as string, identity);

    // Idempotency keyed on WHO and WHAT, not on the click: the same text to the same person
    // within Resend's 24-hour window is returned from cache instead of sent twice — a
    // double-click, a retry after a lost response, or the invite dialog reopened and
    // re-sent all collapse to one email. Different text is a different key, so a
    // deliberate correction still goes out.
    const idempotencyKey = `crm-${account.id}-${createHash("sha256")
      .update(`${account.email}\n${finalSubject}\n${text}`)
      .digest("hex")
      .slice(0, 40)}`;

    const send = () =>
      resend.emails.send(
        {
          from,
          to: account.email!,
          subject: finalSubject,
          text,
          headers,
          // Shows up in the Resend dashboard, so an email there can be traced to a row here.
          tags: [{ name: "account_id", value: account.id }],
        },
        { idempotencyKey }
      );

    let sent = await send();
    // One polite retry for the two transient refusals. Anything else is reported as-is.
    if (
      sent.error &&
      (sent.error.name === "rate_limit_exceeded" ||
        sent.error.name === "concurrent_idempotent_requests")
    ) {
      await sleep(1100);
      sent = await send();
    }

    if (sent.error || !sent.data) {
      const message = sent.error?.message ?? "Resend returned no id.";
      console.error(`Resend send failed for ${account.id}`, sent.error);
      if (sent.error && isFatalResendError(sent.error)) {
        fatal = `Resend refused: ${message}`;
        fail(fatal);
      } else if (sent.error?.name === "invalid_idempotent_request") {
        fail(
          "A different version of this message was already sent to them in the last " +
            "24 hours. Check the conversation before sending again."
        );
      } else {
        fail(`Resend refused: ${message}`);
      }
      continue;
    }

    // From here the email HAS gone. Every failure below is a failure to record it, and must
    // be reported as a sent message with a warning — never as "not sent", which would
    // invite the operator to send it again.
    const now = new Date();
    try {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.interaction.create({
          data: {
            accountId: account.id,
            channel: "email",
            direction: "outbound",
            occurredAt: now,
            summary: finalSubject,
            subject: finalSubject,
            body: text,
            externalId: sent.data!.id,
            fromAddress: account.project.fromEmail,
            toAddress: account.email,
            deliveryStatus: "sent",
          },
        });

        const status = statusAfterSend(account.kind, account.status);
        // A follow-up date only replaces one that is missing or already past: an operator
        // who scheduled something specific keeps it.
        const owesFollowUp =
          !account.nextActionDue || account.nextActionDue.getTime() <= now.getTime();
        const row = await tx.account.update({
          where: { id: account.id },
          data: {
            lastContact: now,
            status,
            ...(owesFollowUp && {
              nextAction: "Follow up if no reply",
              nextActionDue: new Date(now.getTime() + FOLLOW_UP_DAYS * 86_400_000),
            }),
          },
        });
        // Same append-only log the accounts PATCH writes, in the same transaction, for the
        // same reason: a status change that isn't recorded is history nothing can rebuild.
        if (status !== account.status) {
          await tx.statusEvent.create({
            data: { accountId: account.id, fromStatus: account.status, toStatus: status },
          });
        }
        return row;
      });
      results.push({
        accountId,
        ok: true,
        // Suppression is checked above, so this row is by definition not opted out.
        account: { ...serialize(updated), optedOutAt: null },
      });
    } catch (err) {
      // P2002 on externalId: Resend answered from its idempotency cache with an id we have
      // already recorded. The email went once, and the record exists — that is success.
      const duplicate =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!duplicate) console.error(`Sent ${sent.data.id} but could not record it`, err);
      const row = await prisma.account.findUnique({ where: { id: account.id } });
      results.push({
        accountId,
        ok: true,
        // `project: undefined` drops the included relation, which the client type lacks.
        account: { ...serialize(row ?? { ...account, project: undefined }), optedOutAt: null },
        warning: duplicate
          ? "Already sent — this exact message went to them earlier today."
          : "Sent, but the CRM couldn't record it. Check the Resend dashboard before " +
            "sending again.",
      });
    }
  }

  return NextResponse.json({ results });
}

// Prisma rows carry Date objects; the client type carries strings. JSON would do this on
// the way out anyway — this only makes the type honest.
function serialize<T extends object>(row: T): Omit<Account, "optedOutAt"> {
  return JSON.parse(JSON.stringify(row));
}
