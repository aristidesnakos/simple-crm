import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEmail, validateComplianceFields } from "@/lib/contacts";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  // Same narrow validation as the POST. Runs before anything is written, so a bad
  // jurisdiction never reaches the row that the draft route's consent gate reads.
  const invalid = validateComplianceFields(body);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  for (const key of [
    "name",
    "status",
    "kind",
    "labels",
    "nextAction",
    "notes",
    "draftLink",
    "notesLink",
    "projectId",
    // RS-01 compliance fields, string-valued. Suppression is absent on purpose: it is
    // not a column on this row, and POST /api/suppressions is its only writer.
    "sourceType",
    "sourceDetail",
    "jurisdiction",
  ] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  // email and the date fields sit outside the loop because each needs coercion:
  // addresses are normalized (lib/contacts.ts), dates are strings crossing JSON.
  if (body.email !== undefined) {
    data.email = normalizeEmail(body.email);
  }
  // consentedAt belongs HERE and not in the loop above: Prisma will not accept a JSON
  // string for a DateTime field, and the failure is silent enough to reach production.
  for (const key of ["lastContact", "nextActionDue", "consentedAt"] as const) {
    if (body[key] !== undefined) {
      data[key] = body[key] ? new Date(body[key]) : null;
    }
  }

  // Status transitions are logged append-only (docs/ROADMAP.md §2.4). The update
  // and the log entry share a transaction: a status change that isn't recorded is
  // history that no later work can reconstruct.
  const account = await prisma.$transaction(async (tx) => {
    const before =
      data.status !== undefined
        ? await tx.account.findUnique({
            where: { id },
            select: { status: true },
          })
        : null;
    const updated = await tx.account.update({ where: { id }, data });
    if (before && before.status !== updated.status) {
      await tx.statusEvent.create({
        data: {
          accountId: id,
          fromStatus: before.status,
          toStatus: updated.status,
        },
      });
    }
    return updated;
  });

  return NextResponse.json(account);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.account.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
