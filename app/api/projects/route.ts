import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/contacts";

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { accounts: true } } },
  });
  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  // Both guards exist because the failure without them is invisible, not merely ugly:
  // an unhandled throw here returns a ZERO-BYTE 500, so the client's res.json() throws
  // in turn and the create dialog silently does nothing. A JSON body is what lets the
  // caller show the user why. Matches the guards already in accounts POST and compose.
  let body: {
    name?: unknown;
    description?: string | null;
    status?: string;
    approach?: string | null;
    fromEmail?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const project = await prisma.project.create({
    data: {
      name: body.name.trim(),
      description: body.description ?? null,
      status: body.status ?? "Active",
      approach: body.approach ?? null,
      fromEmail: normalizeEmail(body.fromEmail),
    },
  });
  return NextResponse.json(project, { status: 201 });
}
