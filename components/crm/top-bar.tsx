"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV = [
  { href: "/", label: "Projects" },
  { href: "/queue", label: "Queue" },
];

export function TopBar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  // `lib/auth.ts` sets this when the Google refresh fails, which leaves a session that
  // still looks signed in but carries a dead credential — every Gmail call then returns
  // an opaque 502. Until this was read, nothing in the app surfaced it. Same `unknown`
  // cast idiom as the accessToken, since module augmentation isn't set up.
  const expired =
    (session as unknown as { error?: string })?.error ===
    "RefreshAccessTokenError";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
      <div className="flex items-center gap-4">
        <span className="text-sm font-semibold">Ari&apos;s CRM</span>
        <nav className="flex items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent",
                pathname === item.href
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      {status === "loading" ? null : expired ? (
        <Button size="sm" variant="outline" onClick={() => signIn("google")}>
          Session expired — sign in again
        </Button>
      ) : session ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2">
              <Avatar className="h-7 w-7">
                <AvatarImage src={session.user?.image ?? undefined} />
                <AvatarFallback>
                  {session.user?.name?.[0] ?? "?"}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          {/* w-auto is load-bearing: DropdownMenuContent defaults to
              w-(--radix-dropdown-menu-trigger-width), and the trigger here is a 28px
              avatar, so the menu collapsed to its min-w-32 and clipped the email
              against overflow-x-hidden. */}
          <DropdownMenuContent align="end" className="w-auto min-w-56">
            <div className="px-2 py-1.5">
              <p className="text-xs text-muted-foreground">Signed in as</p>
              <p className="mt-0.5 text-sm font-medium break-all">
                {session.user?.email}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()}>
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button size="sm" onClick={() => signIn("google")}>
          Sign in with Google
        </Button>
      )}
    </header>
  );
}
