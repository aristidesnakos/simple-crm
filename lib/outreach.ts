// Message-domain logic: what goes into an outbound email, as opposed to what we know
// about a contact. lib/contacts.ts is the contact domain and this is deliberately not
// part of it — normalizeEmail and a statutory footer have nothing to say to each other.
//
// Exported rather than inlined into the Gmail route so the composer preview and the
// message that actually gets built cannot drift apart (REQ-06b). One builder, two callers.

// The two values that identify who is sending. Required in every outreach email by
// CAN-SPAM § 7704(a)(5) and CASL s. 6(2)(b), among others.
//
// Configuration and not a column, deliberately. The footer names the LEGAL ENTITY, which
// sits above a campaign: `Mangood — Waitlist` and `Mangood — Partners` are two projects
// with one sender between them, so a per-project column would store the same value twice
// with nowhere single to change it. The tier that would own it correctly is the Product
// tier that docs/ROADMAP.md D16 deliberately does not build. See
// docs/requirements/02-TRD-technical-spec.md §6.1, and doc 01 §10 for the trigger to
// revisit — a second legal entity starting to send.
export type SenderIdentity = {
  legalName: string | null;
  postalAddress: string | null;
};

export function resolveSenderIdentity(): SenderIdentity {
  // `?.trim() ||` and not `??`. An empty string is not null, so `??` would accept a blank
  // line in .env and emit a footer with a gap where the address goes — a message that
  // looks compliant and is not, which is worse than one that obviously failed.
  return {
    legalName: process.env.CRM_SENDER_LEGAL_NAME?.trim() || null,
    postalAddress: process.env.CRM_SENDER_POSTAL_ADDRESS?.trim() || null,
  };
}

// Returns the message naming what is missing, or null when the identity is usable.
// The caller refuses to build a message rather than sending a partial footer.
export function senderIdentityProblem(identity: SenderIdentity): string | null {
  if (!identity.legalName) {
    return (
      "CRM_SENDER_LEGAL_NAME isn't set. Every outreach email has to identify who is " +
      "sending it; add it to .env before drafting."
    );
  }
  if (!identity.postalAddress) {
    return (
      "CRM_SENDER_POSTAL_ADDRESS isn't set. A physical postal address is required in " +
      "every outreach email; add it to .env before drafting."
    );
  }
  return null;
}

// The footer itself. Plain text, no HTML and no links.
//
// `-- ` (dash, dash, space) on its own line is the RFC 3676 signature separator. Every
// serious mail client recognises it and collapses what follows, so the footer reads as a
// signature rather than as boilerplate bolted on.
//
// The opt-out is reply-based. A working return address is a valid internet-based opt-out
// mechanism, and for genuinely 1:1 outreach it is more honest than a tracked link — the
// reply lands in the same inbox the message came from. Note the standing limitation: this
// app holds `gmail.compose` and cannot READ that inbox, so noticing the reply is manual.
// Recorded as an accepted gap in docs/requirements/04-COMPLIANCE-REGISTER §7.
//
// The word "stop" is what OPT_OUT_SOURCES' `reply` is named for. If this wording changes,
// change the register entry with it.
// Trailing whitespace on the body is trimmed by the caller before this is appended:
// a body ending in newlines otherwise pushes the signature several blank lines down,
// which reads as sloppy in the one part of the message that is a legal disclosure.
export function buildFooter(identity: SenderIdentity): string {
  return [
    "-- ",
    identity.legalName,
    identity.postalAddress,
    "",
    'Don’t want to hear from me again? Reply with the word "stop" and I’ll take you off my list.',
  ].join("\n");
}

// RFC 2047 encoded-word for the Subject header.
//
// `buildRawMessage` declares `Content-Type: text/plain; charset=utf-8`, which covers the
// BODY. RFC 2822 headers must be ASCII, so a subject carrying anything else corrupts in
// transit. That is not hypothetical here: account-detail seeds every composed subject as
// `Following up — <project>`, with an em dash, so every draft this app has been capable of
// producing has had a broken subject line.
//
// Applied only when needed, so a plain ASCII subject stays legible in the raw message —
// both for humans reading it and for the VER-06 inspection procedure.
export function encodeSubject(subject: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(subject)) return subject;
  return `=?utf-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}
