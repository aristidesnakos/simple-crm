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
  const body = await request.json();
  const project = await prisma.project.create({
    data: {
      name: body.name,
      description: body.description ?? null,
      status: body.status ?? "Active",
      approach: body.approach ?? null,
      fromEmail: normalizeEmail(body.fromEmail),
    },
  });
  return NextResponse.json(project, { status: 201 });
}
