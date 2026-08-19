"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Account, KINDS, Project } from "@/lib/types";
import { defaultStatusFor, statusOptionsFor } from "@/lib/contacts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Mail, ExternalLink, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";

export function AccountDetail({
  account,
  project,
  projects,
  onUpdated,
}: {
  account: Account | null;
  project: Project | null;
  projects: Project[];
  onUpdated: (account: Account) => void;
}) {
  const { data: session } = useSession();
  const [local, setLocal] = useState<Account | null>(account);
  const [composeOpen, setComposeOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    setLocal(account);
    setComposeOpen(false);
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyed on the project as well as the account: switching project without
  // switching account used to leave the previous project's template in the
  // composer. See docs/ROADMAP.md task 1.n.
  useEffect(() => {
    if (account) {
      setSubject(`Following up${project ? ` — ${project.name}` : ""}`);
      setBody(project?.approach ? `${project.approach}\n\n` : "");
    }
  }, [account?.id, project?.id, project?.name, project?.approach]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!local) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Select an account to see details.
      </div>
    );
  }

  async function patch(fields: Partial<Account>) {
    const before = local!;
    setLocal({ ...before, ...fields } as Account);
    try {
      const res = await fetch(`/api/accounts/${before.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`Couldn't save that change (${res.status}).`);
      const updated = (await res.json()) as Account;
      onUpdated(updated);
    } catch (err: unknown) {
      // Without this the optimistic value stayed on screen looking saved — including
      // a project move that never actually happened. See docs/ROADMAP.md task 1.n.
      setLocal(before);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save that change."
      );
    }
  }

  // Each pipeline has its own status vocabulary, so switching kind can strand the
  // current status outside the new list — the Select would render blank while the
  // stored value stayed valid-looking in the database. Move both together instead.
  async function changeKind(kind: string) {
    const stillValid = statusOptionsFor(kind).includes(local!.status);
    if (stillValid) {
      await patch({ kind });
      return;
    }
    const status = defaultStatusFor(kind);
    await patch({ kind, status });
    toast.info(`Status reset to "${status}" — the ${kind} pipeline has its own stages.`);
  }

  // Fills the composer; it does not create or send anything. The human still reviews,
  // edits, and presses the Gmail button — see docs/ROADMAP.md task 1.14.
  async function composeWithLlm() {
    setDrafting(true);
    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: local!.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't draft that email.");
        return;
      }
      setSubject(data.subject);
      setBody(data.body);
      if (data.rationale) toast.info(data.rationale);
    } catch {
      toast.error("Couldn't reach the drafting service.");
    } finally {
      setDrafting(false);
    }
  }

  async function createDraft() {
    if (!local!.email) {
      toast.error("This account has no email address on file.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/gmail/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: local!.id,
          to: local!.email,
          subject,
          body,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't create the draft.");
        return;
      }
      toast.success("Draft created in Gmail.");
      onUpdated({ ...local!, draftLink: data.draftLink });
      setLocal((l) => (l ? { ...l, draftLink: data.draftLink } : l));
      setComposeOpen(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <Input
            className="border-none px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
            value={local.name}
            onChange={(e) => setLocal({ ...local, name: e.target.value })}
            onBlur={() => patch({ name: local.name })}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select
              value={local.projectId}
              onValueChange={(v) => patch({ projectId: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="No project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Pipeline</Label>
            <Select value={local.kind} onValueChange={changeKind}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={local.status}
              onValueChange={(v) => patch({ status: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptionsFor(local.kind).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input
            value={local.email ?? ""}
            onChange={(e) => setLocal({ ...local, email: e.target.value })}
            onBlur={() => patch({ email: local.email })}
            placeholder="name@example.com"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Labels</Label>
          <Input
            value={local.labels ?? ""}
            onChange={(e) => setLocal({ ...local, labels: e.target.value })}
            onBlur={() => patch({ labels: local.labels })}
            placeholder="warm, referral, JLPT-N5"
          />
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-4">
          <div className="space-y-1.5">
            <Label>Next action</Label>
            <Input
              value={local.nextAction ?? ""}
              onChange={(e) =>
                setLocal({ ...local, nextAction: e.target.value })
              }
              onBlur={() => patch({ nextAction: local.nextAction })}
              placeholder="Send waitlist intro email"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Due</Label>
            {/* Patched on change rather than on blur, following the Select: a date
                picker commits on selection, and waiting for a blur that may never
                come would silently drop the edit. */}
            <Input
              type="date"
              className="w-40"
              value={local.nextActionDue?.slice(0, 10) ?? ""}
              onChange={(e) => patch({ nextActionDue: e.target.value || null })}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Textarea
            rows={4}
            value={local.notes ?? ""}
            onChange={(e) => setLocal({ ...local, notes: e.target.value })}
            onBlur={() => patch({ notes: local.notes })}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Notes link (optional)</Label>
          <Input
            value={local.notesLink ?? ""}
            onChange={(e) => setLocal({ ...local, notesLink: e.target.value })}
            onBlur={() => patch({ notesLink: local.notesLink })}
            placeholder="https://..."
          />
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <Mail className="h-4 w-4" /> Email draft
            </h3>
            {local.draftLink && (
              <a
                href={local.draftLink}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                Open in Gmail <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {!session && (
            <p className="text-xs text-muted-foreground">
              Sign in with Google (top right) to create real Gmail drafts from
              here.
            </p>
          )}

          {session && !composeOpen && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setComposeOpen(true)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {local.draftLink ? "Draft another follow-up" : "Draft an email"}
            </Button>
          )}

          {session && composeOpen && (
            <div className="space-y-2 rounded-lg border p-3">
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
              />
              <Textarea
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Draft body — pre-filled from the project's email approach"
              />
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={composeWithLlm}
                  disabled={drafting}
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  {drafting ? "Drafting…" : "Draft with AI"}
                </Button>
                <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setComposeOpen(false)}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={createDraft} disabled={sending}>
                  {sending ? "Creating…" : "Create Gmail draft"}
                </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
