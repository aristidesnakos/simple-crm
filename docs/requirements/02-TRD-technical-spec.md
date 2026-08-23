# 02 — TRD: Technical Specification

**Set:** RS-01 · **Status:** Draft for engineering review · **Opened:** 2026-08-21
**Owner:** Tech Lead · **Implements:** [01-PRD](01-PRD-outreach-compliance.md) REQ-01 … REQ-18
**Verification:** [05-QA-VERIFICATION](05-QA-VERIFICATION.md) · **Tickets:** [03-DELIVERY-PLAN](03-DELIVERY-PLAN.md)

This document is written to be sufficient on its own. If you find yourself guessing, that is a
defect in this document — raise it rather than improvising.

---

## 1. Scope and repo constraints you must internalize first

**Read `CLAUDE.md` and `AGENTS.md` before writing a line.** They are not onboarding fluff. Several
things that look like bugs in this codebase are deliberate and documented, and a well-intentioned
"fix" to one of them will be rejected in review. The Gmail draft-link `message.id` choice and the
`ProjectSidebar` hand-maintained `_count` are the two that catch people most often.

Five constraints shape every instruction below.

| # | Constraint | Consequence for this work |
| --- | --- | --- |
| C1 | **There is no test framework.** No jest, no vitest, no playwright. Do not invent `npm test`. | Verification is the manual procedure in doc 05. Every ticket's DoD cites a `VER-nn`. Budget time for it; it is not optional. |
| C2 | **Prisma v5 on SQLite.** Every enum-like column is a plain `String` and nothing validates it server-side. | The new vocabulary constants in §4 are picker lists, not guarantees. Where a field carries legal meaning (§11) you must validate it explicitly in the route — the database will not. |
| C3 | **`lib/types.ts` is hand-mirrored, not generated.** Prisma's generated client types are not what the UI consumes. | Adding a column means editing `lib/types.ts` by hand. Forget it and the field is invisible to every component, silently. |
| C4 | **`CrmApp` owns all state; nothing refetches after a mutation.** Children own the `fetch`, the parent owns the arrays, and the server response is spliced in by hand. | A mutation that does not call back into `CrmApp` via `onUpdated` leaves the UI stale with no error. Every new write path must return the updated row and the caller must splice it. |
| C5 | **`account-detail.tsx` is an inline auto-saving form with no in-flight guard** (roadmap E6). Blur-fired PATCHes can race; a slow one resolving late overwrites a newer edit. | Suppression must **not** be a blur-fired field. See §12.2. |

`next dev` rewrites the block at the top of `AGENTS.md`. If it shows up in your diff, commit it
with your work rather than reverting it — reverting only re-creates the change.

---

## 2. Data model changes

One migration does two additive things: four nullable columns on `Account`, and one new table.
Every column is **additive and nullable** and the new table starts empty, so the migration is safe
against the populated `prisma/dev.db` — no backfill is required for the migration itself to apply.
Provenance backfill is a separate, explicit step (§10) precisely so that "the migration ran" and
"the data is correct" stay distinguishable.

**Read §2.0 before §2.1.** It is the one structural choice a reader will otherwise try to simplify
back out.

### 2.0 Suppression is a table, not three columns on `Account`

The obvious design — `Account.optedOutAt` and friends — fails for two reasons that only show up
later, when they are expensive:

- `Account` is scoped to a `Project`. `email` carries no unique constraint and the same address
  legitimately belongs to several campaigns (PRD F13). A per-row flag means opting someone out of
  `Mangood — Partners` leaves the same human in `MichiKanji — Shodo Schools`'s queue and draftable.
  Zero duplicates exist today; that is a property of the current 23 addresses, not of the schema,
  and the product direction is more campaigns per operator, not fewer.
- `StatusEvent` and `Interaction` cascade-delete with their `Account`, and so would a suppression
  column. Doc 04 §6.3 resolves the erasure-plus-objection collision by keeping *"a minimal
  suppression record — the email address plus the opt-out timestamp"* and deleting everything else.
  A column on a cascade-deleted row cannot be that record, so the runbook would prescribe a control
  the data model cannot hold, and the next import would re-add the person.

The import guard in §7 already had to look suppression up **across every project by normalized
email**, because suppression attaches to a person and not to a campaign. The table is that sentence
applied to every other enforcement point instead of just one.

**Footer identity is not here, and not on `Project` either.** It stays in the two `CRM_SENDER_*`
env vars (§6). Statutory identification names the **legal entity** that is sending, and a legal
entity sits above a campaign, not on one: `Mangood — Waitlist` and `Mangood — Partners` are two
projects with one sender between them, so a column on `Project` would store the same value twice
with no single place to change it. That tier is the Product tier, which roadmap **D16** deliberately
does not build. See §6.1.

### 2.1 `prisma/schema.prisma` — additions to `model Account`

Insert after `notesLink`, before the `createdAt` / `updatedAt` pair. Comments are in this repo's
house style: dense, carrying the rationale, and pointing at whichever document owns the
vocabulary rather than duplicating it.

Note what is **not** here: suppression. It lives in its own table (§2.1a) for the reasons in §2.0.

```prisma
  // --- Provenance (docs/requirements/01-PRD REQ-08) ----------------------------------
  // Where this contact came from, structured. Previously this lived in `notes` as
  // prose, which the detail form overwrites wholesale on blur — consent evidence in a
  // field that can be destroyed by a stray keystroke is not evidence. Allowed values
  // live in lib/types.ts as SOURCE_TYPES.
  sourceType   String? // waitlist_form | partner_sheet | referral | manual | research
  // The specific instance: which sheet, which form, who referred. Free text.
  sourceDetail String?
  // When they affirmatively opted in, for the sources where that concept applies.
  // Null is meaningful — it means we have no consent on file, which is exactly what
  // the jurisdiction gate in app/api/gmail/draft/route.ts reads.
  consentedAt  DateTime?

  // --- Jurisdiction (docs/requirements/01-PRD REQ-10) --------------------------------
  // Coarse and hand-set. We record the flag; we deliberately do not encode the statutes
  // (PRD N1). Allowed values live in lib/types.ts as JURISDICTIONS, and the subset that
  // gates a first contact is CONSENT_FIRST_JURISDICTIONS.
  jurisdiction String? // US | EU | UK | CA | JP | OTHER | UNKNOWN
```

### 2.1a `prisma/schema.prisma` — new `model Suppression`

Add at the end of the file, after `GoogleCredential`.

