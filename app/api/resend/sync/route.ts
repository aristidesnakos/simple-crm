import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { statusAfterReply } from "@/lib/contacts";
import { htmlToText, isOptOutReply } from "@/lib/outreach";
import {
  bareAddress,
  domainOf,
  RESEND_KEY_MISSING,
  resendClient,
  sleep,
} from "@/lib/resend";
import { DELIVERY_PROBLEMS, type Account } from "@/lib/types";

// POST /api/resend/sync — pull replies and delivery results back from Resend
// (docs/ROADMAP.md D23).
//
// Polling, not a webhook, on purpose. A webhook needs a public URL, and this app answers
// only on localhost (proxy.ts); Resend stores received mail whether or not a webhook
// exists, and lists it at GET /emails/receiving. So the operator presses "Check replies"
// and this does three things, in this order:
//
//   1. Refreshes outbound delivery status (delivered / bounced / …) and fills in each sent
//      message's RFC Message-ID, which the send response does not include. First, because
//      step 2 matches replies on it.
//   2. Imports new received mail for every business with sendVia "resend": matched to a
//      contact by sender address, or failing that by In-Reply-To/References, stored as an
//      inbound Interaction, and moves the contact forward (Emailed → Replied) and to the
//      top of /queue — a reply is the most overdue thing there is.
//   3. Records an opt-out when the reply IS one ("stop", or the List-Unsubscribe mailto).
//      This closes docs/requirements/04-COMPLIANCE-REGISTER §7's detection gap for these
//      businesses: the footer's reply-based opt-out now lands somewhere the app can read.
//
// Idempotent: Interaction.externalId is unique, so pressing it twice imports nothing new.
// Mail from an address that matches no contact is reported, not stored — creating
// contacts from inbound mail would let anyone who emails the domain into the CRM.
//
// What this must never do: feed a received body to POST /api/compose. Inbound text is
// written by strangers, and the compose brief is assembled from named fields precisely so
// that nothing like it can leak into a prompt (docs/requirements/04 §5.2, D20).

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
// Under Resend's 10 requests/second, with room for a send in another tab.
const SPACING_MS = 120;
const REFRESH_WINDOW_DAYS = 14;
const UNMATCHED_WINDOW_DAYS = 30;
const SETTLED = new Set<string>([...DELIVERY_PROBLEMS, "delivered"]);

type Unmatched = { from: string | null; subject: string; receivedAt: string };
type Flagged = { accountId: string; name: string; status: string };

