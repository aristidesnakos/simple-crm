import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/contacts";
import { CONSENT_FIRST_JURISDICTIONS } from "@/lib/types";
import {
  buildFooter,
  encodeSubject,
  resolveSenderIdentity,
  senderIdentityProblem,
  type SenderIdentity,
} from "@/lib/outreach";

// Builds an RFC 2822 message and base64url-encodes it, per the Gmail API's
// drafts.create requirements.
function buildRawMessage({
  to,
  from,
  subject,
  body,
  identity,
}: {
  to: string;
  // The campaign's sending identity (Project.fromEmail). Omitted when the project has
  // none, in which case Gmail uses the mailbox default — so a project configured before
  // its Workspace alias is verified degrades to current behavior instead of failing.
  // Gmail rejects a From that isn't a verified sendAs alias on the account.
  from?: string | null;
  subject: string;
  body: string;
  // Who is legally sending. The footer is appended HERE rather than in the route body,
  // because this function is the single chokepoint every outbound message passes through
  // — including any future POST /api/gmail/send. Putting it in the route would leave the
  // next send path uncovered.
  //
  // And not in the compose system prompt: a model given a formatting instruction complies
  // most of the time, which is the wrong reliability class for a statutory disclosure, and
  // it would paraphrase the address. A paraphrased postal address is not a postal address.
  identity: SenderIdentity;
}) {
  const message = [
    `To: ${to}`,
    ...(from ? [`From: ${from}`] : []),
    // Encoded rather than interpolated raw: headers must be ASCII, and the default
    // composed subject contains an em dash. See lib/outreach.ts.
    `Subject: ${encodeSubject(subject)}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
    "",
    buildFooter(identity),
  ].join("\n");

  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function POST(request: NextRequest) {
  const session = await auth();
  const accessToken = (session as unknown as { accessToken?: string })
    ?.accessToken;
  // Captured here rather than at the call site: the accessToken cast leaves `session`
  // un-narrowed, so TypeScript can't see that the guard below proves it non-null.
  const senderEmail = session?.user?.email ?? null;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not signed in with Google, or Gmail access wasn't granted." },
      { status: 401 }
    );
  }

  // Guarded, matching POST /api/compose's idiom. Previously unguarded, which meant a
  // malformed body threw and returned Next's HTML error page — and the client's
  // res.json() then threw in turn, so the operator saw nothing at all.
  let payload: {
    accountId?: string;
    to?: string;
    subject?: string;
    body?: string;
    acknowledgeJurisdiction?: boolean;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const { accountId, to, subject, body } = payload;
  if (!to || !subject || !body) {
    return NextResponse.json(
      { error: "to, subject, and body are required" },
      { status: 400 }
    );
  }

  // accountId is REQUIRED, where it used to be optional. The old conditional lookup meant
  // a request that simply omitted it got a draft with no From header, no write-back, and —
  // under the gates below — no compliance checks at all. That is a bypass, not an edge
  // case. The only caller always sends it, so this breaks nothing.
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId is required" },
      { status: 400 }
    );
  }

  // Loaded before the Gmail call so the campaign's sending identity can go on the
  // message, and so the gates below have something to read. Also gives the write-back a
  // validated id.
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
      jurisdiction: true,
      consentedAt: true,
      project: { select: { fromEmail: true } },
    },
  });
  if (!account) {
    return NextResponse.json({ error: "No such contact." }, { status: 404 });
  }

  // Suppression first, and with no override parameter. A request reaching this branch is
  // asking the application to contact someone who told us to stop; there is no argument
  // the caller could pass that makes that acceptable, so there is no argument to pass.
  // Deliberately asymmetric with the jurisdiction gate below.
  //
  // Keyed on the recipient address rather than on the account row, so an opt-out recorded
  // against this person in ANY project blocks this draft too. Normalized the same way it
  // was on the way in — a lookup on the raw `to` would miss a suppression stored
  // lowercase, which is every suppression. And on `to` rather than account.email, because
  // `to` is what actually goes in the header: gating on anything else leaves a hole.
  const suppressed = await prisma.suppression.findUnique({
    where: { email: normalizeEmail(to) ?? "" },
  });
  if (suppressed) {
    return NextResponse.json(
      {
        error:
          `${account.name} opted out on ` +
          `${suppressed.optedOutAt.toISOString().slice(0, 10)}. No draft was created.`,
      },
      { status: 409 }
    );
  }

  // Jurisdiction gate. Unlike suppression this is an "are you sure" and not a "no":
  // consent-first is a rule about unsolicited FIRST contact, and the operator may hold a
  // basis the database doesn't know about. The acknowledgement is per-request and is never
  // written to the row — a persisted acknowledgement is a permission, and this deliberately
  // is not one. Same reasoning as CRM_I_KNOW_THE_API_IS_UNAUTHENTICATED in proxy.ts: make
  // the override loud, and make it cost something every time.
  const consentFirst = (CONSENT_FIRST_JURISDICTIONS as readonly string[]).includes(
    account.jurisdiction ?? ""
  );
  if (consentFirst && !account.consentedAt && payload.acknowledgeJurisdiction !== true) {
    return NextResponse.json(
      {
        error:
          `${account.name} is recorded in ${account.jurisdiction}, where a first ` +
          `unsolicited email needs consent, and no consent date is on file. Record ` +
          `consent on the contact, or confirm you have a basis for this send.`,
        // The discriminator that lets the client tell an overridable 409 from an absolute
        // one without string-matching the message. Absent on the suppression refusal.
        requiresAcknowledgement: true,
      },
      { status: 409 }
    );
  }

  // Fail closed, before any Gmail call. A footer that silently omits itself is worse than
  // no footer, because the message looks compliant. 500 rather than 400 is right: the
  // caller did nothing wrong, the deployment is misconfigured — the same shape as the 501
  // POST /api/compose returns for a missing OPENROUTER_API_KEY.
  const identity = resolveSenderIdentity();
  const identityProblem = senderIdentityProblem(identity);
  if (identityProblem) {
    return NextResponse.json({ error: identityProblem }, { status: 500 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const raw = buildRawMessage({
      to,
      from: account.project.fromEmail,
      subject,
      body,
      identity,
    });
    const draft = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw } },
    });

    const draftId = draft.data.id;
    const messageId = draft.data.message?.id;

    // Addressing the mailbox by email rather than by index. `u/0` is whichever Google
    // account was signed in first, so the link opened the wrong mailbox — or a
    // "no such account" page — as soon as a second account was signed in, which the
    // Workspace tenant guarantees. Gmail resolves `u/<address>` to the right index.
    const mailboxPath = senderEmail ? encodeURIComponent(senderEmail) : "0";
    const draftLink = messageId
      ? `https://mail.google.com/mail/u/${mailboxPath}/#drafts?compose=${messageId}`
      : undefined;

    if (draftLink) {
      await prisma.account.update({
        where: { id: account.id },
        data: { draftLink },
      });
    }

    return NextResponse.json({ draftId, draftLink });
  } catch (err) {
    console.error("Gmail draft creation failed", err);
    return NextResponse.json(
      { error: "Gmail API request failed. Check console for details." },
      { status: 502 }
    );
  }
}
