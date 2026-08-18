import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const data: Record<string, unknown> = {};
  for (const key of [
    "name",
    "email",
    "status",
    "labels",
    "nextAction",
    "notes",
    "draftLink",
    "notesLink",
    "projectId",
  ] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (body.lastContact !== undefined) {
    data.lastContact = body.lastContact ? new Date(body.lastContact) : null;
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