```prisma
// Do-not-contact, keyed on the person rather than on a campaign row
// (docs/requirements/01-PRD REQ-01).
//
// Not a status value, deliberately: `status` is unvalidated free text that the detail
// form overwrites in place (roadmap E7), so a suppression expressed as a status is one
// careless edit away from being undone. And not a column on Account, also deliberately:
// Account is scoped to a Project, `email` has no unique constraint, and the same address
// legitimately belongs to several campaigns — a per-row flag would leave the same human
// in a second project's queue. It would also cascade-delete with the Account, which is
// exactly the record docs/requirements/04 §6.3 says must survive an erasure request.
//
// The address is the primary key because it is the only identifier we hold that means
// the same thing across campaigns. Always normalized through normalizeEmail() in
// lib/contacts.ts before it reaches here — a suppression stored in mixed case is a
// suppression that does not match.
model Suppression {
  email      String   @id
  optedOutAt DateTime @default(now())
  // How the opt-out reached us. Allowed values live in lib/types.ts as OPT_OUT_SOURCES.
  source     String? // reply | verbal | form | manual
  // What they actually said, verbatim where possible. This is the evidence.
  note       String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

There is deliberately **no relation** to `Account`. A relation would need a foreign key, and the
whole point is that this record outlives the row and spans projects. Joining is done in application
code by normalized address — see §5.1.

### 2.2 Migration

```bash
npx prisma migrate dev --name add_consent_and_suppression
```

This becomes the sixth migration, after `20260821114839_add_google_credential`. It regenerates
the client as a side effect. On a fresh clone, `npx prisma migrate deploy` applies it.

One migration covers both changes — the `Account` columns and the `Suppression` table — because
`CRM-101`'s whole purpose is that every other branch rebases onto exactly one committed migration
(doc 03 §6, risk R4).

**Do not** use `npx prisma db seed` for anything in this effort — it does not work in this repo
(no `prisma.seed` key in `package.json`, no `prisma.config.ts`), and `prisma/seed.ts` is guarded
to skip entirely when any project exists. Scripts run via `npx tsx`.

---

## 3. The four-edit checklist — read this section twice

`CLAUDE.md` states the rule and it is exact: **adding a column to `Account` means four edits.**
Miss one and the field exists in the database and nowhere else, with no error anywhere.

| # | File | What to change |
| --- | --- | --- |
| 1 | `prisma/schema.prisma` | The field definitions (§2.1, §2.1a). |
| 2 | `app/api/accounts/route.ts` | The `data: { … }` object in the POST create. |
| 3 | `app/api/accounts/[id]/route.ts` | The PATCH whitelist — **and see the warning below**. |
| 4 | `lib/types.ts` | The hand-mirrored `Account` type, the new `Suppression` type, plus the new vocabularies (§4). |

`Suppression` is **not** on this list. It is not a column on anything; it gets its own route
(§5.5) and its own type, and no existing write path touches it. **`Project` is untouched by this
effort** — footer identity is configuration, not a column (§2.0, §6.1).

### 3.1 The mistake this section exists to prevent

`app/api/accounts/[id]/route.ts` has **two** loops. The first copies whitelisted keys straight
through. The second exists because dates cross JSON as strings and must be coerced with
`new Date()` before Prisma will accept them as `DateTime`.

**`consentedAt` is a `DateTime` column. It goes in the second loop.** Putting it in the first will
hand Prisma a string for a `DateTime` field. Depending on the value you get either a runtime error
or, worse, an `Invalid Date` persisted — the same class of defect the roadmap already notes for
`lastContact`.

The three string-valued fields — `sourceType`, `sourceDetail`, `jurisdiction` — go in the first
loop. The same split applies in the suppression route (§5.5): `optedOutAt` is a `DateTime` and
needs the same coercion, even though it lives in a different file.

### 3.2 Exact shape — `app/api/accounts/[id]/route.ts`

```ts
  // Loop 1 — plain pass-through. String columns only.
  for (const key of [
    "name",
    "status",
    "kind",
    "labels",
    "nextAction",
    "notes",
    "draftLink",
    "notesLink",
    "projectId",
    // RS-01 compliance fields, string-valued. Suppression is absent on purpose — it is
    // not a column on this row (§2.0) and is written through its own route (§5.5).
    "sourceType",
    "sourceDetail",
    "jurisdiction",
  ] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }

  // email and the date fields sit outside the loop because each needs coercion:
  // addresses are normalized (lib/contacts.ts), dates are strings crossing JSON.
  if (body.email !== undefined) {
    data.email = normalizeEmail(body.email);
  }

  // Loop 2 — DateTime columns. consentedAt belongs HERE, not above: Prisma will not
  // accept a JSON string for a DateTime field.
  for (const key of [
    "lastContact",
    "nextActionDue",
    "consentedAt",
  ] as const) {
    if (body[key] !== undefined) {
      data[key] = body[key] ? new Date(body[key]) : null;
    }
  }
```

The `$transaction` wrapping the update and the `StatusEvent` write is unchanged and the new
fields go **inside** it, which they do automatically by virtue of being in `data`. Do not add a
second transaction or move the update out of the existing one.

### 3.3 Exact shape — `app/api/accounts/route.ts` POST

Add to the `data: { … }` object. Note the default on `sourceType`.

```ts
      // RS-01. A contact created by hand in the UI genuinely is `manual`, so defaulting
      // here means the two create dialogs (project-sidebar, account-list) need no change
      // and no row is ever written with null provenance. See docs/requirements/01-PRD
      // success criterion 3.
      sourceType: body.sourceType ?? "manual",
      sourceDetail: body.sourceDetail ?? null,
      consentedAt: body.consentedAt ? new Date(body.consentedAt) : null,
      jurisdiction: body.jurisdiction ?? null,
```

Nothing about suppression appears here. Creating a contact never suppresses them, and a contact
who *is* suppressed should not be created at all — that check belongs in the import script (§7),
not in the create path, because the UI's two create dialogs collect a name before an address.

---

## 4. New vocabulary constants — `lib/types.ts`

Append after `QUEUE_EXCLUDED_STATUSES`. Follow the existing comment convention: these are the
picker's list, **not** a guarantee about what is in the column (C2).

```ts
// --- RS-01 compliance vocabularies -------------------------------------------------
// Picker lists, not server-side guarantees — every one of these is a plain String
// column on SQLite and nothing validates it, exactly like STATUS_OPTIONS_BY_KIND above.
// The one exception is jurisdiction, which app/api/gmail/draft/route.ts validates
// explicitly because it gates a legal decision. See docs/requirements/02-TRD §11.

// How a contact entered the system. Drives the source-disclosure sentence the composer
// is required to write for anything that is not a direct signup (REQ-17).
export const SOURCE_TYPES = [
  "waitlist_form",
  "partner_sheet",
  "referral",
  "manual",
  "research",
] as const;

// Sources that are a direct, affirmative action by the contact themselves. Anything
// NOT in this list triggers the Art. 14 source-disclosure requirement in the compose
// system prompt.
export const DIRECT_SOURCE_TYPES = ["waitlist_form"] as const;

// How an opt-out reached us. `reply` is the expected case — the footer asks people to
// reply with the word "stop".
export const OPT_OUT_SOURCES = ["reply", "verbal", "form", "manual"] as const;

// Coarse, hand-set. We record the flag and a human handles the exceptions (PRD N1).
export const JURISDICTIONS = [
  "US",
  "EU",
  "UK",
  "CA",
  "JP",
  "OTHER",
  "UNKNOWN",
] as const;

// The subset where a first unsolicited contact needs consent rather than an opt-out.
// This constant is the whole of REQ-10's gate — the draft route reads it and nothing
// else. Widening it is a product decision, not a code cleanup.
//
// UNKNOWN is in here deliberately. Doc 03 risk R3 and VER-10b both say an ambiguous
// contact is recorded as UNKNOWN and treated as consent-first so it fails safe; leaving
// it out would make that promise false, and an unreviewed row would sail through the gate.
export const CONSENT_FIRST_JURISDICTIONS = [
  "EU",
  "UK",
  "CA",
  "JP",
  "UNKNOWN",
] as const;
```

Extend the hand-mirrored `Account` type in the same file and add the new `Suppression` type. Dates
are `string | null` because they cross JSON, matching `lastContact` and `nextActionDue`:

```ts
export type Account = {
  // … existing fields unchanged …
  sourceType: string | null;
  sourceDetail: string | null;
  consentedAt: string | null;
  jurisdiction: string | null;
};

