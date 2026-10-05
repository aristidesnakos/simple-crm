"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Reply } from "lucide-react";
import { DELIVERY_PROBLEMS, Interaction } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One contact's email, both directions, for a business that sends through Resend
 * (docs/ROADMAP.md D23). The Resend counterpart of "Open conversation in Gmail": for these
 * businesses there is no Gmail copy, so this list is the conversation.
 *
 * Owns its fetch and is remounted by the parent's `key` (account id + mail version) rather
 * than syncing props into state from an effect — the pattern this repo's lint rules flag.
 *
 * Bodies render as plain text in a <pre>, never as HTML: inbound mail is written by
 * strangers.
 */
export function ConversationTimeline({
  accountId,
  onReply,
}: {
  accountId: string;
  onReply: (interaction: Interaction) => void;
}) {
  const [items, setItems] = useState<Interaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/interactions?accountId=${encodeURIComponent(accountId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Couldn't load the conversation (${r.status}).`);
        return (await r.json()) as Interaction[];
      })
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load the conversation.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!items) return <p className="text-xs text-muted-foreground">Loading…</p>;

  const emails = items.filter((i) => i.channel === "email");
  if (emails.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No email yet. Sent mail appears here at once; replies appear when you check for
        replies (the inbox button above the contact list).
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {emails.map((i, index) => {
        const inbound = i.direction === "inbound";
        const problem =
          !inbound &&
          (DELIVERY_PROBLEMS as readonly string[]).includes(i.deliveryStatus ?? "");
        return (
          <li key={i.id} className="rounded-lg border">
            <details open={index === 0}>
              <summary className="flex cursor-pointer list-none items-start gap-2 p-2.5">
                {inbound ? (
                  <ArrowDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
                ) : (
                  <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {i.subject ?? i.summary}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {inbound ? `From ${i.fromAddress ?? "unknown"}` : `To ${i.toAddress ?? "—"}`}
                    {" · "}
                    {/* Sliced, not formatted, like every other date in this app: an ISO
                        string crossing JSON, rendered identically on server and client. */}
                    {i.occurredAt.slice(0, 16).replace("T", " ")} UTC
                    {!inbound && i.deliveryStatus && (
                      <span className={cn("ml-1", problem && "font-medium text-destructive")}>
                        · {i.deliveryStatus}
                      </span>
                    )}
                  </span>
                </span>
              </summary>
              <div className="space-y-2 border-t px-2.5 pb-2.5 pt-2">
                <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap font-sans text-xs">
                  {i.body ?? "(no text)"}
                </pre>
                {inbound && (
                  <Button variant="outline" size="sm" onClick={() => onReply(i)}>
                    <Reply className="h-3.5 w-3.5" />
                    Reply
                  </Button>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
