"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Account, OPT_OUT_SOURCES } from "@/lib/types";
import { Button } from "@/components/ui/button";
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
 * Record a do-not-contact request. One deliberate action, one POST.
 *
 * Its own dialog and its own route rather than another field on the auto-saving detail
 * form, and that separation is the whole point. `account-detail`'s `patch()` has no
 * in-flight guard (docs/ROADMAP.md E6), so a slow PATCH resolving after a fast one
 * overwrites the newer edit with its stale response. That is an accepted defect for a
 * label or a note. A lost opt-out is the exact failure this whole effort exists to
 * prevent, and it would be invisible.
 *
 * Posting to a different route against a different table makes suppression structurally
 * unreachable by that race, rather than relying on a future editor remembering not to
 * wire it through `patch()`.
 *
 * The consequence is that `patch()`'s rollback-and-toast does not cover this, so it
 * carries its own error handling. Modelled on `composeWithLlm`, which has the right shape.
 */
export function OptOutDialog({
  account,
  open,
  onOpenChange,
  onSuppressed,
}: {
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Receives the ids of every account the suppression now covers — which is more than
  // the one on screen whenever the same person appears in another campaign. CrmApp owns
  // the arrays and nothing refetches, so the caller has to splice all of them.
  onSuppressed: (optedOutAt: string, affectedIds: string[]) => void;
}) {
  const [source, setSource] = useState<string>("reply");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/suppressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email, source, note: note.trim() || null }),
      });
      // res.ok before res.json(): a 500 here is Next's HTML error page, and parsing that
      // throws. Without the catch below the button would just stop spinning.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Couldn't record that opt-out.");
        return;
      }
      const data = await res.json();
      onSuppressed(
        data.suppression.optedOutAt,
        data.affected.map((a: { id: string }) => a.id)
      );
      const others = data.affected.length - 1;
      toast.success(
        others > 0
          ? `${account.name} opted out. Also applied to ${others} contact${
              others === 1 ? "" : "s"
            } in other campaigns.`
          : `${account.name} opted out.`
      );
      setNote("");
      onOpenChange(false);
    } catch {
      toast.error("Couldn't reach the server. The opt-out was not recorded.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record an opt-out</DialogTitle>
          <DialogDescription>
            {account.email} will be removed from the queue and no draft can be
            created for them — in this campaign and every other one. This is kept
            permanently, including if the contact is later deleted.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="oosource">How did it arrive?</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger id="oosource" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPT_OUT_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oonote">What did they say?</Label>
            <Textarea
              id="oonote"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Their actual words, where you have them. This is the evidence."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={submit} disabled={saving}>
            {saving ? "Recording…" : "Record opt-out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