// Hand-mirrored from prisma/schema.prisma like StatusEvent and Interaction above. Keyed
// on the normalized email rather than on an account id, because suppression attaches to
// a person and outlives any one campaign row — see docs/requirements/02-TRD §2.0.
export type Suppression = {
  email: string;
  optedOutAt: string;
  source: string | null;
  note: string | null;
};
```

`QueueRow` extends `Account`, so it picks the four new columns up for free and needs no edit.
`/api/queue` filters suppressed addresses out server-side (§5.1) and never returns one, so the queue
has nothing to render about them.

The **account list** is the surface that does need a flag, because it shows every contact in a
project including suppressed ones. That is one added field on the wire, not a schema change — see
§5.6.

**Do not** add anything to `STATUS_COLOR`. Suppression is not a status and must not acquire a
status dot — that would reintroduce exactly the confusion REQ-01 exists to prevent.

---

## 5. API contract changes

### 5.1 `GET /api/queue` — REQ-02

**Before.** Filters `status notIn QUEUE_EXCLUDED_STATUSES` and `nextActionDue` null-or-past, then
sorts in JS in two buckets (SQLite has no Prisma `nulls` ordering).

**After.** One preliminary read and one added clause in the `where`:

```ts
  // Suppression lives in its own table keyed on the normalized address (§2.0), so it
  // cannot be a column predicate. Read the set first, then exclude it in the query.
  // At tens to hundreds of suppressed addresses this is one small indexed scan; the
  // same "at this scale it costs nothing" reasoning as the two-bucket sort below.
  const suppressed = (
    await prisma.suppression.findMany({ select: { email: true } })
  ).map((s) => s.email);

  const rows = await prisma.account.findMany({
    where: {
      // Suppression is absolute and independent of the status vocabulary. A contact who
      // opted out is out of the queue whatever their stage says — including `Prospect`,
      // which is not in QUEUE_EXCLUDED_STATUSES and never will be — and out of it in
      // EVERY project they appear in, because the match is on the address and not on the
      // row. That cross-project property is the whole reason REQ-01 is a table.
      email: { notIn: suppressed },
      status: { notIn: [...QUEUE_EXCLUDED_STATUSES] },
      OR: [{ nextActionDue: null }, { nextActionDue: { lte: now } }],
    },
    include: { project: { select: { id: true, name: true } } },
  });
```

**One subtlety that will bite if you skip it.** In SQL, `NOT IN` against a `NULL` column excludes
the row — so `email: { notIn: [...] }` would silently drop every contact with no email address, and
those are exactly the rows the queue is most likely to hold (11 of 34 today). Prisma on SQLite
generates `NOT IN` here, so **verify this against real data**: `VER-05` and `R5` both check it. If
the null rows disappear, widen the clause to
`OR: [{ email: null }, { email: { notIn: suppressed } }]` and keep the due-date `OR` nested
underneath as an `AND`. Do not skip the check because the query reads correctly — this is a
behavioural difference between SQL's three-valued logic and the JS predicate it looks like.

**Why the query and not the JS sort.** Three reasons, in order of weight. It must hold even if
the sort is later replaced or moved. A suppressed row filtered in JS is still read out of the
database and serialized into a response that crosses the network — needless handling of data we
have been asked to stop using. And the `where` clause is the artifact a reviewer can read in ten
seconds to confirm the control exists; a predicate buried in a comparator is not.

**Do not** express this by adding a status to `QUEUE_EXCLUDED_STATUSES`. That constant is a
product decision about which *stages* owe no action. Suppression is orthogonal and must not be
coupled to it.

No response-shape change. `queue-view.tsx` needs no edit for this requirement.

### 5.2 `POST /api/gmail/draft` — REQ-03, REQ-06, REQ-10

The most-changed route. Three new failure modes, all of which **must run before any Gmail API
call**, and all of which must be reachable by the client (see §12.3 — they are currently not).

**Check order is normative.** Implement it in exactly this sequence:

| # | Check | Status | Override | Notes |
| --- | --- | --- | --- | --- |
| 1 | Not signed in / no `accessToken` | `401` | — | Existing behaviour, unchanged. |
| 2 | Malformed JSON body | `400` | — | **New.** `await request.json()` is currently unguarded; wrap it, matching `POST /api/compose`'s idiom. |
| 3 | Missing `to` / `subject` / `body` | `400` | — | Existing behaviour, unchanged. |
| 4 | Missing `accountId` | `400` | — | **New.** See "the accountId hole" below. |
| 5 | No such account | `404` | — | **New.** Currently a null account silently skips the write-back. |
| 6 | Recipient address is suppressed | `409` | **None. Ever.** | Looked up in `Suppression` by normalized address, **not** read off the account row. Error names the opt-out date. |
| 7 | Consent-first jurisdiction, no `consentedAt` | `409` | `body.acknowledgeJurisdiction === true` | Per-request only; never persisted. |
| 8 | Footer env vars unset | `500` | — | Names the missing variable. See §6.3. |
| 9 | Gmail call fails | `502` | — | Existing behaviour, unchanged. |

**The `accountId` hole.** Today the account lookup is conditional — `accountId ? findUnique : null`
— so a request that simply omits `accountId` gets a draft with no `From` header, no write-back,
and, under this spec, **no compliance checks at all**. That is a bypass, not an edge case. Make
`accountId` required. The only caller is `createDraft` in `account-detail.tsx:135`, which always
sends it, so this breaks nothing.

```ts
  // Suppression first, and with no override parameter. A request that reaches this
  // branch is asking the application to contact someone who told us to stop; there is
  // no argument the caller can pass that makes that acceptable, so there is no
  // argument to pass. Deliberately asymmetric with the jurisdiction gate below.
  //
  // Keyed on the recipient address rather than on the account row, so an opt-out
  // recorded against this person in ANY project blocks this draft too. Normalize the
  // address the same way it was normalized on the way in — a lookup on the raw `to`
  // value would miss a suppression stored lowercase, which is every suppression.
  const suppressed = await prisma.suppression.findUnique({
    where: { email: normalizeEmail(to) ?? "" },
  });
  if (suppressed) {
    return NextResponse.json(
      {
        error:
          `${account.name} opted out on ` +
          `${suppressed.optedOutAt.toISOString().slice(0, 10)}. No draft was created.`,
      },
      { status: 409 }
    );
  }

  // Jurisdiction gate. Unlike suppression this is a "are you sure" and not a "no":
  // consent-first is a rule about unsolicited first contact, and the operator may have
  // a basis the database doesn't know about. The acknowledgement is per-request and is
  // never written to the row — a persisted acknowledgement is a permission, and this is
  // deliberately not one. Same reasoning as CRM_I_KNOW_THE_API_IS_UNAUTHENTICATED in
  // proxy.ts: make the override loud and make it cost something each time.
  const consentFirst = (CONSENT_FIRST_JURISDICTIONS as readonly string[]).includes(
    account.jurisdiction ?? ""
  );
  if (consentFirst && !account.consentedAt && body.acknowledgeJurisdiction !== true) {
    return NextResponse.json(
      {
        error:
          `${account.name} is recorded in ${account.jurisdiction}, where a first ` +
          `unsolicited email needs consent, and no consent date is on file. Record ` +
          `consent on the contact, or confirm you have a basis for this send.`,
        requiresAcknowledgement: true,
      },
      { status: 409 }
    );
  }
