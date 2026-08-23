import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEmail, validateSuppressionFields } from "@/lib/contacts";

// POST /api/suppressions — record a do-not-contact request.
//
// The only writer of the Suppression table from the application. Deliberately its own
// route rather than a branch of the accounts PATCH, for three reasons:
//
//   1. The record is not scoped to an account. Suppression is keyed on the address and
//      covers every campaign the person appears in, so PATCH /api/accounts/[id] is the
//      wrong address for it.
//   2. account-detail.tsx is an inline auto-saving form with a known in-flight race
//      (docs/ROADMAP.md E6): a slow PATCH resolving after a fast one overwrites the
//      newer edit with its stale response. That is an accepted defect for ordinary
//      fields and is NOT acceptable for a lost opt-out. A separate route makes
//      suppression structurally unreachable by patch(), rather than relying on someone
//      remembering not to use it.
//   3. The response has to say which accounts changed. CrmApp owns all state and nothing
//      refetches after a mutation, so the caller splices `affected` into its arrays.
//
// See docs/requirements/02-TRD-technical-spec.md §5.5.

export async function POST(request: NextRequest) {
  let body: {
    email?: unknown;
    optedOutAt?: string | null;
    source?: string | null;
    note?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  // Normalized before it is used as a key, not after. A suppression stored in mixed case
  // is a suppression that never matches — every other path looks the address up lowercase.
  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json(
      { error: "An email address is required to record an opt-out." },
      { status: 400 }
    );
  }

  const invalid = validateSuppressionFields(body as Record<string, unknown>);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  // Upsert rather than create: the same person can opt out twice — a reply, then a
  // forwarded complaint — and the second attempt must not fail. The FIRST timestamp is
  // the one that matters legally, so an existing optedOutAt is never overwritten; only
  // the source and note are refreshed, since a later message is usually the fuller
  // evidence. Passing `undefined` leaves a field untouched in Prisma.
  const suppression = await prisma.suppression.upsert({
    where: { email },
    create: {
      email,
      optedOutAt: body.optedOutAt ? new Date(body.optedOutAt) : new Date(),
      source: body.source ?? null,
      note: body.note ?? null,
    },
    update: {
      source: body.source ?? undefined,
      note: body.note ?? undefined,
    },
  });

  // Every account this now covers, across every project. The client splices these so the
  // banner appears on all of them without a refetch — a person suppressed while working
  // one campaign is suppressed in the others too, and the UI should say so.
  const affected = await prisma.account.findMany({
    where: { email },
    select: { id: true, projectId: true },
  });

  return NextResponse.json({ suppression, affected }, { status: 201 });
}

// DELETE /api/suppressions?email=… — for the mistaken entry only.
//
// No UI calls this and none should: docs/requirements/04-COMPLIANCE-REGISTER §6.3 is
// explicit that a suppression record is retained *because* of the objection, and deleting
// one is how somebody gets re-emailed after asking us to stop. It exists so that a typo
// can be undone with curl instead of Prisma Studio, and it logs loudly because
// un-suppressing is the most consequential write in this application.
export async function DELETE(request: NextRequest) {
  const email = normalizeEmail(request.nextUrl.searchParams.get("email"));
  if (!email) {
    return NextResponse.json(
      { error: "An email address is required." },
      { status: 400 }
    );
  }

  const existing = await prisma.suppression.findUnique({ where: { email } });
  if (!existing) {
    return NextResponse.json(
      { error: `No opt-out is on file for ${email}.` },
      { status: 404 }
    );
  }

  await prisma.suppression.delete({ where: { email } });
  console.warn(
    `SUPPRESSION REMOVED for ${email} (was opted out ` +
      `${existing.optedOutAt.toISOString().slice(0, 10)}). This person can now be ` +
      `emailed again. See docs/requirements/04-COMPLIANCE-REGISTER §6.3.`
  );

  return NextResponse.json({ ok: true, email });
}
