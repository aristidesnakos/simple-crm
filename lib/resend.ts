import { Resend } from "resend";

// The Resend client, for projects whose sendVia is "resend" (docs/ROADMAP.md D23).
//
// Constructed lazily and per call, never at module scope: `new Resend()` THROWS when no
// key is configured, which at module scope would take down every route that imports this
// file — including on a machine that only ever uses Gmail drafts. A missing key is a 501
// with instructions, the same shape POST /api/compose returns for OPENROUTER_API_KEY.
//
// The SDK returns `{ data, error }` and does not throw on HTTP errors, so callers branch on
// `error.name` — never on `statusCode`, which Resend's own docs disagree about for
// `validation_error` (400 on one page, 422 on another).
export function resendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  return key ? new Resend(key) : null;
}

export const RESEND_KEY_MISSING =
  "RESEND_API_KEY isn't set. Create a Full access key at resend.com/api-keys (Sending " +
  "access can send but cannot read replies), add it to .env, and restart the dev server.";

// Errors that will fail every remaining message in a batch identically: a bad key, an
// unverified domain, an exhausted quota. The send route stops at the first one rather than
// burning the rest of the list on the same refusal.
const FATAL_ERROR_NAMES = new Set([
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "suspended_api_key",
  "invalid_permission",
  "invalid_access",
  "security_error",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  "invalid_from_address",
]);

// `validation_error` is both an account-level refusal — "API key is invalid" (401, observed
// 2026-10-05; the docs name it invalid_api_key, the API does not), "The `domain` domain is
// not verified" (403) — and "this one recipient address is malformed" (400/422, per
// message). So any 401/403 is fatal whatever its name, and other statuses go by name.
export function isFatalResendError(error: {
  name: string;
  statusCode: number | null;
}): boolean {
  return (
    FATAL_ERROR_NAMES.has(error.name) ||
    error.statusCode === 401 ||
    error.statusCode === 403
  );
}

// The opt-out header every Resend send carries. Gmail and Apple Mail render it as an
// "Unsubscribe" link beside the sender; pressing it emails this address with the subject
// "unsubscribe", which arrives through polling like any reply and is matched by
// isOptOutReply in lib/outreach.ts. mailto rather than RFC 8058 one-click, because
// one-click needs an HTTPS endpoint and this app only answers on localhost (proxy.ts).
// Resend says one-click becomes mandatory above 5,000 messages a day to Gmail — far off.
export function listUnsubscribeHeader(fromEmail: string): string {
  return `<mailto:${fromEmail}?subject=unsubscribe>`;
}

// Resend's list rows carry a bare address, but headers.from carries `Name <addr>`. Accept
// either.
export function bareAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const angled = value.match(/<([^>]+)>/);
  return (angled ? angled[1] : value).trim().toLowerCase() || null;
}

export function domainOf(address: string | null | undefined): string | null {
  const at = address?.lastIndexOf("@") ?? -1;
  return at > 0 ? address!.slice(at + 1).toLowerCase() : null;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
