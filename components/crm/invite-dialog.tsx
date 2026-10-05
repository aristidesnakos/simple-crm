"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Account, CONSENT_FIRST_JURISDICTIONS, Project } from "@/lib/types";
import {
  firstNameOf,
  formatFrom,
  renderTemplate,
  unresolvedPlaceholders,
} from "@/lib/outreach";
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
import { cn } from "@/lib/utils";

/**
 * Invite the waitlist: one message, written once, sent to every selected signup through
 * Resend (docs/ROADMAP.md D23). The batch counterpart of the composer's Send.
 *
 * The preview IS the message. Templates are rendered here, with the same renderTemplate the
 * route trusts, and the server receives the rendered text — it adds only the footer, which
 * is shown below the preview from the same builder. Nothing is substituted after the
 * operator has seen it.
 *
 * Every RS-01 gate is still enforced server-side per recipient. What this dialog does is
 * make the gates visible before the click: opted-out and address-less contacts cannot be
 * selected, and a consent-first contact with no consent date is opt-in per row with the
 * consequence spelled out — ticking that box is the acknowledgement the route asks for.
 *
 * Mounted only while open and keyed on the project, like ProjectSettingsDialog, so the
 * selection and template seed from props without an effect.
 */
export function InviteDialog({
  project,
  accounts,
  open,
  onOpenChange,
  onSent,
}: {
  project: Project;
  accounts: Account[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (updated: Account[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        {open && (
          <InviteForm
            key={project.id}
            project={project}
            accounts={accounts}
            onSent={onSent}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// The waitlist is the customer pipeline (docs/ROADMAP.md D15); its first stage is the only
// one an invite is for. Anyone further along is listed but starts unticked.
const INVITE_STAGE = "Signed Up";

type Row = {
  account: Account;
  blocked: string | null; // why it cannot be selected at all
  needsAck: boolean; // consent-first jurisdiction with no consent on file
};

type RowResult = { ok: boolean; message?: string };

function storageKey(projectId: string) {
  return `crm:invite-template:${projectId}`;
}

// Per-viewer convenience only: a half-written invite survives closing the dialog by
// accident. Wrapped because storage can be unavailable, and the form must work without it.
function loadTemplate(projectId: string): { subject: string; body: string } {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (raw) return JSON.parse(raw);
  } catch {
    // fall through to the empty template
  }
  return { subject: "", body: "Hi {{firstName}},\n\n" };
}

function saveTemplate(projectId: string, value: { subject: string; body: string }) {
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(value));
  } catch {
    // not worth a toast
  }
}

function InviteForm({
  project,
  accounts,
  onSent,
}: {
  project: Project;
  accounts: Account[];
  onSent: (updated: Account[]) => void;
}) {
  const rows: Row[] = useMemo(
    () =>
      accounts
        .filter((a) => a.kind === "customer")
        .map((a) => ({
          account: a,
          blocked: a.optedOutAt
            ? `opted out ${a.optedOutAt.slice(0, 10)}`
            : !a.email
              ? "no email on file"
              : null,
          needsAck:
            (CONSENT_FIRST_JURISDICTIONS as readonly string[]).includes(
              a.jurisdiction ?? ""
            ) && !a.consentedAt,
        })),
    [accounts]
  );

  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        rows
          .filter((r) => !r.blocked && !r.needsAck && r.account.status === INVITE_STAGE)
          .map((r) => r.account.id)
      )
  );
  const [template, setTemplate] = useState(() => loadTemplate(project.id));
  const [previewId, setPreviewId] = useState<string | null>(
    () => rows.find((r) => selected.has(r.account.id))?.account.id ?? rows[0]?.account.id ?? null
  );
  const [results, setResults] = useState<Map<string, RowResult>>(new Map());
  const [sending, setSending] = useState(false);
  const [footer, setFooter] = useState<{ footer: string | null; problem: string | null } | null>(
    null
  );

  // Same source as the composer's preview: the route's own footer builder.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/outreach/footer")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setFooter(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function updateTemplate(next: { subject: string; body: string }) {
    setTemplate(next);
    saveTemplate(project.id, next);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPreviewId(id);
  }

  const from = formatFrom(project);
  const preview = rows.find((r) => r.account.id === previewId)?.account ?? null;
  const unresolved = unresolvedPlaceholders(
    renderTemplate(`${template.subject}\n${template.body}`, { name: "x" })
  );
  const noFirstName = rows.filter(
    (r) => selected.has(r.account.id) && !firstNameOf(r.account.name)
  );

  const problem = !from
    ? "This project has no Send-from address. Set one in project settings."
    : footer?.problem
      ? footer.problem
      : !template.subject.trim()
        ? "Write a subject."
        : !template.body.replace(/\{\{[^}]*\}\}/g, "").replace(/^Hi\s*,?\s*$/m, "").trim()
          ? "Write the message."
          : unresolved.length
            ? `Unknown placeholder ${unresolved.join(", ")} — only {{firstName}} and {{name}} are filled in.`
            : selected.size === 0
              ? "Select at least one recipient."
              : null;

  async function send() {
    const chosen = rows.filter((r) => selected.has(r.account.id));
    const ok = window.confirm(
      `Send ${chosen.length} email${chosen.length === 1 ? "" : "s"} now from ${from}?\n\n` +
        "They go out immediately. There is no Gmail draft to review and no way to recall them."
    );
    if (!ok) return;

    setSending(true);
    try {
      const res = await fetch("/api/resend/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sends: chosen.map((r) => ({
            accountId: r.account.id,
            subject: renderTemplate(template.subject, r.account),
            body: renderTemplate(template.body, r.account),
            // Ticking a row whose warning says "selecting this confirms you have a basis"
            // is the acknowledgement. Never sent for a row without that warning.
            ...(r.needsAck ? { acknowledgeJurisdiction: true } : {}),
          })),
        }),
      });
      // res.ok before res.json(): a request-level failure (no key, no footer identity) is
      // JSON, but an unhandled one is an HTML page.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? `Couldn't send (${res.status}).`);
        return;
      }
      const { results: list } = (await res.json()) as {
        results: (
          | { accountId: string; ok: true; account: Account; warning?: string }
          | { accountId: string; ok: false; error: string }
        )[];
      };

      const next = new Map(results);
      const sent: Account[] = [];
      for (const r of list) {
        if (r.ok) {
          next.set(r.accountId, { ok: true, message: r.warning });
          sent.push(r.account);
        } else {
          next.set(r.accountId, { ok: false, message: r.error });
        }
      }
      setResults(next);
      // Sent rows leave the selection, so pressing Send again after a partial failure
      // retries only the failures.
      setSelected((prev) => new Set([...prev].filter((id) => !next.get(id)?.ok)));
      if (sent.length) onSent(sent);

      const failed = list.length - sent.length;
      if (failed === 0) toast.success(`Sent ${sent.length} invite${sent.length === 1 ? "" : "s"}.`);
      else toast.error(`Sent ${sent.length}, ${failed} failed — see the list for why.`);
    } catch {
      toast.error("Couldn't reach the server. Check the list before sending again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Invite waitlist signups — {project.name}</DialogTitle>
        <DialogDescription>
          Sent from {from ?? "—"} through Resend. Replies come back into each contact&apos;s
          conversation when you check for replies.
        </DialogDescription>
      </DialogHeader>

      <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Recipients */}
        <div className="min-w-0 space-y-1.5">
          <Label>
            Recipients · {selected.size} of {rows.filter((r) => !r.blocked).length} selected
          </Label>
          <div className="max-h-[55vh] divide-y overflow-y-auto rounded-lg border">
            {rows.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">
                No customer-pipeline contacts in this project.
              </p>
            )}
            {rows.map((r) => {
              const result = results.get(r.account.id);
              return (
                <label
                  key={r.account.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 px-3 py-2",
                    previewId === r.account.id && "bg-accent",
                    r.blocked && "cursor-not-allowed opacity-60"
                  )}
                  onMouseEnter={() => !r.blocked && setPreviewId(r.account.id)}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-foreground"
                    checked={selected.has(r.account.id)}
                    disabled={Boolean(r.blocked) || sending}
                    onChange={() => toggle(r.account.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.account.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.account.email ?? "—"} · {r.account.status}
                    </span>
                    {r.blocked && (
                      <span className="block text-[11px] text-muted-foreground">{r.blocked}</span>
                    )}
                    {!r.blocked && r.needsAck && (
                      <span className="block text-[11px] text-amber-700">
                        {r.account.jurisdiction}: no consent on file. Selecting confirms you have
                        a basis to email them.
                      </span>
                    )}
                    {result && (
                      <span
                        className={cn(
                          "block text-[11px]",
                          result.ok ? "text-green-700" : "text-destructive"
                        )}
                      >
                        {result.ok ? `Sent${result.message ? ` — ${result.message}` : ""}` : result.message}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Template + preview */}
        <div className="min-w-0 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="isubject">Subject</Label>
            <Input
              id="isubject"
              value={template.subject}
              onChange={(e) => updateTemplate({ ...template, subject: e.target.value })}
              placeholder="Your invite to Mangood"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ibody">
              Message <span className="font-normal text-muted-foreground">· {"{{firstName}}"} and {"{{name}}"} are filled in per person</span>
            </Label>
            <Textarea
              id="ibody"
              rows={8}
              value={template.body}
              onChange={(e) => updateTemplate({ ...template, body: e.target.value })}
            />
          </div>

          {preview && (
            <div className="space-y-1 rounded-lg border bg-muted/30 p-3">
              <p className="text-[11px] font-medium text-muted-foreground">
                Exactly what {preview.name} receives
              </p>
              <p className="text-xs">
                <span className="text-muted-foreground">To:</span> {preview.email ?? "—"}
              </p>
              <p className="text-xs">
                <span className="text-muted-foreground">Subject:</span>{" "}
                {renderTemplate(template.subject, preview)}
              </p>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap pt-1 font-sans text-xs">
                {renderTemplate(template.body, preview).trimEnd()}
                {footer?.footer && (
                  <span className="text-muted-foreground">{`\n\n${footer.footer}`}</span>
                )}
              </pre>
            </div>
          )}

          {noFirstName.length > 0 && (
            <p className="text-xs text-amber-700">
              No usable first name for {noFirstName.map((r) => r.account.name).join(", ")} —
              {" {{firstName}}"} becomes &quot;there&quot; for them.
            </p>
          )}
        </div>
      </div>

      <DialogFooter className="items-center gap-2 sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {problem ?? "Each person gets their own email. Opted-out contacts are refused by the server regardless."}
        </p>
        <Button onClick={send} disabled={sending || Boolean(problem)}>
          {sending ? "Sending…" : `Send ${selected.size} invite${selected.size === 1 ? "" : "s"}`}
        </Button>
      </DialogFooter>
    </>
  );
}
