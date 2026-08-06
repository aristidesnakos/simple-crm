import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Builds an RFC 2822 message and base64url-encodes it, per the Gmail API's
// drafts.create requirements.
function buildRawMessage({
  to,
  subject,
  body,
}: {
  to: string;
  subject: string;
  body: string;
}) {
  const message = [
    `To: ${to}`,
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

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const raw = buildRawMessage({ to, subject, body });
    const draft = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw } },
    });

    const draftId = draft.data.id;
    const messageId = draft.data.message?.id;
    const draftLink = messageId
      ? `https://mail.google.com/mail/u/0/#drafts?compose=${messageId}`
      : undefined;

    if (accountId && draftLink) {
      await prisma.account.update({
        where: { id: accountId },
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
