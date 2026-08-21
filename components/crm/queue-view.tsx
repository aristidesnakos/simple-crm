"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { QueueRow, STATUS_COLOR } from "@/lib/types";
import { TopBar } from "@/components/crm/top-bar";
import { DevFeedback } from "@/components/dev/dev-feedback";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;

function daysBetween(iso: string, now: number) {
  return Math.floor((now - new Date(iso).getTime()) / DAY);
}

// The right-hand label, and how loud it should be. A due date that has passed is a
// commitment already broken, so it outranks a contact who has merely been waiting.
function urgency(row: QueueRow, now: number) {
  if (row.nextActionDue) {
    const overdue = daysBetween(row.nextActionDue, now);
    if (overdue <= 0) return { label: "due today", tone: "text-amber-600" };
    return {
      label: `${overdue} ${overdue === 1 ? "day" : "days"} overdue`,
      tone: "text-red-600",
    };
  }
  const waiting = daysBetween(row.lastContact ?? row.createdAt, now);
  return {
    label: row.lastContact
      ? `${waiting}d since contact`
      : `waiting ${waiting}d`,
    tone: waiting >= 90 ? "text-red-600" : "text-muted-foreground",
  };
}

export function QueueView() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  // Stamped when the rows arrive rather than read during render. Every "N days
  // overdue" on screen is then measured against one instant — the fetch — instead of
  // drifting each time React happens to re-render.
  const [loadedAt, setLoadedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/queue")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Couldn't load the queue (${r.status}).`);
        return (await r.json()) as QueueRow[];
      })
      .then((data) => {
        setRows(data);
        setLoadedAt(Date.now());
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Couldn't load the queue.")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex h-full flex-col">
      <DevFeedback name="Crm.TopBar">
        <TopBar />
      </DevFeedback>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DevFeedback name="Queue.List">
          <div className="mx-auto max-w-3xl px-6 py-8">
            <div className="mb-6">
              <h1 className="text-xl font-semibold">Queue</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Every open loop, across every project. Contacts whose next action is
                due, overdue, or never set.
              </p>
            </div>

            {loading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}

            {error && (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLoading(true);
                    setError(null);
                    load();
                  }}
                >
                  Try again
                </Button>
              </div>
            )}

            {!loading && !error && rows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing open. Every contact either has a future due date or a status
                that means no action is owed.
              </p>
            )}

            {!loading && !error && rows.length > 0 && (
              <div className="divide-y rounded-lg border">
                {rows.map((row) => {
                  const { label, tone } = urgency(row, loadedAt);
                  return (
                    <Link
                      key={row.id}
                      href={`/?project=${row.projectId}&account=${row.id}`}
                      className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              STATUS_COLOR[row.status] ?? "bg-slate-400"
                            )}
                            title={row.status}
                          />
                          <span className="truncate text-sm font-medium">
                            {row.name}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {row.project.name}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {row.nextAction || "No next action set"}
                        </div>
                        {!row.email && (
                          <div className="mt-1 text-[11px] text-amber-600">
                            No email address on file
                          </div>
                        )}
                      </div>
                      <span
                        className={cn("shrink-0 text-xs tabular-nums", tone)}
                      >
                        {label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </DevFeedback>
      </div>
    </div>
  );
}
