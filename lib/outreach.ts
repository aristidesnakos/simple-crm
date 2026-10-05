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
// sits above the whole app rather than inside it: `Mangood` and `MichiKanji — Shodo
// Schools` are two projects with one sender between them, so a per-project column would
// store the same value twice with nowhere single to change it.
//
// Note this survived docs/ROADMAP.md D22 collapsing Project from campaign to business —
// it makes the argument stronger, not weaker. A business is still not a legal entity: one
// company sends for several of its own products. See
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
  if (!/[^\x00-\x7F]/.test(subject)) return subject;
  return `=?utf-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

// The whole outbound text: what the operator wrote, then the footer. The single chokepoint
// for BOTH transports — the Gmail draft route and the Resend send route each call this and
// nothing else, so a third send path cannot forget the footer by building its own string.
// It used to live inside buildRawMessage, which was the chokepoint while Gmail was the only
// way out (docs/ROADMAP.md D23).
//
// trimEnd so a body that happens to end in newlines doesn't push the footer several blank
// lines away from the sign-off.
export function buildMessageText(body: string, identity: SenderIdentity): string {
  return `${body.trimEnd()}\n\n${buildFooter(identity)}`;
}

// --- Resend sends (D23) -------------------------------------------------------------
//
// Everything below is pure and safe to import from a client component, which is the
// point: the invite dialog previews with exactly the functions the server sends with.

// `Ari <ari@mail.mangood.app>`. Quoted only when the name needs it: a comma or a period in
// a bare display name is parsed as a second address, but a plain "Ari" reads better without
// quotes, in the header and in the UI that shows this same string. Null when there is no
// address at all — the caller refuses to send rather than letting a provider pick a default.
export function formatFrom(project: {
  fromEmail: string | null;
  fromName: string | null;
}): string | null {
  if (!project.fromEmail) return null;
  const name = project.fromName?.trim();
  if (!name) return project.fromEmail;
  // RFC 5322 atext plus spaces between words — anything else must be a quoted string.
  const plain = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+( [A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/;
  const display = plain.test(name) ? name : `"${name.replace(/["\\]/g, "\\$&")}"`;
  return `${display} <${project.fromEmail}>`;
}

// The first word of the contact's name, for `{{firstName}}`. Null when the name is unusable
// as a salutation — an address pasted into the name field, or nothing at all — so the
// template falls back to a neutral greeting instead of "Hi jamie@example.com".
export function firstNameOf(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  if (!first || first.includes("@")) return null;
  return first;
}

export const TEMPLATE_FALLBACK_NAME = "there";

// Fills `{{firstName}}` and `{{name}}`. Anything else in double braces is left in place on
// purpose, so unresolvedPlaceholders can refuse it: a typo like `{{fistName}}` must stop
// the send, not go out literally to every recipient.
export function renderTemplate(
  template: string,
  contact: { name: string }
): string {
  const first = firstNameOf(contact.name) ?? TEMPLATE_FALLBACK_NAME;
  return template
    .replace(/\{\{\s*firstName\s*\}\}/g, first)
    .replace(/\{\{\s*name\s*\}\}/g, contact.name.trim() || TEMPLATE_FALLBACK_NAME);
}

export function unresolvedPlaceholders(text: string): string[] {
  return Array.from(new Set(text.match(/\{\{[^}]*\}\}/g) ?? []));
}

// "Re: <subject>", without stacking "Re: Re: Re:".
export function replySubject(subject: string | null | undefined): string {
  const s = subject?.trim() || "";
  return /^re:/i.test(s) ? s : `Re: ${s}`.trim();
}

// Received mail sometimes has no text part. A crude strip is enough: this is read by the
// operator in a <pre>, never rendered as HTML, and never passed to the compose model.
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Does this reply ask us to stop? The footer tells people to reply with the word "stop",
// and every Resend send carries a `List-Unsubscribe: <mailto:…?subject=unsubscribe>`
// header, so both arrive here as ordinary inbound mail.
//
// Deliberately strict — the subject, or the first line of the reply above any quoted text,
// must BE the request, not merely contain it. "Don't stop sending these!" is not an
// opt-out. A false positive suppresses someone who didn't ask, which is the safe direction
// and is visible on the contact; a false negative is still caught by the operator reading
// the reply, exactly as it was before replies came into the CRM at all.
const OPT_OUT_PHRASES = new Set([
  "stop",
  "unsubscribe",
  "please stop",
  "stop please",
  "remove me",
  "unsubscribe me",
  "please unsubscribe",
  "please remove me",
]);

function asOptOutPhrase(line: string): boolean {
  return OPT_OUT_PHRASES.has(
    line
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function isOptOutReply(subject: string | null, text: string | null): boolean {
  if (subject && asOptOutPhrase(subject.replace(/^\s*(re|fwd?):\s*/i, ""))) {
    return true;
  }
  if (!text) return false;
  // Only what they wrote, not what they quoted: stop at the first quoted line or the
  // "On <date>, <name> wrote:" attribution most clients put above it.
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*>/.test(line) || /^On .+wrote:\s*$/.test(line.trim())) break;
    if (line.trim()) lines.push(line);
  }
  return lines.length > 0 && asOptOutPhrase(lines[0]);
}
