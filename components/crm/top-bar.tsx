"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function TopBar() {
  const { data: session, status } = useSession();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Ari&apos;s CRM</span>
        <span className="text-xs text-muted-foreground">
          local build · v1
        </span>
      </div>
      {status === "loading" ? null : session ? (
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
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled className="opacity-100">
              {session.user?.email}
            </DropdownMenuItem>
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
