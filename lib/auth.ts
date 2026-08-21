import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import {
  refreshGoogleToken,
  saveGoogleCredential,
} from "@/lib/google-credential";

// Gmail scope needed so the app can create real Gmail drafts on the user's behalf.
// gmail.compose covers creating/updating/sending drafts (but not reading arbitrary mail).
const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.compose",
].join(" ");

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          scope: GMAIL_SCOPES,
          access_type: "offline", // request a refresh_token
          prompt: "consent", // force Google to re-issue a refresh_token every sign-in
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // On initial sign-in, `account` has the tokens from Google.
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token ?? token.refreshToken;
        token.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : undefined;
        // What Google actually granted, which is not necessarily what GMAIL_SCOPES
        // asks for: a refresh_token grant returns the scopes of the ORIGINAL consent,
        // and the refresh call below never sends `scope`. So widening GMAIL_SCOPES
        // keeps minting old-scope tokens, silently, until the user consents again.
        // Recording it here is what lets a route tell "not granted" from "Gmail is
        // down" instead of surfacing both as an opaque 502.
        token.scope = account.scope;
        // A fresh consent clears any error the previous grant died with.
        token.error = undefined;

        // Mirror the grant into the database. This is the only moment Google hands
        // over a refresh token, so it is the only moment it can be persisted — and
        // persisting it is what lets code with no browser request behind it reach
        // Gmail later. Failure is logged, never thrown: a database problem must not
        // take down sign-in, and the JWT still carries everything this session needs.
        if (token.email && token.accessToken) {
          try {
            await saveGoogleCredential({
              email: token.email as string,
              accessToken: token.accessToken as string,
              expiresAt: new Date(
                (token.accessTokenExpires as number | undefined) ?? Date.now()
              ),
              refreshToken: token.refreshToken as string | undefined,
              scope: account.scope,
            });
          } catch (err) {
            console.error("Couldn't persist the Google credential", err);
          }
        }
      }

      // Token still valid — reuse it. The 5-minute buffer matters because the check
      // happens here but the token is used later, in a Gmail call: without it a
      // request that starts in the final second of the hour ships a credential that
      // expires mid-flight, and the user sees a 502 rather than a refresh.
      if (
        token.accessTokenExpires &&
        Date.now() + 5 * 60 * 1000 < (token.accessTokenExpires as number)
      ) {
        return token;
      }

      // Expired — refresh it. The HTTP exchange lives in lib/google-credential.ts so
      // the background path and this one cannot drift apart.
      if (token.refreshToken) {
        try {
          const refreshed = await refreshGoogleToken(
            token.refreshToken as string
          );
          token.accessToken = refreshed.accessToken;
          token.accessTokenExpires = refreshed.expiresAt.getTime();
          token.error = undefined; // recovered from an earlier failure

          if (token.email) {
            try {
              await saveGoogleCredential({
                email: token.email as string,
                accessToken: refreshed.accessToken,
                expiresAt: refreshed.expiresAt,
                scope: refreshed.scope,
              });
            } catch (err) {
              console.error("Couldn't persist the refreshed credential", err);
            }
          }
        } catch (err) {
          console.error("Failed to refresh Google access token", err);
          token.error = "RefreshAccessTokenError";
        }
      } else {
        // No refresh token and the access token has expired. Previously this fell
        // through and returned a dead credential that still looked signed-in.
        token.error = "RefreshAccessTokenError";
      }
      return token;
    },
    async session({ session, token }) {
      (session as unknown as { accessToken?: string }).accessToken =
        token.accessToken as string | undefined;
      (session as unknown as { error?: string }).error = token.error as
        | string
        | undefined;
      (session as unknown as { scope?: string }).scope = token.scope as
        | string
        | undefined;
      return session;
    },
  },
});
