import {
  DEFAULT_KIND,
  JURISDICTIONS,
  OPT_OUT_SOURCES,
  SOURCE_TYPES,
  STATUS_OPTIONS_BY_KIND,
} from "@/lib/types";

// Contact-domain logic. lib/types.ts holds the shape and the vocabularies; this holds
// the behavior. Kept out of lib/utils.ts, which is the stock shadcn `cn` and nothing
// else — mixing domain rules into it would make that file a junk drawer.

// Addresses arrive from CSV exports, pasted sheets, and a free-text input, so casing
// and stray whitespace are the norm rather than the exception. The `|| null` also
// stops an empty input from persisting "" — which is not null, so it defeats every
// "has no email" check while looking identical in the UI.
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase() || null;
}

// Falls back to the default kind's list rather than returning empty: an unrecognized
// kind should still render a usable picker, since nothing validates kind server-side.
export function statusOptionsFor(kind: string | null | undefined): readonly string[] {
  return (
    STATUS_OPTIONS_BY_KIND[kind ?? ""] ?? STATUS_OPTIONS_BY_KIND[DEFAULT_KIND]
  );
}

// The first status a new contact should hold, which differs per pipeline. The schema
// default is "Prospect" for both because a column default cannot branch; every write
// path through the API sets this explicitly instead.
export function defaultStatusFor(kind: string | null | undefined): string {
  return statusOptionsFor(kind)[0];
}

// --- RS-01 compliance validation ---------------------------------------------------
//
// Narrow by design. docs/ROADMAP.md parks broad request validation ("zod, 500→400 …
// Never, absent a forcing function") and this is that forcing function, scoped to the
// fields where a bad value has a LEGAL consequence rather than a cosmetic one. Every
// other column in this schema stays unvalidated free text (defect E7), on purpose.
//
// The value of validating `jurisdiction` in particular: it gates the consent-first
// refusal in app/api/gmail/draft/route.ts. A typo like "eu" falls outside
// CONSENT_FIRST_JURISDICTIONS, silently disabling that gate for one contact, with
// nothing visible in the UI or the logs. A 400 is cheap; a silent hole is not.
//
// Each helper returns a message written for a toast, or null when the value passes.

// `undefined` always passes: a PATCH that doesn't mention a field isn't setting it, and
// null is a legitimate way to clear one.
function validateVocabulary(
  field: string,
  value: unknown,
  allowed: readonly string[]
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && allowed.includes(value)) return null;
  return `${field} must be one of: ${allowed.join(", ")}.`;
}

// Dates cross JSON as strings, and `new Date("nonsense")` yields an Invalid Date that
// Prisma will happily persist — the same class of defect docs/ROADMAP.md notes for
// lastContact. Here it matters more: a contact whose consentedAt is Invalid Date reads
// as "consent on file" to the jurisdiction gate.
function validateDate(field: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") {
    return `${field} isn't a valid date.`;
  }
  return Number.isNaN(new Date(value).getTime())
    ? `${field} isn't a valid date.`
    : null;
}

// The Account fields that carry legal meaning, checked identically on POST and PATCH.
// Returns the FIRST problem rather than collecting them: there is one operator and one
// toast, and a list of three errors is not more actionable than the first one.
export function validateComplianceFields(
  body: Record<string, unknown>
): string | null {
  return (
    validateVocabulary("jurisdiction", body.jurisdiction, JURISDICTIONS) ??
    validateVocabulary("sourceType", body.sourceType, SOURCE_TYPES) ??
    validateDate("consentedAt", body.consentedAt)
  );
}

// The Suppression fields, for POST /api/suppressions. Separate from the above because
// suppression is a different table on a different route — see docs/requirements/02-TRD
// §2.0 for why it is not a column on Account.
export function validateSuppressionFields(
  body: Record<string, unknown>
): string | null {
  return (
    validateVocabulary("source", body.source, OPT_OUT_SOURCES) ??
    validateDate("optedOutAt", body.optedOutAt)
  );
}

// --- Gmail deep links ---------------------------------------------------------------
//
// Both of these build a URL and nothing else: no fetch, no OAuth scope, no stored mail.
// That is the whole point — see docs/ROADMAP.md D21. Reply VISIBILITY inside the CRM
// was chosen over reply INDEXING, because indexing needs `gmail.readonly` (a Google
// *restricted* scope, and therefore a CASA review unless the OAuth client is Internal to
// the Workspace tenant), a sync route, and a local message index. Gmail is already the
// client the mail is read and sent in (D1/D11), so one click into it buys the same
// visibility for none of that cost.
//
// The accepted cost, recorded here so it is not rediscovered as a bug: this yields no
// reply counts, no "who replied" column in /queue, and no response-time statistics.
// Anyone reaching for a fetch here is re-opening D21, not fixing an oversight.

// Gmail addresses a mailbox either by index (`u/0`) or by address (`u/someone@x.com`).
// The index is whichever Google account signed in first, so it silently opens the wrong
// mailbox — or a "no such account" page — as soon as a second account is present, which
// a Workspace tenant guarantees. Always prefer the address; `0` is the last resort for
// when we genuinely don't know who is signed in.
export function gmailMailboxPath(mailbox: string | null | undefined): string {
  return mailbox ? encodeURIComponent(mailbox) : "0";
}

// Every message exchanged with one contact, in Gmail's own search UI.
//
// Returns null when the contact has no address — there is nothing to search on, and the
// caller renders nothing rather than a link that opens an empty inbox.
export function gmailConversationUrl(
  contactEmail: string | null | undefined,
  mailbox?: string | null
): string | null {
  // Normalized for the same reason every other comparison here is: an address stored in
  // mixed case is the same person, and Gmail's operators don't care, but a link built
  // from untrimmed input does.
  const address = normalizeEmail(contactEmail);
  if (!address) return null;
  // Gmail search operators, not free text. Both directions, because "the conversation"
  // includes what they sent us — which is the entire reason this link exists.
  const query = `from:${address} OR to:${address}`;
  return `https://mail.google.com/mail/u/${gmailMailboxPath(
    mailbox
  )}/#search/${encodeURIComponent(query)}`;
}
