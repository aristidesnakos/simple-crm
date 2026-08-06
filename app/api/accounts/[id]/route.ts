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
  ] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (body.lastContact !== undefined) {
    data.lastContact = body.lastContact ? new Date(body.lastContact) : null;
  }
  const account = await prisma.account.update({ where: { id }, data });
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
