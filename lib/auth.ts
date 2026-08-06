import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

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
      }

      // Token still valid — reuse it.
      if (
        token.accessTokenExpires &&
        Date.now() < (token.accessTokenExpires as number)
      ) {
        return token;
      }

      // Expired — refresh it.
      if (token.refreshToken) {
        try {
          const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: process.env.AUTH_GOOGLE_ID!,
              client_secret: process.env.AUTH_GOOGLE_SECRET!,
              grant_type: "refresh_token",
              refresh_token: token.refreshToken as string,
            }),
          });
          const refreshed = await res.json();
          if (!res.ok) throw refreshed;
          token.accessToken = refreshed.access_token;
          token.accessTokenExpires = Date.now() + refreshed.expires_in * 1000;
        } catch (err) {
          console.error("Failed to refresh Google access token", err);
          token.error = "RefreshAccessTokenError";
        }
      }
      return token;
    },
    async session({ session, token }) {
      (session as unknown as { accessToken?: string }).accessToken =
        token.accessToken as string | undefined;
      (session as unknown as { error?: string }).error = token.error as
        | string
        | undefined;
      return session;
    },
  },
});
