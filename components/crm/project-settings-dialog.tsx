"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Project, SEND_VIA, SEND_VIA_LABEL } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      {/* Scrolls: a long approach brief plus the sending fields outgrows a laptop screen,
          and the Save button must never end up below the fold. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto">
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
  const [fromName, setFromName] = useState(project.fromName ?? "");
  const [sendVia, setSendVia] = useState(project.sendVia || "gmail");
  const viaResend = sendVia === "resend";
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          approach,
          fromEmail,
          fromName,
          sendVia,
        }),
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
          <Label htmlFor="epvia">Sends through</Label>
          <Select value={sendVia} onValueChange={setSendVia}>
            <SelectTrigger id="epvia" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEND_VIA.map((v) => (
                <SelectItem key={v} value={v}>
                  {SEND_VIA_LABEL[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {viaResend
              ? "Mail is sent from the CRM and replies come back into it. Nothing appears in Gmail. The address below must be on a domain verified in Resend."
              : "The CRM creates a draft in your Gmail; you review and send it there."}
          </p>
        </div>
        <div className="grid grid-cols-[2fr_3fr] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="epfromname">Sender name</Label>
            <Input
              id="epfromname"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="e.g. Ari"
              disabled={!viaResend}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="epfrom">Send from</Label>
            <Input
              id="epfrom"
              type="email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder={viaResend ? "e.g. ari@mail.mangood.app" : "e.g. hello@mangood.app"}
            />
          </div>
        </div>
        {!viaResend && (
          <p className="text-xs text-muted-foreground">
            The From: address on drafts for this project. Leave blank to use the
            signed-in mailbox. Gmail rejects an address that isn&apos;t a verified
            send-as alias on that account.
          </p>
        )}
        {viaResend && !fromEmail.trim() && (
          <p className="text-xs text-destructive">
            Resend needs a Send-from address. Nothing can be sent until one is set.
          </p>
        )}
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
