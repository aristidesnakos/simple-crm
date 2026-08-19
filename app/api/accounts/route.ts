import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { defaultStatusFor, normalizeEmail } from "@/lib/contacts";
import { DEFAULT_KIND } from "@/lib/types";

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
  const kind = body.kind ?? DEFAULT_KIND;
  const account = await prisma.account.create({
    data: {
      projectId: body.projectId,
      name: body.name,
      email: normalizeEmail(body.email),
      kind,
      // Explicit rather than leaning on the schema default, which cannot branch on kind.
      status: body.status ?? defaultStatusFor(kind),
      labels: body.labels ?? null,
      nextAction: body.nextAction ?? null,
      notes: body.notes ?? null,
      draftLink: body.draftLink ?? null,
      notesLink: body.notesLink ?? null,
      lastContact: body.lastContact ? new Date(body.lastContact) : null,
      nextActionDue: body.nextActionDue ? new Date(body.nextActionDue) : null,
    },
  });
  return NextResponse.json(account, { status: 201 });
}
