"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Settings2 } from "lucide-react";
import { ProjectSettingsDialog } from "@/components/crm/project-settings-dialog";
import { cn } from "@/lib/utils";

export function ProjectSidebar({
  projects,
  selectedProjectId,
  onSelect,
  onCreated,
  onUpdated,
}: {
  projects: Project[];
  selectedProjectId: string | null;
  onSelect: (id: string) => void;
  onCreated: (project: Project) => void;
  onUpdated: (project: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [approach, setApproach] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [saving, setSaving] = useState(false);
  // Which project the settings dialog is editing; null means it's closed.
  const [editing, setEditing] = useState<Project | null>(null);

  async function createProject() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, approach, fromEmail }),
      });
      const project = await res.json();
      // Without the res.ok check this swallowed every server error: the POST returned
      // a body-less 500, res.json() threw, and the rejection went unhandled — the
      // dialog just sat there and the user retried the same input forever.
      if (!res.ok) {
        toast.error(project?.error ?? `Couldn't create that project (${res.status}).`);
        return;
      }
      onCreated({ ...project, _count: { accounts: 0 } });
      setName("");
      setDescription("");
      setApproach("");
      setFromEmail("");
      setOpen(false);
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Projects
        </span>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="icon" variant="ghost" className="h-6 w-6">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New project</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pname">Name</Label>
                <Input
                  id="pname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Michi Manga Pilot"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pdesc">Description</Label>
                <Textarea
                  id="pdesc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="papproach">Email approach / template</Label>
                <Textarea
                  id="papproach"
                  value={approach}
                  onChange={(e) => setApproach(e.target.value)}
                  rows={3}
                  placeholder="What Claude should draw on when drafting outreach for this project"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pfrom">Send from</Label>
                <Input
                  id="pfrom"
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="e.g. hello@mangood.app"
                />
                <p className="text-xs text-muted-foreground">
                  The From: address on drafts for this project. Leave blank to use the
                  signed-in mailbox. Gmail rejects an address that isn&apos;t a verified
                  send-as alias on that account.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createProject} disabled={saving || !name.trim()}>
                Create project
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {projects.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            No projects yet. Add your first one.
          </p>
        )}
        {projects.map((p) => (
          // The row is a wrapper rather than a bare button because the gear is a
          // second control: a button can't be nested inside a button.
          <div key={p.id} className="group relative mb-1">
            <button
              onClick={() => onSelect(p.id)}
              className={cn(
                "w-full rounded-md py-2 pl-3 pr-9 text-left text-sm transition-colors hover:bg-accent",
                selectedProjectId === p.id && "bg-accent"
              )}
            >
              <div className="font-medium truncate">{p.name}</div>
              <div className="text-xs text-muted-foreground">
                {p._count?.accounts ?? 0} account
                {(p._count?.accounts ?? 0) === 1 ? "" : "s"} · {p.status}
              </div>
            </button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Settings for ${p.name}`}
              onClick={() => setEditing(p)}
              // Hidden until hover, but focus-visible keeps it reachable by keyboard.
              className="absolute right-1 top-1.5 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <ProjectSettingsDialog
        project={editing}
        open={editing !== null}
        onOpenChange={(next) => !next && setEditing(null)}
        onUpdated={onUpdated}
      />
    </div>
  );
}
