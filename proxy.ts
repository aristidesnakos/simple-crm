import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Tripwire, not access control.
//
// Every route under /api except NextAuth's own is unauthenticated: no session check, no
// owner column, and `DELETE /api/projects/[id]` cascade-deletes a project with all its
// contacts and history. That is a deliberate single-tenant tradeoff (docs/ROADMAP.md
// D18) and it is genuinely fine on localhost — but it stops being fine the instant the
// app answers on any other interface, which `next dev --host` on cafe wifi or a first
// deploy both do silently and without warning.
//
// So this fails closed on host rather than trying to be the auth layer it isn't. Real
// per-user authorization is still the unbuilt work; this only guarantees that shipping
// without it is loud instead of quiet.
//
// Next 16 renamed the `middleware` convention to `proxy` — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function proxy(request: NextRequest) {
  // Escape hatch for the day this is deliberately exposed. Setting it is the moment
  // real auth becomes required, which is why it reads as a dare rather than a config.
  if (process.env.CRM_I_KNOW_THE_API_IS_UNAUTHENTICATED === "true") {
    return NextResponse.next();
  }

  const hostname = request.nextUrl.hostname;
  if (LOCAL_HOSTNAMES.has(hostname)) {
    return NextResponse.next();
  }

  return NextResponse.json(
    {
      error:
        "This CRM's API is unauthenticated and is only safe on localhost. It refused " +
        `a request for host "${hostname}". Add per-user auth before exposing it, or ` +
        "set CRM_I_KNOW_THE_API_IS_UNAUTHENTICATED=true to override.",
    },
    { status: 403 }
  );
}

// NextAuth's own routes are exempt: they are the sign-in flow, they have their own
// CSRF and state handling, and blocking them would break the OAuth callback — which is
// the one thing that has to work on a real hostname for Google to redirect back.
export const config = {
  matcher: ["/api/((?!auth).*)"],
};