```

The `requiresAcknowledgement: true` discriminator is what lets the client distinguish the
overridable 409 from the absolute one without string-matching the message. The client shows a
confirmation and re-POSTs with `acknowledgeJurisdiction: true`; for the suppression 409 the field
is absent and the client only shows the error.

Note the check is on `to`, the address the message is actually going to, and not on
`account.email`. Those are normally the same, but the account is loaded by id and `to` is what
`buildRawMessage` puts in the header — gating on anything other than the address that will receive
the message leaves a hole. If they differ, that is worth a `400`; adding one is optional.

Widen the account `select` to carry the new fields — the current query includes only
`project: { select: { fromEmail: true } }`, so `jurisdiction` and `consentedAt` are not loaded
today. The project `select` is unchanged: footer identity comes from the environment, not the row
(§6.1).

### 5.3 `POST /api/compose` — REQ-07, REQ-13, REQ-17

**Brief.** Two lines added to the explicit `brief` array. Keep the existing construction — it is
explicit precisely so a new column cannot silently start leaking into prompts, and that property
is now load-bearing for REQ-13.

```ts
    account.sourceType && `How we obtained this contact: ${account.sourceType}`,
    account.sourceDetail && `Source detail: ${account.sourceDetail}`,
```

Add a comment above the `brief` recording the REQ-13 boundary verbatim:

```ts
  // Everything the model is allowed to use. Assembled explicitly rather than dumping
  // the row so that adding a column doesn't silently start leaking into prompts.
  //
  // RS-01 / D20 BOUNDARY: every field here is CRM-authored — typed by the operator or
  // imported from our own sheets. No Gmail-derived content may be added to this array.
  // Gmail data is obtained under a restricted scope whose Limited Use terms bar onward
  // transfer to a third party, and this array is transferred to OpenRouter and onward
  // to a model provider. If the message store lands and you are tempted to include a
  // thread summary here, that is the decision D20 exists to stop. See
  // docs/requirements/04-COMPLIANCE-REGISTER CTL-09.
```

**System prompt.** Two replacements and one addition.

| Line | Current | Replace with |
| --- | --- | --- |
| `route.ts:40` | `- Sign off with the sender's first name alone. Do not invent a title or company footer.` | `- Sign off with the sender's first name alone. Do not write a signature block, postal address, or opt-out line — the application appends the required footer after you, and a second one reads as spam.` |
| `route.ts:45` | `- Never state or imply that this message was written by AI.` | `- Write in the sender's own voice, the way they would type it themselves.` |
| *(new rule)* | — | `- If "How we obtained this contact" is given below and it is not a direct signup, say plainly where their details came from within the first two sentences. "I found you through the FoodTech partner list" is the shape. Do not dress it up.` |

Line 40's replacement is the one that matters for REQ-06: the old wording actively prevented
compliance, and the new wording keeps the model out of the footer's way while explaining why, so
a future editor does not "helpfully" restore it. Line 45's replacement produces the same copy —
the model was never going to announce itself unprompted — without a concealment instruction
sitting in a public repository.

### 5.4 `POST /api/accounts` and `PATCH /api/accounts/[id]` — REQ-08, REQ-10

Covered exhaustively in §3. Nothing else in these routes changes. The `$transaction` and its
`StatusEvent` write are untouched. Note the requirement list: these routes no longer implement
REQ-01 at all, because suppression is not written here.

### 5.5 `POST /api/suppressions` — REQ-01, REQ-05 *(new route)*

New file: `app/api/suppressions/route.ts`. This is the only writer of the `Suppression` table from
the application, and it is deliberately its own route rather than a branch of the accounts PATCH.
Three reasons, and the third is the load-bearing one:

- The record is not scoped to an account, so `PATCH /api/accounts/[id]` is the wrong address for it.
- It must not join the auto-saving field set, which has a known in-flight race (§12.2, roadmap E6).
  A separate route makes that structurally true rather than a convention someone can forget.
- The response has to tell the client which **accounts** changed, because `CrmApp` owns the arrays
  and nothing refetches (C4). Suppressing one address can affect rows in several projects.

```ts
// POST /api/suppressions — record a do-not-contact request.
//
// Upsert rather than create: the same person can opt out twice (a reply, then a
// forwarded complaint), and the second attempt must not 409. The FIRST timestamp is
// the one that matters legally, so an existing optedOutAt is never overwritten —
// only the source and note are refreshed, because a later message is usually the
// more complete evidence.
const email = normalizeEmail(body.email);
if (!email) {
  return NextResponse.json(
    { error: "An email address is required to record an opt-out." },
    { status: 400 }
  );
}
if (body.source !== undefined && !OPT_OUT_SOURCES.includes(body.source)) {
  return NextResponse.json(
    { error: `source must be one of: ${OPT_OUT_SOURCES.join(", ")}.` },
    { status: 400 }
  );
}

const suppression = await prisma.suppression.upsert({
  where: { email },
  create: {
    email,
    optedOutAt: body.optedOutAt ? new Date(body.optedOutAt) : new Date(),
    source: body.source ?? null,
    note: body.note ?? null,
  },
  update: {
    source: body.source ?? undefined,
    note: body.note ?? undefined,
  },
});

// Every account this now affects, across every project. The client splices these into
// CrmApp's arrays so the banner appears on all of them without a refetch (C4).
const affected = await prisma.account.findMany({
  where: { email },
  select: { id: true, projectId: true },
});

return NextResponse.json({ suppression, affected });
```

Also provide `DELETE /api/suppressions?email=…` for the mistaken-entry case. It is not in any
requirement and needs no UI — the operator uses `curl` or Prisma Studio. Log the deletion to the
server console with the address, because un-suppressing someone is the single most consequential
write in this application and doc 04 §6.3 says the record must normally be retained.

### 5.6 `GET /api/accounts` — the suppression flag on the wire

`AccountList` must show that a contact is suppressed, and `AccountDetail` must disable its compose
controls (§7). Neither can read it off the row any more.

Add the flag to the existing list read rather than making the client fetch a second endpoint —
`CrmApp` loads accounts once per project selection and nothing refetches (C4), so a second fetch
would be a second thing to keep in sync:

```ts
  const accounts = await prisma.account.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: { createdAt: "asc" },
  });

  // Suppression is person-scoped and lives in its own table (§2.0), so it cannot come
  // back on the row. Resolved here rather than client-side: one query for the page, and
  // the client never has to know the table exists.
  const emails = accounts.map((a) => a.email).filter(Boolean) as string[];
  const rows = await prisma.suppression.findMany({
    where: { email: { in: emails } },
    select: { email: true, optedOutAt: true },
  });
  const suppressedAt = new Map(rows.map((r) => [r.email, r.optedOutAt]));

  return NextResponse.json(
    accounts.map((a) => ({
      ...a,
      optedOutAt: (a.email && suppressedAt.get(a.email)) ?? null,
    }))
  );
```

Return the **timestamp**, not a boolean — the detail banner should say *when*, and a boolean throws
that away. Mirror it on the `Account` type in `lib/types.ts` as a read-only computed field, with a
comment saying it is derived and is not a column, so nobody adds it to a PATCH whitelist:

```ts
  // Derived, not stored. Computed by GET /api/accounts from the Suppression table,
  // which is keyed on the address and spans projects (§2.0). Never send this in a PATCH
  // — POST /api/suppressions is the only writer.
  optedOutAt: string | null;
```

