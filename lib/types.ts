export type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  approach: string | null;
  fromEmail: string | null;
  _count?: { accounts: number };
};

export type Account = {
  id: string;
  projectId: string;
  name: string;
  email: string | null;
  kind: string;
  status: string;
  labels: string | null;
  lastContact: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  notes: string | null;
  draftLink: string | null;
  notesLink: string | null;
};

// A queue row is an Account plus the project it belongs to. /api/queue reads across
// every project, so unlike the account list it cannot infer the project from context.
export type QueueRow = Account & {
  // createdAt is absent from Account (nothing rendered it before) but the queue needs
  // it: a contact with no lastContact has still been waiting since they arrived.
  createdAt: string;
  project: { id: string; name: string };
};

// Append-only status history — see docs/ROADMAP-v2-archive.md §2.4.
// Hand-mirrored from prisma/schema.prisma; dates are strings because they cross JSON.
export type StatusEvent = {
  id: string;
  accountId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
};

// Interaction log vocabulary. The `Interaction` table is migrated and the API is not
// built yet — the log UI is deliberately deferred until after the first real sends
// (docs/ROADMAP.md §7), because a timeline is worth more built against real replies
// than against an empty table. This constant exists now because prisma/schema.prisma's
// comment on `Interaction.channel` names it as the source of truth for the allowed
// values, and a schema comment pointing at nothing is how vocabularies drift.
//
// Free text server-side like every other status here, so treat this as the picker's
// list rather than a guarantee about what is in the column.
export const INTERACTION_CHANNELS = ["email", "call", "meeting", "note"] as const;

// Notes have no direction; everything else does.
export const INTERACTION_DIRECTIONS = ["outbound", "inbound"] as const;

// Hand-mirrored from prisma/schema.prisma, like StatusEvent above. Dates are strings
// because they cross JSON. `threadId` is null for everything written by hand and is
// the hook the deferred Gmail thread index attaches to.
export type Interaction = {
  id: string;
  accountId: string;
  channel: string;
  direction: string | null;
  occurredAt: string;
  summary: string;
  threadId: string | null;
};

export const KINDS = ["customer", "collaborator"] as const;
export const DEFAULT_KIND = "customer";

// Two pipelines, two vocabularies (docs/ROADMAP.md D15). A single list was sales
// vocabulary applied to both: "Closed Won" is meaningless for a waitlist signup and
// "Rejected" is actively wrong. Display strings are what get stored — no slugs.
export const STATUS_OPTIONS_BY_KIND: Record<string, readonly string[]> = {
  customer: ["Signed Up", "Emailed", "Replied", "Onboarded", "Dormant"],
  collaborator: [
    "Prospect",
    "Contacted",
    "Engaged",
    "Closed Won",
    "Closed Lost",
    "Rejected",
    "Parked",
  ],
};

// Statuses meaning "no action is owed here". /api/queue excludes them, which is the
// only thing keeping the queue short enough to be worked through: roughly a third of
// the collaborator list is blocked on a precondition rather than on outreach.
export const QUEUE_EXCLUDED_STATUSES = [
  "Parked",
  "Dormant",
  "Onboarded",
  "Closed Won",
  "Closed Lost",
  "Rejected",
] as const;

// Keyed loosely rather than to the option lists because status is unvalidated free
// text server-side; the `?? "bg-slate-400"` fallback at the call site is load-bearing.
// Values must stay literal Tailwind classes so the scanner can find them.
export const STATUS_COLOR: Record<string, string> = {
  // customer
  "Signed Up": "bg-slate-400",
  Emailed: "bg-amber-500",
  Replied: "bg-blue-500",
  Onboarded: "bg-green-500",
  Dormant: "bg-stone-400",
  // collaborator
  Prospect: "bg-slate-400",
  Contacted: "bg-amber-500",
  Engaged: "bg-blue-500",
  "Closed Won": "bg-green-500",
  "Closed Lost": "bg-red-500",
  Rejected: "bg-purple-500",
  Parked: "bg-zinc-500",
};
