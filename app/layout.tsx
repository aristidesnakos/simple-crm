import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ari's CRM",
  description: "A simple, project-tiered CRM for tracking accounts and drafting outreach.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();

  // The Google access token lives on the session for the Gmail route's benefit (see the
  // session callback in lib/auth.ts) and is read there, server-side, via auth(). Passing
  // it to SessionProvider serializes a live gmail.compose credential into the RSC payload
  // of EVERY page: readable from document, sitting in browser cache, and reachable by any
  // script that gets onto the page. Until this came off, any XSS was a full mailbox
  // compromise.
  //
  // Nothing on the client reads it — top-bar and account-detail call useSession() for the
  // user object — so removing it is behaviour-preserving.
  //
  // `accessToken` and NOTHING else. `session.error` stays: components/crm/top-bar.tsx
  // reads it to swap the avatar menu for a "session expired" prompt, and stripping it
  // would silently revert that while every other check here still passed. `scope` stays
  // too — not a credential, and it is what a future read path needs to tell "never
  // granted" from "Gmail is down".
  //
  // undefined rather than delete: undefined is dropped during serialization, and it keeps
  // the shape stable for TypeScript without a delete on a spread object. The cast matches
  // the existing `unknown` idiom in lib/auth.ts — module augmentation is deliberately not
  // set up, and a partial declaration for this one field would leave the codebase with two
  // half-truths about Session instead of one consistent cast.
  const clientSession = session
    ? ({
        ...(session as unknown as Record<string, unknown>),
        accessToken: undefined,
      } as unknown as typeof session)
    : null;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SessionProvider session={clientSession}>{children}</SessionProvider>
        <Toaster />
      </body>
    </html>
  );
}
