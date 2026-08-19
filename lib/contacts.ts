import {
  DEFAULT_KIND,
  STATUS_OPTIONS_BY_KIND,
} from "@/lib/types";

// Contact-domain logic. lib/types.ts holds the shape and the vocabularies; this holds
// the behavior. Kept out of lib/utils.ts, which is the stock shadcn `cn` and nothing
// else — mixing domain rules into it would make that file a junk drawer.

// Addresses arrive from CSV exports, pasted sheets, and a free-text input, so casing
// and stray whitespace are the norm rather than the exception. The `|| null` also
// stops an empty input from persisting "" — which is not null, so it defeats every
// "has no email" check while looking identical in the UI.
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase() || null;
}

// Falls back to the default kind's list rather than returning empty: an unrecognized
// kind should still render a usable picker, since nothing validates kind server-side.
export function statusOptionsFor(kind: string | null | undefined): readonly string[] {
  return (
    STATUS_OPTIONS_BY_KIND[kind ?? ""] ?? STATUS_OPTIONS_BY_KIND[DEFAULT_KIND]
  );
}

// The first status a new contact should hold, which differs per pipeline. The schema
// default is "Prospect" for both because a column default cannot branch; every write
// path through the API sets this explicitly instead.
export function defaultStatusFor(kind: string | null | undefined): string {
  return statusOptionsFor(kind)[0];
}