export async function POST() {
  const resend = resendClient();
  if (!resend) {
    return NextResponse.json({ error: RESEND_KEY_MISSING }, { status: 501 });
  }

  const projects = await prisma.project.findMany({
    where: { sendVia: "resend", fromEmail: { not: null } },
    select: { id: true, name: true, fromEmail: true },
  });
  const projectByDomain = new Map(
    projects.map((p) => [domainOf(p.fromEmail), p] as const)
  );

  // --- 1. Outbound delivery status -------------------------------------------------
  const deliveryProblems: Flagged[] = [];
  const pending = await prisma.interaction.findMany({
    where: {
      direction: "outbound",
      externalId: { not: null },
      occurredAt: { gte: new Date(Date.now() - REFRESH_WINDOW_DAYS * 86_400_000) },
    },
    select: {
      id: true,
      externalId: true,
      messageId: true,
      deliveryStatus: true,
      account: { select: { id: true, name: true } },
    },
  });
  for (const row of pending) {
    if (row.messageId && SETTLED.has(row.deliveryStatus ?? "")) continue;
    const { data, error } = await resend.emails.get(row.externalId!);
    await sleep(SPACING_MS);
    if (error) {
      if (error.name === "rate_limit_exceeded") break; // next press picks it up
      console.error(`Couldn't refresh ${row.externalId}`, error);
      continue;
    }
    if (
      data.last_event !== row.deliveryStatus &&
      (DELIVERY_PROBLEMS as readonly string[]).includes(data.last_event)
    ) {
      deliveryProblems.push({
        accountId: row.account.id,
        name: row.account.name,
        status: data.last_event,
      });
    }
    await prisma.interaction.update({
      where: { id: row.id },
      data: {
        deliveryStatus: data.last_event,
        messageId: row.messageId ?? (data.message_id || null),
      },
    });
  }

  // --- 2. Received mail --------------------------------------------------------------
  // Newest first. Page backwards until a page contains something already imported — the
  // rest is older than that — or the list runs out.
  type Listed = NonNullable<
    Awaited<ReturnType<typeof resend.emails.receiving.list>>["data"]
  >["data"][number];
  const listed: Listed[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await resend.emails.receiving.list(
      after ? { limit: PAGE_SIZE, after } : { limit: PAGE_SIZE }
    );
    await sleep(SPACING_MS);
    if (error) {
      const restricted = error.name === "restricted_api_key";
      return NextResponse.json(
        {
          error: restricted
            ? "This RESEND_API_KEY can only send. Reading replies needs a Full access key."
            : `Resend refused the replies request: ${error.message}`,
        },
        { status: 502 }
      );
    }
    listed.push(...data.data);
    const seen = await prisma.interaction.count({
      where: { externalId: { in: data.data.map((d) => d.id) } },
    });
    if (seen > 0 || !data.has_more || data.data.length === 0) break;
    after = data.data[data.data.length - 1].id;
  }

  const known = new Set(
    (
      await prisma.interaction.findMany({
        where: { externalId: { in: listed.map((l) => l.id) } },
        select: { externalId: true },
      })
    ).map((i) => i.externalId)
  );
  const fresh = listed
    .filter((l) => !known.has(l.id))
    // Oldest first, so a reply-then-"stop" pair lands in the order it was written.
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  let imported = 0;
  let ignored = 0;
  const unmatched: Unmatched[] = [];
  const optedOut: Flagged[] = [];
  const touched = new Set<string>();

  for (const item of fresh) {
    // Which of our businesses was this sent to? Receiving is catch-all per domain, so the
    // domain is the match, not the exact address. Mail for a domain no resend-project owns
    // (another business on the same Resend team, not yet switched over) is left alone.
    const recipient = item.to.find((t) => projectByDomain.has(domainOf(bareAddress(t))));
    const project = recipient ? projectByDomain.get(domainOf(bareAddress(recipient))) : null;
    if (!project) {
      ignored++;
      continue;
    }

    const full = await resend.emails.receiving.get(item.id);
    await sleep(SPACING_MS);
    if (full.error) {
      // Not stored, so the next press retries it.
      console.error(`Couldn't fetch received email ${item.id}`, full.error);
      continue;
    }
    const mail = full.data;
    const sender = bareAddress(mail.from);
    const subject = mail.subject?.trim() || "(no subject)";
    const receivedAt = new Date(mail.created_at);
    const text = mail.text ?? (mail.html ? htmlToText(mail.html) : "");

    // By sender address first. Failing that, by thread: someone replying from a second
    // address still carries our Message-ID in In-Reply-To/References.
    let account = sender
      ? await prisma.account.findFirst({
          where: { projectId: project.id, email: sender },
        })
      : null;
    if (!account) {
      const threadIds = threadReferences(mail.headers);
      if (threadIds.length) {
        const parent = await prisma.interaction.findFirst({
          where: { messageId: { in: threadIds }, account: { projectId: project.id } },
          select: { account: true },
        });
        account = parent?.account ?? null;
      }
    }
    if (!account) {
      if (Date.now() - receivedAt.getTime() < UNMATCHED_WINDOW_DAYS * 86_400_000) {
        unmatched.push({ from: sender, subject, receivedAt: mail.created_at });
      }
      continue;
    }

    const optOut = isOptOutReply(mail.subject, text);
    const target = account;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.interaction.create({
          data: {
            accountId: target.id,
            channel: "email",
            direction: "inbound",
            occurredAt: receivedAt,
            summary: subject,
            subject,
            body: text,
            externalId: item.id,
            messageId: mail.message_id || null,
            fromAddress: sender,
            toAddress: bareAddress(recipient),
          },
        });

        if (optOut) {
          // The address we SEND to, plus the one they wrote from if it differs. Never
          // overwrites an existing optedOutAt — the first timestamp is the one that
          // matters, same rule as POST /api/suppressions.
          const firstLine = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? subject;
          const note =
            `Recorded automatically from their reply of ` +
            `${receivedAt.toISOString().slice(0, 10)}: "${firstLine.slice(0, 200)}"`;
          for (const email of new Set([target.email, sender].filter(Boolean) as string[])) {
            await tx.suppression.upsert({
              where: { email },
              create: { email, optedOutAt: receivedAt, source: "reply", note },
              update: {},
            });
          }
        }

        const status = statusAfterReply(target.kind, target.status);
        const later =
          !target.lastContact || target.lastContact.getTime() < receivedAt.getTime();
        await tx.account.update({
          where: { id: target.id },
          data: {
            status,
            ...(later && { lastContact: receivedAt }),
            // A reply is owed, as of when it arrived — so /queue counts the wait from
            // there. Not for an opt-out: there is nothing left to owe them.
            ...(!optOut && {
              nextAction: `Reply to "${subject.slice(0, 80)}"`,
              nextActionDue: receivedAt,
            }),
          },
        });
        if (status !== target.status) {
          await tx.statusEvent.create({
            data: { accountId: target.id, fromStatus: target.status, toStatus: status },
          });
        }
      });
    } catch (err) {
      // P2002: a second press running concurrently imported it first. Fine.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      throw err;
    }

    imported++;
    touched.add(target.id);
    if (optOut) {
      optedOut.push({ accountId: target.id, name: target.name, status: "opted out" });
    }
  }

  // Every row this changed, in the client's shape — CrmApp splices these, since nothing
  // refetches after a mutation. optedOutAt is derived here exactly as GET /api/accounts does.
  const rows = await prisma.account.findMany({ where: { id: { in: [...touched] } } });
  const suppressedAt = new Map(
    (
      await prisma.suppression.findMany({
        where: { email: { in: rows.map((r) => r.email).filter(Boolean) as string[] } },
        select: { email: true, optedOutAt: true },
      })
    ).map((s) => [s.email, s.optedOutAt])
  );
  const accounts = rows.map((a) => ({
    ...a,
    optedOutAt: (a.email && suppressedAt.get(a.email)) ?? null,
  })) as unknown as Account[];

  return NextResponse.json({
    imported,
    ignored,
    unmatched,
    optedOut,
    deliveryProblems,
    accounts,
    checkedAt: new Date().toISOString(),
  });
}

// Message-IDs named by In-Reply-To and References. Header names arrive lowercase in
// Resend's examples; matched case-insensitively anyway.
function threadReferences(headers: Record<string, string> | null): string[] {
  if (!headers) return [];
  const values = Object.entries(headers)
    .filter(([k]) => ["in-reply-to", "references"].includes(k.toLowerCase()))
    .map(([, v]) => v);
  return Array.from(new Set(values.join(" ").match(/<[^>]+>/g) ?? []));
}
