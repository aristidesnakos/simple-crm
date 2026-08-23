import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  defaultStatusFor,
  normalizeEmail,
  validateComplianceFields,
} from "@/lib/contacts";
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
  // Narrow, deliberate validation of the four fields that carry legal meaning. See
  // lib/contacts.ts for why these and nothing else.
  const invalid = validateComplianceFields(body);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
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
      // RS-01. A contact created by hand in the UI genuinely is `manual`, so defaulting
      // here means the two create dialogs need no change and no row is ever written with
      // null provenance (docs/requirements/01-PRD success criterion 3).
      sourceType: body.sourceType ?? "manual",
      sourceDetail: body.sourceDetail ?? null,
      consentedAt: body.consentedAt ? new Date(body.consentedAt) : null,
      jurisdiction: body.jurisdiction ?? null,
      // Nothing about suppression appears here on purpose. Creating a contact never
      // suppresses them, and a suppressed contact should not be created at all — that
      // check belongs in the import script, which is where bulk creation happens.
    },
  });
  return NextResponse.json(account, { status: 201 });
}
