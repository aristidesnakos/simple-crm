import { prisma } from "@/lib/prisma";

/**
 * Server-side home for the signed-in Google identity's tokens.
 *
 * Auth.js still owns sign-in, the session cookie, and CSRF. This exists for the one
 * thing a JWT cookie structurally cannot do: hand a refresh token to code that has no
 * browser request behind it. Reply polling needs exactly that, and `auth()` called
 * inside a route handler cannot write a refreshed token back to the cookie — so
 * without this every draft click past the hour mark re-refreshes from scratch.
 *
 * See prisma/schema.prisma `GoogleCredential` for why this is not the Auth.js Prisma
 * adapter.
 */

// Refresh this far before the token actually dies. The check happens here but the
// token is used later, inside a Gmail call — without a buffer a request that starts in
// the final second of the hour ships a credential that expires in flight.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

export type RefreshedToken = {
  accessToken: string;
  expiresAt: Date;
  /**
   * Google returns `scope` on a refresh, but it describes the ORIGINAL consent — a
   * refresh grant never widens scope, and the request never asks it to. Undefined
   * means Google omitted it, not that nothing was granted.
   */
  scope?: string;
};

/**
 * Exchange a refresh token for a fresh access token. Throws the parsed Google error
 * body on failure so callers can distinguish a revoked grant (`invalid_grant`) from a
 * transport problem.
 */
export async function refreshGoogleToken(
  refreshToken: string
): Promise<RefreshedToken> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID!,
      client_secret: process.env.AUTH_GOOGLE_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const payload = await res.json();
  if (!res.ok) throw payload;
  return {
    accessToken: payload.access_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000),
    scope: payload.scope,
  };
}

/**
 * Upsert the stored credential. Called from the `jwt` callback on sign-in and after a
 * successful refresh — never on a plain session read, so this does not run on every
 * page load.
 *
 * `refreshToken` is only overwritten when a new one is supplied: Google returns one on
 * first consent and often omits it afterwards, and blanking a good refresh token is
 * how an app silently loses offline access.
 */
export async function saveGoogleCredential(input: {
  email: string;
  accessToken: string;
  expiresAt: Date;
  refreshToken?: string | null;
  scope?: string | null;
}) {
  const { email, accessToken, expiresAt, refreshToken, scope } = input;
  await prisma.googleCredential.upsert({
    where: { email },
    create: {
      email,
      accessToken,
      expiresAt,
      refreshToken: refreshToken ?? null,
      scope: scope ?? null,
    },
    update: {
      accessToken,
      expiresAt,
      ...(refreshToken ? { refreshToken } : {}),
      ...(scope ? { scope } : {}),
    },
  });
}

export type CredentialResult =
  | { ok: true; accessToken: string; email: string; scope: string | null }
  | { ok: false; reason: "no_credential" | "no_refresh_token" | "refresh_failed" };

/**
 * Return a usable access token with no session in hand, refreshing and persisting it
 * when needed. This is the entry point for anything running outside a browser request.
 *
 * Pass `email` to target a specific identity; with one omitted it takes the most
 * recently updated row, which is the signed-in user in a single-tenant app.
 */
export async function getFreshGoogleAccessToken(
  email?: string
): Promise<CredentialResult> {
  const credential = email
    ? await prisma.googleCredential.findUnique({ where: { email } })
    : await prisma.googleCredential.findFirst({
        orderBy: { updatedAt: "desc" },
      });

  if (!credential) return { ok: false, reason: "no_credential" };

  if (credential.expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now()) {
    return {
      ok: true,
      accessToken: credential.accessToken,
      email: credential.email,
      scope: credential.scope,
    };
  }

  if (!credential.refreshToken) return { ok: false, reason: "no_refresh_token" };

  try {
    const refreshed = await refreshGoogleToken(credential.refreshToken);
    await saveGoogleCredential({
      email: credential.email,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
    });
    return {
      ok: true,
      accessToken: refreshed.accessToken,
      email: credential.email,
      scope: refreshed.scope ?? credential.scope,
    };
  } catch (err) {
    // A revoked or expired grant lands here as `invalid_grant`. Logged rather than
    // thrown so a caller can fall back to the session token and prompt a re-auth.
    console.error("Failed to refresh stored Google credential", err);
    return { ok: false, reason: "refresh_failed" };
  }
}

/**
 * Whether a granted-scope string covers a scope we need. Google returns the granted
 * scopes space-separated; a substring test would match `gmail.compose` inside
 * `gmail.compose.readonly`-style names, so compare tokens.
 */
export function grantIncludesScope(
  granted: string | null | undefined,
  scope: string
) {
  if (!granted) return false;
  return granted.split(/\s+/).includes(scope);
}
