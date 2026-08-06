import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  const accounts = await prisma.account.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(accounts);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.projectId || !body.name) {
    return NextResponse.json(
      { error: "projectId and name are required" },
      { status: 400 }
    );
  }
  const account = await prisma.account.create({
    data: {
      projectId: body.projectId,
      name: body.name,
      email: body.email ?? null,
      status: body.status ?? "Prospect",
      labels: body.labels ?? null,
      nextAction: body.nextAction ?? null,
      notes: body.notes ?? null,
      draftLink: body.draftLink ?? null,
      notesLink: body.notesLink ?? null,
      lastContact: body.lastContact ? new Date(body.lastContact) : null,
    },
  });
  return NextResponse.json(account, { status: 201 });
}
