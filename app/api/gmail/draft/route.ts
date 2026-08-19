import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Builds an RFC 2822 message and base64url-encodes it, per the Gmail API's
// drafts.create requirements.
function buildRawMessage({
  to,
  from,
  subject,
  body,
}: {
  to: string;
  // The campaign's sending identity (Project.fromEmail). Omitted when the project has
  // none, in which case Gmail uses the mailbox default — so a project configured before
  // its Workspace alias is verified degrades to current behavior instead of failing.
  // Gmail rejects a From that isn't a verified sendAs alias on the account.
  from?: string | null;
  subject: string;
  body: string;
}) {
  const message = [
    `To: ${to}`,
    ...(from ? [`From: ${from}`] : []),
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
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

  const { accountId, to, subject, body } = await request.json();
  if (!to || !subject || !body) {
    return NextResponse.json(
      { error: "to, subject, and body are required" },
      { status: 400 }
    );
  }

  // Loaded before the Gmail call so the campaign's sending identity can go on the
  // message. Also gives the write-back a validated id.
  const account = accountId
    ? await prisma.account.findUnique({
        where: { id: accountId },
        include: { project: { select: { fromEmail: true } } },
      })
    : null;

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const raw = buildRawMessage({
      to,
      from: account?.project.fromEmail,
      subject,
      body,
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

    if (account && draftLink) {
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
