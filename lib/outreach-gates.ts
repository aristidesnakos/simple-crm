import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/contacts";
import { CONSENT_FIRST_JURISDICTIONS } from "@/lib/types";

// The RS-01 refusals every outbound path runs before anything leaves, shared by
// POST /api/gmail/draft and POST /api/resend/send. Lifted out of the Gmail route when a
// second transport arrived (docs/ROADMAP.md D23): two copies of a legal gate are two
// chances for one of them to drift.
//
// Server-only — this reads the database. The pure message helpers that a client
// component may import live in lib/outreach.ts, which is why this is not part of it.
//
// Each returns null when the send may proceed. The caller appends its own consequence
// ("No draft was created." / "Nothing was sent.") because only it knows which.

export type Refusal = {
  status: number;
  error: string;
  // Present only on the overridable refusal. Absent means "no", not "ask".
  requiresAcknowledgement?: true;
};

// Suppression, with no override parameter. A request reaching this branch is asking the
// application to contact someone who told us to stop; there is no argument the caller
// could pass that makes that acceptable, so there is no argument to pass. Deliberately
// asymmetric with the jurisdiction gate below.
//
// Keyed on the recipient ADDRESS rather than on the account row, so an opt-out recorded
// against this person in ANY project blocks this send too. Normalized the same way it was
// on the way in — a lookup on the raw address would miss a suppression stored lowercase,
// which is every suppression. Callers pass the address that actually goes in the To
// header: gating on anything else leaves a hole.
export async function suppressionRefusal(
  name: string,
  to: string
): Promise<Refusal | null> {
  const suppressed = await prisma.suppression.findUnique({
    where: { email: normalizeEmail(to) ?? "" },
  });
  if (!suppressed) return null;
  return {
    status: 409,
    error: `${name} opted out on ${suppressed.optedOutAt.toISOString().slice(0, 10)}.`,
  };
}

// Jurisdiction gate. Unlike suppression this is an "are you sure" and not a "no":
// consent-first is a rule about unsolicited FIRST contact, and the operator may hold a
// basis the database doesn't know about. The acknowledgement is per-request and is never
// written to the row — a persisted acknowledgement is a permission, and this deliberately
// is not one. Same reasoning as CRM_I_KNOW_THE_API_IS_UNAUTHENTICATED in proxy.ts: make
// the override loud, and make it cost something every time.
export function jurisdictionRefusal(
  account: { name: string; jurisdiction: string | null; consentedAt: Date | null },
  acknowledged: boolean
): Refusal | null {
  const consentFirst = (CONSENT_FIRST_JURISDICTIONS as readonly string[]).includes(
    account.jurisdiction ?? ""
  );
  if (!consentFirst || account.consentedAt || acknowledged) return null;
  return {
    status: 409,
    error:
      `${account.name} is recorded in ${account.jurisdiction}, where a first ` +
      `unsolicited email needs consent, and no consent date is on file. Record ` +
      `consent on the contact, or confirm you have a basis for this send.`,
    // The discriminator that lets the client tell an overridable 409 from an absolute
    // one without string-matching the message. Absent on the suppression refusal.
    requiresAcknowledgement: true,
  };
}
