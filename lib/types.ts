export type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  approach: string | null;
  _count?: { accounts: number };
};

export type Account = {
  id: string;
  projectId: string;
  name: string;
  email: string | null;
  status: string;
  labels: string | null;
  lastContact: string | null;
  nextAction: string | null;
  notes: string | null;
  draftLink: string | null;
  notesLink: string | null;
};

// Append-only status history — see docs/ROADMAP.md §2.4.
// Hand-mirrored from prisma/schema.prisma; dates are strings because they cross JSON.
export type StatusEvent = {
  id: string;
  accountId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
};

export const STATUS_OPTIONS = [
  "Prospect",
  "Contacted",
  "Engaged",
  "Closed Won",
  "Closed Lost",
  "Rejected",
] as const;

export const STATUS_COLOR: Record<string, string> = {
  Prospect: "bg-slate-400",
  Contacted: "bg-amber-500",
  Engaged: "bg-blue-500",
  "Closed Won": "bg-green-500",
  "Closed Lost": "bg-red-500",
  Rejected: "bg-purple-500",
};
