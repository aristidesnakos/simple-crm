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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Edit an existing project. Mirrors the fields of the create dialog in
 * `project-sidebar.tsx` — the only way `fromEmail` was previously settable was the
 * API or Prisma Studio, so a project created before that field existed had no way to
 * get a sending identity.
 *
 * Deliberately has no delete: `DELETE /api/projects/[id]` cascade-deletes every
 * contact and status event under the project, so it doesn't belong behind a gear icon.
 */
export function ProjectSettingsDialog({
  project,
  open,
  onOpenChange,
  onUpdated,
}: {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (project: Project) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Rendering the form only while open — and keying it on the project — is what
            seeds the inputs. The alternative, an effect that copies props into state,
            is the pattern `account-detail` uses and the one this repo's lint rules
            flag; here every open is a fresh mount, so there is nothing to sync. */}
        {open && project && (
          <ProjectSettingsForm
            key={project.id}
            project={project}
            onOpenChange={onOpenChange}
            onUpdated={onUpdated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProjectSettingsForm({
  project,
  onOpenChange,
  onUpdated,
}: {
  project: Project;
  onOpenChange: (open: boolean) => void;
  onUpdated: (project: Project) => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [approach, setApproach] = useState(project.approach ?? "");
  const [fromEmail, setFromEmail] = useState(project.fromEmail ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, approach, fromEmail }),
      });
      // Checked before parsing: the PATCH route has no error handling, so a bad id
      // surfaces as an HTML 500 that would make res.json() throw on the happy path.
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        toast.error(
          payload?.error ?? `Couldn't save that project (${res.status}).`
        );
        return;
      }
      onUpdated(await res.json());
      onOpenChange(false);
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Project settings</DialogTitle>
        <DialogDescription>
          {project._count?.accounts ?? 0} contact
          {(project._count?.accounts ?? 0) === 1 ? "" : "s"} · {project.status}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="epname">Name</Label>
          <Input
            id="epname"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="epdesc">Description</Label>
          <Textarea
            id="epdesc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="epapproach">Email approach / template</Label>
          <Textarea
            id="epapproach"
            value={approach}
            onChange={(e) => setApproach(e.target.value)}
            rows={3}
            placeholder="What Claude should draw on when drafting outreach for this project"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="epfrom">Send from</Label>
          <Input
            id="epfrom"
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
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || !name.trim()}>
          Save changes
        </Button>
      </DialogFooter>
    </>
  );
}
