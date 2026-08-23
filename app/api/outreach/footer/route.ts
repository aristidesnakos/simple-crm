import { NextResponse } from "next/server";
import {
  buildFooter,
  resolveSenderIdentity,
  senderIdentityProblem,
} from "@/lib/outreach";

// GET /api/outreach/footer — the exact footer POST /api/gmail/draft will append.
//
// Exists because the composer is a client component and `process.env` is not readable
// there, so the preview has no other way to show the real thing. Both callers go through
// buildFooter in lib/outreach.ts, which is the point: REQ-06b is about the preview and the
// sent message not drifting apart, and a preview that reconstructs the footer separately
// would drift the first time either changed.
//
// Returns the problem rather than throwing when the identity is unconfigured, so the
// composer can say "drafting will fail, here is why" instead of rendering a blank box —
// which would look like there is simply no footer.
//
// No personal data here: a company name and a postal address that go out in every message
// we send. Worth noting explicitly because REQ-11 is a rule about not widening what the
// client payload carries, and a reviewer should ask.
export async function GET() {
  const identity = resolveSenderIdentity();
  const problem = senderIdentityProblem(identity);

  if (problem) {
    return NextResponse.json({ footer: null, problem });
  }
  return NextResponse.json({ footer: buildFooter(identity), problem: null });
}
