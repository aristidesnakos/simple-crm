import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { QUEUE_EXCLUDED_STATUSES } from "@/lib/types";

// The queue's answer depends on "now", and unlike the per-project reads it must never
// be served from a build-time snapshot.
export const dynamic = "force-dynamic";

// GET /api/queue — every open loop, across every project.
//
// This is the one read in the app that is not scoped to a project: crm-app.tsx holds a
// single selectedProjectId and structurally cannot ask this question (docs/ROADMAP.md
// D12). An open loop is a contact whose next action is due, overdue, or never set, and
// whose status doesn't already mean "nothing is owed here".
export async function GET() {
  const now = new Date();

  // Suppression lives in its own table keyed on the normalized address, so it cannot be a
  // column predicate. Read the set first, then exclude it below. At this scale that is one
  // small indexed scan — the same "costs nothing at tens of rows" reasoning as the JS sort.
  const suppressed = (
    await prisma.suppression.findMany({ select: { email: true } })
  ).map((s) => s.email);

  const rows = await prisma.account.findMany({
    where: {
      status: { notIn: [...QUEUE_EXCLUDED_STATUSES] },
      AND: [
        { OR: [{ nextActionDue: null }, { nextActionDue: { lte: now } }] },
        // Suppression is absolute and independent of the status vocabulary: a contact who
        // opted out is out of the queue whatever their stage says — including `Prospect`,
        // which is not in QUEUE_EXCLUDED_STATUSES and never will be — and out of it in
        // EVERY project they appear in, because the match is on the address, not the row.
        //
        // The `email: null` arm is load-bearing, not defensive. In SQL, `NOT IN` against a
        // NULL column excludes the row, so a bare `email: { notIn: … }` would silently drop
        // every contact with no address — 11 of 34 today, and exactly the rows the queue is
        // most likely to hold. Verified against real data, not assumed.
        { OR: [{ email: null }, { email: { notIn: suppressed } }] },
      ],
    },
    include: { project: { select: { id: true, name: true } } },
  });

  // Sorted here rather than in the query: Prisma's `nulls` ordering isn't available on
  // SQLite, and the rule is two-bucket anyway. At tens of rows this costs nothing.
  //
  //   Bucket A — a due date exists (and by the filter above, it has passed).
  //              Most overdue first.
  //   Bucket B — no due date. Ordered by how long the contact has been sitting:
  //              lastContact if we've spoken, otherwise when they arrived. The nine
  //              waitlist signups land here, oldest signup first, which is the whole
  //              argument — the list has been decaying for a median of 103 days.
  const sorted = rows.sort((a, b) => {
    if (a.nextActionDue && b.nextActionDue) {
      return a.nextActionDue.getTime() - b.nextActionDue.getTime();
    }
    if (a.nextActionDue) return -1;
    if (b.nextActionDue) return 1;

    const aged = (r: (typeof rows)[number]) =>
      (r.lastContact ?? r.createdAt).getTime();
    return aged(a) - aged(b);
  });

  return NextResponse.json(sorted);
}