---

## 6. Footer specification — REQ-06

### 6.1 Where it goes, and why there

The footer is appended inside `buildRawMessage` in `app/api/gmail/draft/route.ts:8`. Not in the
system prompt, not in `Project.approach`, not in the operator's hands.

- **Not the prompt.** A language model given a formatting instruction complies most of the time.
  "Most of the time" is the wrong reliability class for a statutory disclosure. It will also
  paraphrase the address, and a paraphrased postal address is not a postal address.
- **Not the operator.** The operator is the person this control protects. A control that depends
  on its beneficiary remembering it on message 40 of 40 is decorative. There is one user and no
  second pair of eyes (PRD §6) — so the compliant path has to be structural.
- **`buildRawMessage` specifically**, rather than the route body, because it is the single
  chokepoint every outbound message passes through, including any future
  `POST /api/gmail/send`. Putting it in the route body would leave the next send path uncovered.
- **Not `Project`, and this is the one that gets argued.** `Project.fromEmail` is per campaign, so
  a per-campaign `senderLegalName` looks symmetrical. It is not. `fromEmail` is a *sending
  address*, which genuinely differs per campaign; the footer names the **legal entity**, which
  sits above a campaign. `Mangood — Waitlist` and `Mangood — Partners` are two projects with one
  sender between them, so columns on `Project` would store the same entity twice with nowhere
  single to change it — and the tier that would own it correctly is the Product tier, which
  roadmap **D16** deliberately does not build. Configuration is the right home until a second
  legal entity actually exists; see the trigger in doc 01 §10.

### 6.2 Format

The message is `text/plain; charset=utf-8`. **No HTML, no links.** Appended to the body after the
model's sign-off:

```
<body as composed>

-- 
${CRM_SENDER_LEGAL_NAME}
${CRM_SENDER_POSTAL_ADDRESS}

Don't want to hear from me again? Reply with the word "stop" and I'll take you off my list.
```

Notes on each element:

- **`-- ` (dash, dash, space) on its own line** is the RFC 3676 signature separator. Every serious
  mail client recognises it and collapses what follows. It costs nothing and it makes the footer
  read as a signature rather than as boilerplate bolted on.
- **`CRM_SENDER_LEGAL_NAME`** — the legal entity, not the product name. Statutory identification
  is about who is actually sending. One value, because there is one sender: see §6.1 and PRD Q1.
- **`CRM_SENDER_POSTAL_ADDRESS`** — a single line, comma-separated, because environment variables
  are single-line and a multi-line address in a `.env` is a parsing problem nobody needs. Do not
  add escape-sequence expansion; write the address with commas.
- **The opt-out is reply-based.** A functioning return address is a valid internet-based opt-out
  mechanism, and for genuinely 1:1 outreach it is more honest than a tracked link — the reply
  lands in the same inbox the message came from, where the operator will actually see it. It also
  keeps PRD N2 true: no hosted preference centre, nothing to build or host.
- **The word "stop"** is what `Suppression.source = "reply"` in §4 is named for. Keep them aligned; if
  the wording changes, the register entry in doc 04 changes with it.

### 6.3 Fail closed

If either variable is unset or blank, **do not call `drafts.create`**. Return `500` naming the
missing variable:

```ts
{ error: "CRM_SENDER_POSTAL_ADDRESS isn't set. A postal address is required in every outreach email; add it to .env before drafting." }
```

`500` rather than `400` is correct here: the caller did nothing wrong, the deployment is
misconfigured. This mirrors the `501` that `POST /api/compose` returns for a missing
`OPENROUTER_API_KEY` — an actionable message naming the variable, not a generic failure.

Read both through a helper in `lib/outreach.ts` beside the footer builder (§6.4), so the route and
the preview cannot disagree, and check them with `?.trim() ||` rather than `??`. An empty string is
not null, so `??` would accept a blank `.env` line and emit a footer with a gap where the address
goes — the fail-*open* case this guard exists to prevent, and the subtler half of risk R8.

**Do not relax this** on the grounds that a fresh clone cannot draft until `.env` is filled in.
That is the guard working: the error names the variable, and filling it in is a one-line fix.

Add both to `.env.example` with comments, next to the existing Google block:

```bash
# Required before any outreach email can be drafted. Both appear in the footer of every
# message the app builds — the legal entity that is sending, and a real postal address.
# Drafting fails closed with a message naming the missing variable if either is blank.
CRM_SENDER_LEGAL_NAME=""
CRM_SENDER_POSTAL_ADDRESS=""
```

Update the `README.md` env section and the `CLAUDE.md` env paragraph in the same commit —
`CLAUDE.md` currently states "Everything else works with no keys at all", which stops being true
for the drafting path.

### 6.4 Preview parity — REQ-06b (P1, may ship after P0)

`account-detail.tsx` composes into a plain `<Textarea>`; the operator sees the body without the
footer, then a different message lands in Gmail. Close the gap by exporting the footer builder
from a shared module (`lib/outreach.ts` is the natural home — `lib/contacts.ts` is contact-domain
logic and this is message-domain) and rendering it read-only beneath the composer, visibly not
editable. Do not paste it into the textarea: the operator would then edit it, and the route would
append a second copy.

One mechanical note: `process.env` is not readable client-side, so the footer values have to reach
the component somehow. The smallest honest option is a tiny `GET /api/outreach/footer` returning
the two resolved strings. They are a company name and a postal address that will appear in every
outbound message, so this is not a disclosure concern — but say so in the commit, because REQ-11 is
a rule about *not* widening what the client payload carries and a reviewer will and should ask.

---

### 6.5 The subject header — REQ-06c

Adjacent to the footer, same function, same commit, and **not** a footer concern: `buildRawMessage`
currently writes

```ts
    `Subject: ${subject}`,
```

as raw UTF-8. The `Content-Type: text/plain; charset=utf-8` header immediately below it declares
the encoding of the **body**; RFC 2822 headers must be ASCII, and non-ASCII in a header needs RFC
2047 encoded-words. `account-detail.tsx:51` seeds every composed subject as
`Following up — <project name>`, with an em dash, so **every draft this app is currently capable of
producing corrupts its own subject line** — and a project named in Japanese would corrupt
entirely.

Encode when, and only when, the subject is not already ASCII:

```ts
// RFC 2047 encoded-word. Only applied when needed: a plain ASCII subject must stay
// legible in the raw message, both for humans reading it and for VER-06.
function encodeSubject(subject: string) {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(subject)) return subject;
  return `=?utf-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}
