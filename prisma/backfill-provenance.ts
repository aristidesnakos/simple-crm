/**
 * One-shot provenance backfill for contacts that predate RS-01.
 *
 *   npx tsx prisma/backfill-provenance.ts          # dry run, changes nothing
 *   npx tsx prisma/backfill-provenance.ts --write  # actually writes
 *
 * `npx prisma db seed` does not work in this repo — no `prisma.seed` key in package.json,
 * no prisma.config.ts — and prisma/seed.ts is guarded to skip when any project exists, so
 * it cannot be repurposed. This is a third loader alongside seed.ts and import-mangood.ts
 * and, like both, it bypasses the API. That is the accepted pattern here, not an oversight.
 *
 * Four properties this script has to hold (docs/requirements/02-TRD §10.1):
 *
 *   Idempotent      Only rows with sourceType === null are touched. Safe to run twice,
 *                   safe after a partial failure.
 *   Guarded         Dry run by default. A no-op prints why, so it is distinguishable from
 *                   a silent failure.
 *   Reports         Per-project counts, then a total, then the number still null — which
 *                   has to reach 0 for REQ-09.
 *   Non-destructive MUST NOT modify `notes`. See below.
 *
 * The `notes` rule is the one worth restating. The waitlist rows carry their signup date
 * in prose. consentedAt is DERIVED from that prose — read it, write the timestamp to the
 * column, leave the original text exactly where it is. Two reasons: the prose is the
 * human-readable evidence and the timestamp is the queryable one, and losing the former to
 * gain the latter is a net loss of evidence; and a script that destroys its own input
 * cannot be re-run, which breaks idempotency.
 *
 * If a signup date cannot be parsed, consentedAt is left null, sourceType is set anyway,
 * and the row is listed for manual handling. We do not guess a date. A wrong consent
 * timestamp is worse than a missing one — a missing one is honest.
 *
 * jurisdiction is deliberately NOT backfilled. Guessing it from an email domain is exactly
 * the false confidence PRD N1 rejects: a .com says nothing, and a company's TLD is not the
 * recipient's location. It is a human pass, CRM-117 / REQ-10b.
 */
import { PrismaClient } from "@prisma/client";
import { SOURCE_TYPES } from "../lib/types";

const prisma = new PrismaClient();
const WRITE = process.argv.includes("--write");

// Every pre-existing row carries a "Source: <what>, imported <date>." line in its notes,
// written by the two import scripts. That line is the actual provenance evidence, so we
// read it rather than hardcoding a mapping off project names — which would silently
// mislabel any row that moved project since import.
// [\s\S] rather than the `s` flag: this repo's tsconfig target predates es2018.
const SOURCE_LINE = /Source:\s*([\s\S]+?)\.\s*$/m;

// "Signed up via the Mangood waitlist form on 2026-04-16."
const SIGNUP_DATE = /signed up [\s\S]*? on (\d{4}-\d{2}-\d{2})/i;

type SourceType = (typeof SOURCE_TYPES)[number];

// Classified from the source line itself. Ordered most-specific first.
function classify(sourceDetail: string | null): SourceType {
  if (!sourceDetail) return "manual";
  const s = sourceDetail.toLowerCase();
  if (s.includes("waitlist") && s.includes(".csv")) return "waitlist_form";
  if (s.includes("sheet")) return "partner_sheet";
  if (s.includes("docs/") || s.includes("outreach")) return "research";
  return "manual";
}

async function main() {
  const accounts = await prisma.account.findMany({
    include: { project: { select: { name: true } } },
    orderBy: [{ projectId: "asc" }, { createdAt: "asc" }],
  });

  const pending = accounts.filter((a) => a.sourceType === null);

  if (pending.length === 0) {
    console.log(
      `Nothing to do: all ${accounts.length} contacts already have a sourceType.\n` +
        `This script only touches rows where it is null, so re-running is a no-op.`
    );
    return;
  }

  console.log(
    `${pending.length} of ${accounts.length} contacts have no provenance.` +
      (WRITE ? "" : "  (DRY RUN — pass --write to apply)")
  );
  console.log();

  const perProject = new Map<string, { set: number; consent: number }>();
  const unparseable: string[] = [];
  const mismatched: string[] = [];

  for (const a of pending) {
    const notes = a.notes ?? "";
    const sourceDetail = notes.match(SOURCE_LINE)?.[1]?.trim() ?? null;
    const sourceType = classify(sourceDetail);

    // Consent only means something for a source where the contact acted themselves.
    // A partner sheet has no consent, and recording one would be a lie in a column
    // whose whole purpose is to be evidence.
    let consentedAt: Date | null = null;
    if (sourceType === "waitlist_form") {
      const parsed = notes.match(SIGNUP_DATE)?.[1];
      if (parsed) {
        consentedAt = new Date(`${parsed}T00:00:00.000Z`);
        // roadmap task 1.5 set createdAt to the real submission time, so the two are
        // independent records of the same event. If they disagree, something is wrong
        // with one of them and a human should look rather than the script picking.
        const created = a.createdAt.toISOString().slice(0, 10);
        if (created !== parsed) {
          mismatched.push(
            `  ${a.name}: notes say ${parsed}, createdAt says ${created}`
          );
        }
      } else {
        unparseable.push(`  ${a.name} (${a.project.name})`);
      }
    }

    const bucket = perProject.get(a.project.name) ?? { set: 0, consent: 0 };
    bucket.set += 1;
    if (consentedAt) bucket.consent += 1;
    perProject.set(a.project.name, bucket);

    if (WRITE) {
      // `notes` is absent from this update on purpose, and must stay absent.
      await prisma.account.update({
        where: { id: a.id },
        data: { sourceType, sourceDetail, consentedAt },
      });
    }
  }

  for (const [project, { set, consent }] of perProject) {
    console.log(`  ${project} — ${set} rows, ${consent} with a consent date`);
  }

  if (mismatched.length) {
    console.log(
      `\n${mismatched.length} row(s) where the notes date and createdAt disagree.` +
        ` The notes value was used; check these by hand:`
    );
    console.log(mismatched.join("\n"));
  }

  if (unparseable.length) {
    console.log(
      `\n${unparseable.length} waitlist row(s) with no parseable signup date.` +
        ` sourceType was set, consentedAt left null. Handle these by hand:`
    );
    console.log(unparseable.join("\n"));
  }

  const stillNull = WRITE
    ? await prisma.account.count({ where: { sourceType: null } })
    : pending.length;

  console.log();
  if (WRITE) {
    console.log(
      `Done. ${pending.length} rows updated. ${stillNull} still without a sourceType` +
        (stillNull === 0 ? " — REQ-09 satisfied." : " — REQ-09 NOT satisfied.")
    );
    console.log(
      `jurisdiction was not touched: that is the human pass, CRM-117 / REQ-10b.`
    );
  } else {
    console.log(`Dry run complete. Nothing was written. Re-run with --write to apply.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
