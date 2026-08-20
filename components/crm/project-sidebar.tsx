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
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProjectSidebar({
  projects,
  selectedProjectId,
  onSelect,
  onCreated,
}: {
  projects: Project[];
  selectedProjectId: string | null;
  onSelect: (id: string) => void;
  onCreated: (project: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [approach, setApproach] = useState("");
  const [saving, setSaving] = useState(false);

  async function createProject() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, approach }),
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
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={cn(
              "mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
              selectedProjectId === p.id && "bg-accent"
            )}
          >
            <div className="font-medium truncate">{p.name}</div>
            <div className="text-xs text-muted-foreground">
              {p._count?.accounts ?? 0} account
              {(p._count?.accounts ?? 0) === 1 ? "" : "s"} · {p.status}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