```

This is specified here rather than left as a bug report because `VER-06` and `CRM-120` both
inspect the raw message in Gmail. Without the fix, the M0 gate discovers it — presenting as a
footer defect, in the one procedure that also depends on Phase 0.

*(Adjacent and deliberately not fixed: the message joins its lines with `\n` where RFC 5322
specifies `\r\n`. Gmail's `drafts.create` accepts it and has for the whole life of this route.
Not worth a ticket; worth a comment if you are already in the function.)*

---

## 7. Suppression enforcement — defense in depth

One control is a hope. The point of the table is that each layer catches what the one above it
misses, and that the remaining gap is named rather than discovered.

Every layer below matches on the **normalized email address**, never on the account id, so each of
them holds across projects. That uniformity is the point of §2.0: with a per-row column, the queue
and the draft route would have caught only the campaign the opt-out happened to be recorded in.

| Layer | File | Mechanism | Catches | Misses |
| --- | --- | --- | --- | --- |
| Queue read | `app/api/queue/route.ts` | `email: { notIn: suppressed }` in the `where` | The operator being *shown* a suppressed contact as work to do — the normal path by which a mistake would start — in **any** project | A contact reached by deep link (`?project=&account=`), by search in `AccountList`, or by direct navigation. The queue is not the only way in. |
| Draft creation | `app/api/gmail/draft/route.ts` | `Suppression` lookup on the recipient address; `409`, no override | Every route to a message the application builds, including deep links and future send endpoints | A message the operator writes by hand in Gmail. Out of scope — the app cannot see that, and pretending otherwise would be theatre. |
| Import | `prisma/import-mangood.ts` | Pre-insert `Suppression` lookup by normalized email | Re-importing a sheet that still lists someone who has since opted out — **including into a project that did not exist when they opted out** | Rows whose email differs by more than case/whitespace from the suppressed one. `normalizeEmail` is the only matching we do. |
| UI affordance | `components/crm/account-detail.tsx` | Persistent banner on a suppressed contact; compose controls disabled | The operator starting work they cannot finish, and doing it with an accurate mental model | Nothing — it is an affordance, not a control. It must never be the only thing standing between a suppressed contact and a message. |
| Survives erasure | `model Suppression` | No relation to `Account`, so no cascade | The person who asks to be both erased and never contacted again — doc 04 §6.3's resolution, which a column on a cascade-deleted row could not implement at all | A person with no email address on file. Suppression is keyed on the address; there is nothing else that means the same thing across campaigns. Recorded as an accepted gap below. |
| **Accepted gap** | Contacts with no email address | *(none)* | — | 11 of 34 rows have no address today. They cannot be suppressed and they also cannot be emailed by this app (`createDraft` refuses), so the exposure is bounded: it becomes real only if an address is added later, at which point the suppression must be re-recorded by hand. |
| **Accepted gap** | Prisma Studio / direct SQL | *(none)* | — | Direct database edits bypass every layer above. Same shape as roadmap **E8**, and accepted on the same grounds: single operator, and a control that a determined author can route around by opening Studio is not a control, it is a speed bump. Recorded in doc 04 rather than engineered around. |

**Import specifics for REQ-04.** `importProject` currently skips an entire project when one of
that name exists (`prisma/import-mangood.ts:93`), so today's resurrection risk is masked at the
project level. Do not rely on that — it evaporates the moment a project is renamed or a second
sheet is imported. The check is **per contact, by normalized email, across every project**,
because suppression attaches to a person and not to a campaign:

```ts
  for (const c of project.contacts) {
    const email = normalizeEmail(c.email);
    if (email) {
      // One lookup against the suppression table. With the earlier per-row design this
      // had to be a cross-project findFirst over Account; keying on the address makes
      // it a primary-key read and removes the "across every project" caveat entirely.
      const suppressed = await prisma.suppression.findUnique({
        where: { email },
        select: { optedOutAt: true },
      });
      if (suppressed) {
        // Loud, per-address, and by design not a silent filter: a skipped row is
        // information the operator needs — it means the sheet is stale.
        console.log(
          `· skipping ${email} — opted out ${suppressed.optedOutAt.toISOString().slice(0, 10)}`
        );
        skipped.push(email);
        continue;
      }
    }
    await prisma.account.create({ /* … */ });
  }
```

Print a summary count at the end of `main()`. A skip that scrolls past unread is a skip that did
not happen, as far as the operator's understanding goes.

---

## 8. Session payload — REQ-11

`app/layout.tsx:31` passes the whole session, including Google's `accessToken`, into
`<SessionProvider>`. That serializes a live `gmail.compose` credential into the RSC payload of
every page: readable from `document`, present in browser cache, and reachable by any script that
gets onto the page.

**Verified before specifying the fix:** no client component reads it. `components/crm/top-bar.tsx:27`
and `components/crm/account-detail.tsx:33` call `useSession()` for the user object only, and
`app/api/gmail/draft/route.ts:41` reads the token server-side from `auth()`. Stripping it is
therefore behaviour-preserving.

```tsx
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();

  // The Google access token lives on the session for the Gmail route's benefit
  // (lib/auth.ts session callback) and is read there, server-side, via auth(). Passing
  // it to SessionProvider would serialize a live gmail.compose credential into the RSC
  // payload of every page. Nothing on the client reads it — top-bar and account-detail
  // use useSession() for the user object alone — so it comes off here.
  //
  // The cast matches the existing `unknown` idiom in lib/auth.ts: module augmentation
  // is deliberately not set up, and adding a partial declaration for this one field
  // would leave the codebase with two half-truths about the Session type instead of one
  // consistent cast. See CLAUDE.md, "Auth and Gmail".
  const clientSession = session
    ? ({
        ...(session as unknown as Record<string, unknown>),
        accessToken: undefined,
      } as unknown as typeof session)
    : null;

  return (
    <html /* … */>
      <body className="min-h-full flex flex-col">
        <SessionProvider session={clientSession}>{children}</SessionProvider>
        <Toaster />
      </body>
    </html>
  );
}
```

Set to `undefined` rather than deleting the key: `undefined` is dropped during serialization,
and it keeps the shape stable for TypeScript without a `delete` on a spread object.

### 8.1 Strip `accessToken`, and nothing else

**Do not also strip `session.error`.** `components/crm/top-bar.tsx:34-36` reads it to decide
whether to render a "Session expired — sign in again" button instead of the avatar menu. Remove it
and the symptom is the one roadmap E3 describes: a session that still looks signed in, an opaque
502 from Gmail, and nothing anywhere explaining why.

The session also carries `scope` (`lib/auth.ts:121-123`), so a route can tell "never granted" from
"Gmail is down". Not a credential, not read on the client today, and the field a future read path
will need — leave it.

`VER-11` checks both halves: the token is absent from the payload, *and* the expired-session button
still renders. A `VER-11` that only checks the first would pass while the regression ships.

---

## 9. Third-party call controls — REQ-14

Two changes, both in the LLM path, both small and both consequential once `OPENROUTER_API_KEY` is
set. Roadmap **E9** triggers on exactly that moment.

### 9.1 Deny provider data collection

The gateway routes to whichever upstream provider it prefers, and some log and retain prompts by
default. Contact names, research notes, and campaign context are in every prompt. Constrain the
routing on the request:

```ts
    const completion = await llmClient().chat.completions.create({
      model: llmModel(),
      max_tokens: 2000,
      temperature: 0.4,
      response_format: { type: "json_object" },
      // OpenRouter-specific routing preference: refuse providers that retain or train
      // on prompt content. Every prompt this app sends carries a real person's name and
      // our research notes about them, which makes the upstream provider a processor.
      // See docs/requirements/04-COMPLIANCE-REGISTER CTL-10.
      provider: { data_collection: "deny" },
      messages: [ /* … */ ],
    });
