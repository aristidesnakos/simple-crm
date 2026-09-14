// One-off: collapse the two Mangood CAMPAIGN projects into one Mangood BUSINESS project.
// Run with:
//
//   npx tsx prisma/merge-mangood.ts
//
// Why this exists as a committed script rather than a few statements in Prisma Studio:
// the delete at the end is a cascade (Account.projectId has onDelete: Cascade), so a
// mis-ordered manual edit destroys 17 real contacts with no confirmation. The ordering
// and the emptiness assertion below are the whole point — see docs/ROADMAP.md D22.
//
// Background: `Project` was "campaign, named by product" (D16), which gave one business
// two rows in the sidebar and therefore two places to type its sending identity. The
// pipeline split that justified two projects is now carried by `Account.kind`
// (customer | collaborator, D15), so the projects can collapse with nothing lost.
//
// Guarded and idempotent, like prisma/seed.ts and prisma/import-mangood.ts: re-running
// after a successful merge is a no-op.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WAITLIST = "Mangood — Waitlist";
const PARTNERS = "Mangood — Partners";
const MERGED = "Mangood";

const MERGED_DESCRIPTION =
  "Mangood. Two pipelines in one project: warm inbound waitlist signups " +
  "(kind = customer) and co-marketing / ingredient-data partner brands " +
  "(kind = collaborator).";

// Both campaign briefs are kept, under per-pipeline headings, rather than one being
// discarded. `account-detail` renders Project.approach as a read-only brief beside the
// composer, and the operator needs whichever half matches the contact's kind. One field
// serving two vocabularies is a known rough edge; a per-kind brief is the refinement if
// it grates (D22).
function mergeApproaches(waitlist: string | null, partners: string | null): string {
  return [
    "— For waitlist signups (kind: customer) —",
    "",
    waitlist?.trim() || "(no brief recorded)",
    "",
    "",
    "— For partner brands (kind: collaborator) —",
    "",
    partners?.trim() || "(no brief recorded)",
  ].join("\n");
}

async function main() {
  const [waitlist, partners, merged] = await Promise.all([
    prisma.project.findFirst({ where: { name: WAITLIST } }),
    prisma.project.findFirst({ where: { name: PARTNERS } }),
    prisma.project.findFirst({ where: { name: MERGED } }),
  ]);

  if (!waitlist && !partners && merged) {
    const n = await prisma.account.count({ where: { projectId: merged.id } });
    console.log(`Already merged: "${MERGED}" holds ${n} contacts. Nothing to do.`);
    return;
  }

  if (!waitlist || !partners) {
    console.error(
      `Expected both "${WAITLIST}" and "${PARTNERS}" to exist. Found ` +
        `${waitlist ? `"${WAITLIST}"` : "neither"}${partners ? ` and "${PARTNERS}"` : ""}. ` +
        `Refusing to guess — inspect the projects and merge by hand.`
    );
    process.exitCode = 1;
    return;
  }

  const before = {
    waitlist: await prisma.account.count({ where: { projectId: waitlist.id } }),
    partners: await prisma.account.count({ where: { projectId: partners.id } }),
  };
  console.log(
    `Before: "${WAITLIST}" ${before.waitlist} contacts, ` +
      `"${PARTNERS}" ${before.partners} contacts.`
  );

  await prisma.$transaction(async (tx) => {
    // 1. Move every contact off the project that is about to be deleted. StatusEvent and
    //    Interaction hang off Account, not Project, so they travel with the row.
    //    Suppression is keyed on the email address and is untouched by design.
    const moved = await tx.account.updateMany({
      where: { projectId: partners.id },
      data: { projectId: waitlist.id },
    });
    console.log(`Moved ${moved.count} contacts into "${WAITLIST}".`);

    // 2. Rename and re-describe the survivor, and keep both briefs.
    await tx.project.update({
      where: { id: waitlist.id },
      data: {
        name: MERGED,
        description: MERGED_DESCRIPTION,
        approach: mergeApproaches(waitlist.approach, partners.approach),
        // E5 mitigation, deliberate: `ari@mangood.app` was set here while no mangood.app
        // send-as alias has ever been verified in Gmail, and Gmail commonly REWRITES an
        // unverified From to the primary address silently instead of erroring. Null makes
        // buildRawMessage omit the header entirely and Gmail use the mailbox default,
        // which is the honest behaviour until Phase 0 (0.b/0.c) actually verifies the
        // alias. Set it back then, not before.
        fromEmail: null,
      },
    });

    // 3. Only now delete the empty project. DELETE cascades to Account, so this assertion
    //    is the difference between a rename and destroying 17 contacts.
    const stragglers = await tx.account.count({ where: { projectId: partners.id } });
    if (stragglers !== 0) {
      throw new Error(
        `Refusing to delete "${PARTNERS}": ${stragglers} contacts still reference it. ` +
          `The delete cascades. Transaction rolled back.`
      );
    }
    await tx.project.delete({ where: { id: partners.id } });
    console.log(`Deleted the empty "${PARTNERS}" project.`);
  });

  const after = await prisma.account.count({ where: { projectId: waitlist.id } });
  console.log(`After: "${MERGED}" holds ${after} contacts.`);
  if (after !== before.waitlist + before.partners) {
    console.error(
      `Count mismatch — expected ${before.waitlist + before.partners}, got ${after}.`
    );
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
