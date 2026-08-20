"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Account, Project, STATUS_COLOR } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function AccountList({
  project,
  accounts,
  selectedAccountId,
  error,
  onRetry,
  onSelect,
  onCreated,
}: {
  project: Project | null;
  accounts: Account[];
  selectedAccountId: string | null;
  error: string | null;
  onRetry: () => void;
  onSelect: (id: string) => void;
  onCreated: (account: Account) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = accounts.filter((a) => {
    const q = query.toLowerCase();
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      (a.email ?? "").toLowerCase().includes(q) ||
      (a.labels ?? "").toLowerCase().includes(q)
    );
  });

  // An errored load must not render rows at all — see docs/ROADMAP.md task 1.l.
  const visible = error ? [] : filtered;

  async function createAccount() {
    if (!project || !name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, name, email }),
      });
      const account = await res.json();
      // Same silent-failure fix as project-sidebar's createProject: a failed POST used
      // to leave the dialog open with no message at all.
      if (!res.ok) {
        toast.error(account?.error ?? `Couldn't create that contact (${res.status}).`);
        return;
      }
      onCreated(account);
      setName("");
      setEmail("");
      setOpen(false);
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Select a project to see its accounts.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New account in {project.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="aname">Name</Label>
                <Input
                  id="aname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jamie Lee"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="aemail">Email</Label>
                <Input
                  id="aemail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jamie@example.com"
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createAccount} disabled={saving || !name.trim()}>
                Add account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="space-y-3 px-4 py-6 text-sm text-muted-foreground">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
        {!error && filtered.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {accounts.length === 0
              ? "No accounts in this project yet."
              : "No accounts match."}
          </p>
        )}
        {visible.map((a) => (
          <button
            key={a.id}
            onClick={() => onSelect(a.id)}
            className={cn(
              "block w-full border-b px-4 py-3 text-left transition-colors hover:bg-accent",
              selectedAccountId === a.id && "bg-accent"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{a.name}</span>
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  STATUS_COLOR[a.status] ?? "bg-slate-400"
                )}
                title={a.status}
              />
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {a.email || "no email on file"}
            </div>
            {a.nextActionDue && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                {/* Sliced, not formatted: the value is an ISO string crossing JSON,
                    and toLocaleDateString would render differently on server and
                    client. Same reason the queue does its own date arithmetic. */}
                due {a.nextActionDue.slice(0, 10)}
              </div>
            )}
            {a.labels && (
              <div className="mt-1 truncate text-[11px] text-muted-foreground">
                {a.labels}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