```

**TypeScript note — read this before you start fighting the compiler.** The OpenAI SDK types
`create()` params strictly and `provider` is not in `ChatCompletionCreateParams`. You have two
honest options: a single narrow cast on the params object, or the SDK's untyped pass-through. Pick
one, apply it once, and leave a comment saying which and why. **Do not** widen the SDK types, add
a module augmentation, or `@ts-ignore` the whole call — the field must survive a future SDK bump
visibly rather than silently dropping out of the request. Verify the field actually reaches the
wire (VER-14 in doc 05); a param the SDK strips is worse than no control, because it looks like
one in review.

### 9.2 Move off the preview endpoint

`lib/llm.ts` defaults to `google/gemini-3-flash-preview`. Preview and experimental endpoints
routinely carry different data-use terms from their GA counterparts, and the terms can change
without a version bump. Change `DEFAULT_MODEL` to the GA slug of the equivalent model and note
why in the comment beside it:

```ts
// Change this, or set OPENROUTER_MODEL, to switch models. Any OpenRouter slug works.
//
// Deliberately a GA slug and not a `-preview` one: preview endpoints carry different
// data-use terms from GA, and can change them without a version bump. Real contact
// details are in every prompt. If you switch models, keep this property — the check is
// "does the slug end in -preview or -exp", and the answer must stay no.
```

Confirm the chosen GA slug against the gateway's current model list at implementation time rather
than trusting this document — model availability moves faster than specs do.

### 9.3 What is *not* changing

`HTTP-Referer` and `X-Title` in `llmClient()` stay. They are usage attribution, they carry no
personal data, and they are what separates this app's spend from the sibling project's.

---

## 10. Backfill script — REQ-09

New file: `prisma/backfill-provenance.ts`. Run with `npx tsx prisma/backfill-provenance.ts`.

`npx prisma db seed` does not work in this repo — there is no `prisma.seed` key in `package.json`
and no `prisma.config.ts` — and `prisma/seed.ts` is guarded to skip when any project exists, so it
cannot be repurposed. This is a third loader alongside `seed.ts` and `import-mangood.ts`, and like
both of them it bypasses the API. That is the accepted pattern here; note it in the file header so
the next reader does not think it is an oversight.

### 10.1 Behaviour

| Property | Requirement |
| --- | --- |
| Idempotent | Re-running changes nothing. Only rows with `sourceType === null` are touched. Safe to run twice; safe to run after a partial failure. |
| Guarded | Refuses to run if it would set provenance on zero rows *and* prints why, so a no-op is distinguishable from a silent failure. |
| Reports | Prints a per-project count of rows updated and rows already set, then a total. Ends with the count of rows still `null`, which must be `0`. |
| Non-destructive | **Must not modify `notes`.** |

### 10.2 The `notes` rule

The 9 waitlist rows carry their signup date inside `notes` as prose (roadmap task 1.5).
`consentedAt` is **derived** from that prose — read it, parse it, write the timestamp to the new
column, and leave the original text exactly where it is.

Do not "clean up" `notes` afterwards. Two reasons: the prose is the human-readable evidence and
the timestamp is the queryable one, and losing the former to gain the latter is a net loss of
evidence; and a script that both derives and destroys its own input cannot be re-run, which
breaks idempotency (the second run would have nothing to parse).

If a signup date cannot be parsed from a row's notes, leave `consentedAt` null, set `sourceType`
anyway, and **list the row in the output** for manual handling. Do not guess a date. A wrong
consent timestamp is worse than a missing one — a missing one is honest.

### 10.3 Mapping

Derived from project membership and `kind`. Confirm against the real data before running; these
are the expected values, not an assertion about rows you have not looked at.

There are **three** pre-existing projects, not two. `MichiKanji — Shodo Schools` (8 rows,
`kind=collaborator`, 2 of them emailable) is easy to overlook because every other document in this
set was drafted around the two Mangood lists — and it is the project that holds both
Japanese-reading domains at PRD F8, i.e. the sharpest jurisdiction case in the whole effort.

| Rows | `sourceType` | `sourceDetail` | `consentedAt` | `jurisdiction` |
| --- | --- | --- | --- | --- |
| `Mangood — Waitlist` (9, `kind=customer`) | `waitlist_form` | The form/product name | Parsed from `notes` | Left null — set by the REQ-10b manual pass |
| `Mangood — Partners` (17, `kind=collaborator`) | `partner_sheet` | The sheet name and its date | Null — there is no consent, which is the point | Left null — set by the REQ-10b manual pass |
| `MichiKanji — Shodo Schools` (8, `kind=collaborator`) | `research` — confirm against how these were actually gathered before running; if they came from a sheet, use `partner_sheet` and name it | How they were found | Null | Left null — and these are the rows REQ-10b most needs, so do not let the backfill's silence here read as "nothing to do" |
| Anything else pre-existing | `manual` | `"pre-RS-01, source unrecorded"` | Null | Left null |

Jurisdiction is deliberately **not** backfilled by script. Guessing it from an email domain is
exactly the false confidence PRD N1 rejects — `.com` says nothing, and the company's TLD is not
the recipient's location. It is a human pass (REQ-10b), recorded in doc 05.

---

## 11. Non-functional conventions

**Match the file you are editing.** The two PATCH handlers use different idioms on purpose and are
no longer semantically parallel — `app/api/projects/[id]/route.ts:13` uses conditional spread,
`app/api/accounts/[id]/route.ts` uses a `for` loop over a const array because only that one logs
status transitions. Do not unify them as a drive-by.

**Error shapes.** New guards return `NextResponse.json({ error: "…" }, { status })` with a message
written for the toast, not for a log. The routes that already do this well are `POST /api/compose`,
`POST /api/projects`, and the Gmail route's catch — read one before writing a new one. Error
handling in this repo is uneven by acknowledgement rather than by accident (`CLAUDE.md`, "Deliberate
v1 gaps"); you are raising the floor on the routes you touch, not launching a campaign.

**Validation — narrow and deliberate.** The roadmap parks broad request validation ("zod, 500→400
… Never, absent a forcing function"). Do not add zod to the accounts or projects routes. **Do**
validate the fields that carry legal meaning, inline and without a library:

| Field | Where | Rule | On violation |
| --- | --- | --- | --- |
| `jurisdiction` | accounts POST + PATCH | Must be in `JURISDICTIONS` when present | `400`, naming the allowed values |
| `sourceType` | accounts POST + PATCH | Must be in `SOURCE_TYPES` when present | `400`, naming the allowed values |
| `consentedAt` | accounts POST + PATCH | Must parse to a valid `Date` when non-null | `400` — do not persist `Invalid Date` |
| `source` | suppressions POST (§5.5) | Must be in `OPT_OUT_SOURCES` when present | `400`, naming the allowed values |
| `optedOutAt` | suppressions POST (§5.5) | Must parse to a valid `Date` when non-null | `400` — do not persist `Invalid Date` |
| `email` | suppressions POST (§5.5) | Must normalize to a non-empty string | `400` — a suppression with no key silently protects nobody |

This is the forcing function the roadmap was waiting for, scoped to five fields across two routes.
`jurisdiction` in particular gates a legal decision (§5.2 check 7): a typo like `"eu"` would
silently fall outside `CONSENT_FIRST_JURISDICTIONS` and disable the gate for that contact, with
nothing visible anywhere. Put the shared helper in `lib/contacts.ts` beside `normalizeEmail`, since
that file is explicitly "the home for domain helpers".

`CRM_SENDER_LEGAL_NAME` and `CRM_SENDER_POSTAL_ADDRESS` are deliberately **not** validated beyond
non-blank — they are free text by nature, there is no vocabulary to check them against, and the
control that matters is the fail-closed guard at §6.3 plus a human reading a real draft.

**Lint invariant.** `npm run lint` must still report **exactly 3** pre-existing
`react-hooks/set-state-in-effect` errors. Not 2, not 4. Adding a `useEffect` that calls `setState`
to `account-detail.tsx` for suppression UI would make it 4 — derive from `local` instead (§12.1).

**Tailwind.** No new colour tokens. If the suppression banner needs a class, use an existing token
from `app/globals.css`, and keep it a literal class string so the scanner finds it.

---

## 12. Risks and edge cases

### 12.1 `account-detail` effects will not refresh sibling state

Both effects key on `account?.id` with `exhaustive-deps` disabled (`account-detail.tsx:44`, `:54`).
A suppression PATCH does not change the id, so a parent update for the *same* account will not
re-run them. In practice `patch()` already sets `local` optimistically and splices the parent via
`onUpdated`, so the banner will render — **provided you derive it from `local` rather than from a
new piece of state**. Deriving is also what keeps the lint count at 3 (§11).

### 12.2 Suppression must not be a blur-fired field — E6

`patch()` has no in-flight guard (`account-detail.tsx:64`). A slow PATCH resolving after a fast one
overwrites the newer edit with its stale full-row response. That is an accepted, cheap-to-notice
defect for ordinary fields. It is not acceptable for suppression: a lost opt-out is the exact
failure this whole effort exists to prevent.

**Implement suppression as a dedicated, immediate `POST /api/suppressions`** (§5.5) — a button and
a small dialog that collects `source` and `note` and fires once on confirm. Not a text input that
saves on blur, and not part of the auto-saving field set. Because it is a different route to a
different table, it cannot be caught by `patch()`'s race even by accident, which is a stronger
guarantee than the earlier "remember not to use `patch()` for this" convention.

That does mean it needs its own error handling — `patch()`'s rollback-and-toast is not in the path.
Model it on `composeWithLlm` (`:102`), which has the right shape: `try` / `catch` / toast, and
check `res.ok` before `res.json()`.

The response carries `affected` (§5.5), the ids of every account the suppression now covers. Splice
those into `CrmApp`'s array via `onUpdated` — per C4 nothing refetches, so a suppression recorded on
a contact who also exists in another project will not show its banner there until reload otherwise.
That is tolerable (the server-side controls are correct either way) but it is cheap to get right
and the whole point of the requirement is that the person is suppressed *everywhere*.

Fixing E6 generally is out of scope. Routing around it for this one field is in scope.

### 12.3 The new 409s are invisible today — this blocks REQ-03

`createDraft` (`account-detail.tsx:125`) has a `try`/`finally` and **no `catch`**. Line 142 calls
`await res.json()` before checking `res.ok`. Today that is survivable because the route's failures
return JSON. Under this spec it is not: a `500` from an unhandled Prisma error still returns
Next's HTML error page, `res.json()` throws, the rejection is unhandled, and **the operator sees
nothing at all** — no toast, no state change, just a button that stopped spinning.

Ship a `catch` on `createDraft` as part of REQ-03. Without it, the suppression and jurisdiction
409s are correct on the server and silent in the UI, which is indistinguishable from not having
built them. Model it on `composeWithLlm` (`:102`), which already has the right shape.

While you are there: `createDraft` also needs the confirm-and-retry flow for
`requiresAcknowledgement` (§5.2). Keep the retry explicit — a second POST with
`acknowledgeJurisdiction: true` — rather than a flag held in component state, so the
acknowledgement cannot leak into an unrelated later send.

### 12.4 `/queue` is a second state owner

`app/queue/page.tsx` → `queue-view.tsx` fetches `/api/queue` itself and holds its own state
(`CLAUDE.md`, "Client-heavy, one state owner"). Suppressing a contact from the CRM page will not
update an already-open `/queue` tab until reload. Acceptable — the server-side filter is the
control and it is correct on next fetch. Do not build cross-page invalidation for this; it would
be the first store in a codebase that deliberately has none.

### 12.5 Ordering hazard between the migration and the routes

**Restart `next dev` after the migration.** A dev server started before `CRM-101` holds the
pre-migration Prisma Client in memory, and `prisma generate` cannot reach into a running process.
Every write carrying a new column then fails with `Unknown argument \`sourceType\`` — a 500 that
looks like a bug in the route you just wrote and is not. Turbopack's hot reload does not help:
the stale artifact is the generated client, not your source. Kill the server and start it again.

