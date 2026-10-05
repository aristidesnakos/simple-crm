"use client";

import { toast } from "sonner";
import type { Account } from "@/lib/types";

// The client half of POST /api/resend/sync, shared by the contact list and /queue so the
// two buttons report a sync identically. Owns the fetch and the toasts; the caller owns
// what to do with the rows (CrmApp splices them, the queue refetches itself).

export type SyncResult = {
  imported: number;
  ignored: number;
  unmatched: { from: string | null; subject: string; receivedAt: string }[];
  optedOut: { accountId: string; name: string }[];
  deliveryProblems: { accountId: string; name: string; status: string }[];
  accounts: Account[];
  checkedAt: string;
};

export async function checkReplies(): Promise<SyncResult | null> {
  try {
    const res = await fetch("/api/resend/sync", { method: "POST" });
    // res.ok before res.json(): an unhandled server error is an HTML page.
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? `Couldn't check for replies (${res.status}).`);
      return null;
    }
    const result = (await res.json()) as SyncResult;

    // Opt-outs and bounces first and loudest: each one changes what the operator may or
    // can do next, which a reply count does not.
    for (const o of result.optedOut) {
      toast.warning(`${o.name} asked to stop. Recorded as an opt-out across every project.`, {
        duration: 15000,
      });
    }
    for (const p of result.deliveryProblems) {
      toast.error(`Email to ${p.name}: ${p.status}.`, { duration: 15000 });
    }
    if (result.unmatched.length) {
      toast.info(
        `${result.unmatched.length} recent email${
          result.unmatched.length === 1 ? "" : "s"
        } from addresses not in the CRM: ` +
          result.unmatched
            .slice(0, 3)
            .map((u) => `${u.from ?? "unknown"} — "${u.subject}"`)
            .join("; ") +
          ". Read them in the Resend dashboard.",
        { duration: 15000 }
      );
    }
    const replies = result.imported - result.optedOut.length;
    if (replies > 0) {
      toast.success(`${replies} new repl${replies === 1 ? "y" : "ies"}.`);
    } else if (!result.optedOut.length && !result.deliveryProblems.length) {
      toast.info("No new replies.");
    }
    return result;
  } catch {
    toast.error("Couldn't reach the server.");
    return null;
  }
}
