import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gmailMailboxPath } from "@/lib/contacts";
import {
  buildMessageText,
  encodeSubject,
  resolveSenderIdentity,
  senderIdentityProblem,
  type SenderIdentity,
} from "@/lib/outreach";
import { jurisdictionRefusal, suppressionRefusal } from "@/lib/outreach-gates";

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
  // Who is legally sending. The footer is appended by buildMessageText in lib/outreach.ts,
  // which is the chokepoint for every transport — this function and the Resend send route
  // both call it, so neither can build a message without the footer.
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
    buildMessageText(body, identity),
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
      project: { select: { name: true, fromEmail: true, sendVia: true } },
    },
  });
  if (!account) {
    return NextResponse.json({ error: "No such contact." }, { status: 404 });
  }

  // A business that sends through Resend has its From on a domain that is not a verified
  // Gmail send-as alias — that is why it sends through Resend. A Gmail draft carrying that
  // From is exactly docs/ROADMAP.md E5: Gmail rewrites or rejects it. And the reply would
  // land in Resend, not in this mailbox, splitting the record D23 puts in the CRM.
  if (account.project.sendVia === "resend") {
    return NextResponse.json(
      {
        error:
          `${account.project.name} sends through Resend, not Gmail drafts. Use Send ` +
          `in the composer.`,
      },
      { status: 409 }
    );
  }

  // Suppression first, then the jurisdiction gate — both in lib/outreach-gates.ts, shared
  // with the Resend send route. Suppression is a "no" with no override parameter; the
  // jurisdiction gate is an "are you sure" carrying requiresAcknowledgement. Gated on `to`
  // rather than account.email, because `to` is what actually goes in the header.
  const refusal =
    (await suppressionRefusal(account.name, to)) ??
    jurisdictionRefusal(account, payload.acknowledgeJurisdiction === true);
  if (refusal) {
    const { status, error, ...rest } = refusal;
    return NextResponse.json(
      {
        error: rest.requiresAcknowledgement ? error : `${error} No draft was created.`,
        ...rest,
      },
      { status }
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

    // Addressing the mailbox by email rather than by index — see gmailMailboxPath in
    // lib/contacts.ts for why `u/0` is wrong. Shared with the conversation deep link in
    // account-detail so the two cannot drift onto different mailboxes.
    const mailboxPath = gmailMailboxPath(senderEmail);
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
