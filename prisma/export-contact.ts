/**
 * Fulfil a data-subject access request (GDPR Art. 15).
 *
 *   npx tsx prisma/export-contact.ts someone@example.com
 *
 * Replaces steps 2-4 of the runbook at docs/requirements/04-COMPLIANCE-REGISTER §6.1,
 * which were a set of hand-typed sqlite3 queries — three of them, easy to run two of.
 *
 * Returns everything held about the person, not just their contact row:
 *
 *   - every Account row carrying that address, in EVERY project. A person is not a row
 *     here; the same address legitimately appears in several campaigns, and an export
 *     that returned one of them would be incomplete in a way nobody would notice.
 *   - the StatusEvent and Interaction history hanging off each of those rows.
 *   - any Suppression record, which is keyed on the address and can OUTLIVE every account
 *     row (docs/requirements/04 §6.3). A person who was erased but stayed suppressed still
 *     has data held about them, and Art. 15 covers it. Querying only Account would report
 *     "we hold nothing" while holding exactly that.
 *
 * Matching is case-insensitive via lib/contacts.ts normalizeEmail, because addresses are
 * normalized on write and a raw case-sensitive query produces a false negative — which
 * would be answering an access request with "no data" incorrectly.
 *
 * Art. 15(1)(g) asks for the SOURCE of the data, which is why REQ-08's provenance columns
 * are in the output rather than being an internal detail.
 *
 * Two things this script deliberately does not do:
 *
 *   It does not redact. `notes` is free text and may name third parties — a colleague, a
 *   competitor, an opinion about someone else. Those people's data must be removed before
 *   the export leaves your hands, and the requester's own must NOT be. That judgement is
 *   not automatable at this volume, so the script prints a warning and leaves it to you.
 *
 *   It does not reach outside the database. Gmail drafts and threads, dev-feedback
 *   screenshots that captured the contact, and any backup copies are all out of its view.
 *   §6.2 step 4 lists them; check them by hand.
 */
import { PrismaClient } from "@prisma/client";
import { normalizeEmail } from "../lib/contacts";

const prisma = new PrismaClient();

async function main() {
  const email = normalizeEmail(process.argv[2]);
  if (!email) {
    console.error("Usage: npx tsx prisma/export-contact.ts <email address>");
    process.exit(1);
  }

  const accounts = await prisma.account.findMany({
    where: { email },
    include: {
      project: { select: { name: true } },
      statusEvents: { orderBy: { changedAt: "asc" } },
      interactions: { orderBy: { occurredAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  const suppression = await prisma.suppression.findUnique({ where: { email } });

  if (accounts.length === 0 && !suppression) {
    // A complete answer. Do NOT create a record for them in order to reply —
    // docs/requirements/04 §6.1 is explicit about that.
    console.error(
      `No data held for ${email}.\n\n` +
        `Searching and finding nothing is a complete answer to an access request. ` +
        `Confirm that in writing, promptly, and do not create a record for them in ` +
        `order to reply.`
    );
    process.exit(2);
  }

  const payload = {
    subject: email,
    exportedAt: new Date().toISOString(),
    contactRecords: accounts.map((a) => ({
      project: a.project.name,
      name: a.name,
      email: a.email,
      pipeline: a.kind,
      status: a.status,
      labels: a.labels,
      notes: a.notes,
      notesLink: a.notesLink,
      nextAction: a.nextAction,
      nextActionDue: a.nextActionDue,
      lastContact: a.lastContact,
      draftLink: a.draftLink,
      // Art. 15(1)(g) — the source of the data. Art. 14 already obliged us to volunteer
      // it at first contact, so it should be no surprise to the requester.
      howWeObtainedYourDetails: a.sourceType,
      sourceDetail: a.sourceDetail,
      consentRecordedAt: a.consentedAt,
      jurisdiction: a.jurisdiction,
      addedToOurRecordsAt: a.createdAt,
      lastUpdatedAt: a.updatedAt,
      statusHistory: a.statusEvents.map((e) => ({
        from: e.fromStatus,
        to: e.toStatus,
        at: e.changedAt,
      })),
      interactions: a.interactions.map((i) => ({
        channel: i.channel,
        direction: i.direction,
        occurredAt: i.occurredAt,
        summary: i.summary,
      })),
    })),
    doNotContactRecord: suppression
      ? {
          optedOutAt: suppression.optedOutAt,
          howItReachedUs: suppression.source,
          whatYouToldUs: suppression.note,
          note:
            "Retained deliberately, and specifically in order to honour your request " +
            "not to be contacted. Deleting it is how a suppression stops working.",
        }
      : null,
  };

  console.log(JSON.stringify(payload, null, 2));

  const warn = (m: string) => console.error(m);
  warn("");
  warn("─".repeat(72));
  warn(`Found ${accounts.length} contact record(s)` +
    (accounts.length > 1
      ? ` across ${new Set(accounts.map((a) => a.project.name)).size} campaign(s).`
      : ".") +
    (suppression ? " A do-not-contact record is also held." : ""));
  if (accounts.length === 0 && suppression) {
    warn(
      "NOTE: no contact record, only a suppression. This person was erased but stayed " +
        "on the do-not-contact list, which is the correct outcome of a combined " +
        "erasure-and-objection request (doc 04 §6.3)."
    );
  }
  warn("");
  warn("BEFORE SENDING THIS:");
  warn("  1. Read every `notes` field. It is free text and may name third parties —");
  warn("     redact THEIR personal data, and none of the requester's own.");
  warn("  2. Check what is held outside this database: Gmail drafts and threads,");
  warn("     .claude/dev-feedback screenshots, and any backup copies. See doc 04 §6.2.");
  warn("  3. Log the request in doc 04 §6.4 — date, type, what was done, date closed.");
  warn("─".repeat(72));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