The four edits in §3 must land in one commit. A deployed schema whose columns no route reads is
harmless; a route reading `prisma.suppression` against a schema without the table is a runtime
crash on the drafting path. If you split the work, migration first, always.

### 12.5a Deleting a contact no longer deletes their suppression

That is the intended behaviour (§7, doc 04 §6.3) and it will look like a bug the first time
somebody sees it. `DELETE /api/accounts/[id]` cascades `StatusEvent` and `Interaction` and leaves
the `Suppression` row standing, so re-creating the contact — by hand or by import — immediately
finds them suppressed again, with a timestamp older than the row.

Do not "fix" this by adding a cascade or by clearing the suppression on delete. It is the single
property that makes doc 04 §6.3's erasure-plus-objection resolution implementable, and the failure
mode it prevents is someone being re-emailed after asking to be erased *and* left alone. Note it in
`CLAUDE.md` under CRM-119 so the next reader does not tidy it away.

### 12.6 `Interaction` is adjacent but untouched

The `Interaction` model is migrated with no API and no UI, deliberately. Nothing in RS-01 writes to
it. If you find yourself adding an interaction row to log a suppression, stop — that is the message
store, it is a separate effort, and REQ-13/D20 has to be settled before it starts. The opt-out
evidence lives in `Suppression.note`.

### 12.7 Footer changes the draft, not the sent message

The footer is appended when the draft is *created*. The operator edits in Gmail and can delete it
before sending. Nothing in the app can prevent that and nothing should try. The control is that the
compliant version is what they start from and deleting it is a deliberate act. Note it in doc 04 as
a residual risk rather than engineering against it.

---

## 13. Out of scope

Everything in [01-PRD §5](01-PRD-outreach-compliance.md#5-non-goals). Restated for the two that
engineers reach for most often:

- **Do not add per-user auth or an owner column.** Roadmap D18/E1 stand; `proxy.ts` remains the
  tripwire, and nothing in RS-01 exposes the app beyond localhost.
- **Do not fix E6 generally, E4, or E7's validation surface beyond the four legal fields.** They are
  deferred with stated triggers. Routing around E6 for suppression (§12.2) and validating four
  fields (§11) is the whole of the licence this document grants.

Also out of scope: `REQ-12` (refresh-token encryption, P2 — trigger is now **roadmap Phase 0 task
0.d** or the first non-localhost deployment, whichever is first; 0.d is in flight, so expect this
during M0 rather than after M1) and any change to `prisma/seed.ts`, which remains stale against the
two-pipeline vocabulary (roadmap E7) and is not made worse by anything here.

**In scope and easily mistaken for creep**, so a reviewer citing risk R6 has the answer ready: the
`Suppression` table (§2.0), the RFC 2047 subject fix (§6.5), and the derived `optedOutAt` on
`GET /api/accounts` (§5.6). Each serves `REQ-01` or `REQ-06` as written and adds no capability.
Anything else not in this document is a roadmap line with a trigger.

**Explicitly rejected**, so it is not re-proposed: per-project footer identity as columns on
`Project`. See §6.1 — the footer names a legal entity, which sits above a campaign, and the tier
that would own it is the Product tier that roadmap D16 parks. Doc 01 §10 carries the trigger.
