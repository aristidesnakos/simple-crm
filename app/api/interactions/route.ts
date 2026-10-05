import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/interactions?accountId=… — one contact's timeline, newest first.
//
// The first reader of the Interaction table, built now because D23 gave it real rows:
// for a business that sends through Resend, this is the only place the conversation
// exists (docs/ROADMAP.md §7 deferred the timeline "until after the first sends").
// Read-only — rows are written by the Resend routes, never by the client.
export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }
  const interactions = await prisma.interaction.findMany({
    where: { accountId },
    orderBy: { occurredAt: "desc" },
  });
  return NextResponse.json(interactions);
}
