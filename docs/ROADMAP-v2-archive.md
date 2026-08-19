# simple-crm — Roadmap

Spec-driven development plan. Each phase states its **goal**, **requirements** (numbered
and testable), **design**, **tasks**, **acceptance criteria**, and **out of scope**.
Requirements are the contract; tasks are the means. If a task doesn't serve a numbered
requirement, cut it.

Status: Phase 0 not started. Phase 1 tasks 1.f, 1.l, 1.m, 1.n done (2026-08-19).
Last updated 2026-08-07 (revision 2 — see §1.3).

---

## 1. Product intent

A clean, dedicated view of **client-work communications only**. The owner's main Gmail
inbox mixes client mail with everything else; this app is the unmixed view, organized by
project, with statistics Gmail cannot produce.

**North-star metric: reply rate.** Everything in the data model exists to make reply rate
correct and sliceable. Secondary: threads per stage, and inbound-originated vs.
outbound-originated contacts.

Sending is a means to that end, not the point of the product.

**Scope honesty.** Only three things here genuinely require code: reply rate (a
contact-level join across sent and received, which Gmail's thread-centric model cannot
express), contacts who have no mail yet (Gmail cannot represent a prospect you haven't
emailed — and that is the denominator's raw material), and contact-level state that isn't
a message (stage, next action, notes). Everything else — the unmixed view itself,
conversation rendering, a cross-project stream — is Gmail filters, labels, and deep links.
Build the reporting layer; do not build a mail client.

### 1.1 Architectural principles

| Principle | Meaning |
| --- | --- |
| **Gmail is the system of record** | The app indexes Gmail. It never becomes the primary store for message content. |
| **Index, not mirror** | Store message *metadata* (ids, direction, timestamps, addresses, headers). Bodies stay in Gmail and are never persisted. |
| **Contact-scoped reads only** | Never list the inbox. Every read is a search for an address already in the CRM. This rules out `users.history.list`, which cannot be query-filtered and returns every change in the mailbox (§4 design). |
| **Single tenant** | "Master user" is the OS user. Businesses are Projects. No `User` model, no ownership columns, no multi-tenancy. |
| **On-demand, not synced** | At tens-to-hundreds of messages, query when needed. No background jobs, no cron, no persisted refresh tokens. |
| **Human sends, app drafts** | The app composes; a human reviews and sends from a real mailbox. This is the only architecture that sits outside every bulk-sender acceptable-use policy (§1.2 D2). Preserve it deliberately. |
| **A wrong number is worse than no number** | Reply rate drives decisions. Any ambiguity — unsynced contact, bounce, draft, auto-reply — must be excluded explicitly rather than silently counted. |

### 1.2 Decision log

Settled decisions and why, so they are not relitigated.

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | Gmail API for both send and read; **not** an app-level Resend/third-party integration | Replies and sent copies must live in Gmail. A separate sending service splits the record and forces a second inbound path — i.e. the inbox replication we're avoiding, in a second database. |
| D2 | **No third-party ESP anywhere in the send path**, including as an SMTP backend | Every candidate prohibits the actual use case. Resend: "prohibited from sending unsolicited messages of any kind, **including cold outreach**." Postmark, Mailgun, SendGrid, SES all require provable opt-in. Google Workspace's own AUP prohibits unsolicited **mass** email — that qualifier is absent from all four, and a 1:1 human-sent message is not mass. Routing through a real mailbox is the policy-safe path, not a workaround. |
| D3 | **Contact-scoped search**, not the earlier threadId-only plan | threadId-only cannot see a prospect who emails first, and cannot see sends made outside the app — which would silently inflate reply rate. See §2.1. |
| D4 | **Mail infrastructure first, then read/stats** | Phase 1 backfills *warm existing* relationships. The north star measures *future cold outreach from new domains* — a cohort that does not exist until Phase 0 lands. Domain age and DNS propagation are wall-clock costs code cannot compress. Phase 0 is the calendar-critical path. |
| D5 | No Auth.js Prisma adapter; no `Account` → `Contact` rename on the critical path | The adapter was only needed for persisted refresh tokens for background sync. There is no background sync (§1.1). The rename is opportunistic cleanup, not a prerequisite. |
| D6 | No bulk send / mail merge | "Multiple emails" meant multiple *sending identities*, not blasting recipients. Bulk cold send from fresh domains is also a deliverability risk, and is what every AUP in D2 actually polices. |
| D7 | Web app, not a Gmail browser extension | An extension decorates the mixed inbox rather than unmixing it, still needs the same API backend for stats, and adds a frontend coupled to Gmail's DOM. |
| D8 | **One Google Workspace seat**, primary domain + the other three as free domain aliases | Workspace bills per *user*, not per domain: "there's no extra cost per user or group" for a user alias domain. ~$8.40/mo total on Business Starter. |
| D9 | **Consumer Gmail "Send mail as" is rejected** | Google is retiring it: "Starting January 2027, Gmail will no longer support the 'Send as' feature for third-party email addresses." Q3 2026 (now) begins the notice period; Q3–Q4 2026 is a transition in which "Gmail **may restrict new configurations**." Workspace aliases are explicitly carved out. |
| D10 | **Direction is derived from Gmail's `SENT` label**, not from a list of the user's own addresses | The label is authoritative, alias-agnostic, free in metadata format, and needs no RFC 5322 parsing. A self-address list silently misclassifies mail from any alias added later as *inbound* — inflating reply rate at exactly the point it's being measured. This also removes Phase 1's dependency on Phase 0. |
| D11 | **The app is a reporting layer that deep-links into Gmail** | Rendering conversations, fetching bodies, and a cross-project stream are Gmail's job and it does them better. See §1 "scope honesty". |

### 1.3 Revision history — what changed and why

Revision 2 (2026-08-07) reversed four decisions from revision 1. Recorded so they are not
re-derived:

| Was | Now | Why it flipped |
| --- | --- | --- |
| Phase 0 = Cloudflare Email Routing + ESP SMTP + Gmail "Send mail as", ×4 domains | Phase 0 = one Workspace seat + domain aliases | Feature is being retired (D9); every ESP bans the use case (D2); Workspace was costed as per-domain when it is per-user (D8). Any one of the three is disqualifying. |
| Workspace rejected at "~$7/user/month/**domain**" | ~$8.40/month total | Per-user billing. Domain aliases are free. The rejected option is *cheaper* than the "free" one, which needs a $20/mo ESP tier for four domains. |
| Phase 0 is a parallel owner chore; Phase 1 blocked on nothing | Phase 0 is the critical path | Phase 1 alone ships a dashboard with no relevant data in it (D4). |
| Reply rate = `contacts with ≥1 inbound ÷ contacts with ≥1 outbound` | §2.2 | The numerator was not a subset of the denominator; the formula could exceed 100%. |

---

## 2. Data model

### 2.1 Why contact-scoped search is load-bearing

Reply rate's denominator is only correct if the CRM knows about **every** email sent to a
contact — including ones sent directly from Gmail rather than through the app. An app that
records only its own sends undercounts the denominator and reports a reply rate that is
**too high, silently**.

A search for the contact's address finds the message regardless of origin. The same
mechanism therefore covers three needs at once:

1. Cold inbound from a known contact.
2. Sends made outside the app (self-correcting index).
3. Retroactive backfill of all prior history when a contact is added.

**Known limit (accepted):** a cold prospect not yet in the CRM is invisible, because there
is no address to search for. Adding the contact backfills their entire history. The
alternative — listing the inbox — is explicitly rejected.

### 2.2 Reply rate — the definition

The revision-1 formula (`contacts with ≥1 inbound ÷ contacts with ≥1 outbound`) is
arithmetically unsound: a cold-inbound contact who was never emailed has ≥1 inbound and 0
outbound, so it appears in the numerator but not the denominator, and the ratio can exceed
100%. Replaced by:

> For a cohort window **W** (contacts bucketed by the week of their first outbound) and a
> maturity period **M** (default 14 days):
>
> **Denominator** — distinct contacts, keyed by *normalized email*, whose earliest
> qualifying message is **outbound**, whose first outbound falls in W, and where
> `now ≥ firstOutbound + M`.
>
> **Numerator** — that same set, restricted to contacts with ≥1 message where
> `direction = "inbound"`, the `From` address equals the contact's address, and
> `firstOutbound < sentAt ≤ firstOutbound + M`.
>
> **Excluded from both** — `direction = "system"` (bounces, mailer-daemon,
> `Auto-Submitted: auto-replied`, `Precedence: bulk`, `List-Id` present), messages
> labelled `DRAFT` or `CHAT`, and contacts with no email address.
>
> **Slices** — by domain of the first outbound's `fromEmail`; by `Message.projectId`
> stamped at index time.
>
> **Secondaries** — thread-level reply rate (the figure that trends usefully); median
> outbound touches before first inbound; **delivery-evidence rate** (§2.6).

This makes the numerator a strict subset of the denominator, excludes inbound-originated
contacts from being scored as outreach successes, excludes bounces and auto-replies, and
is comparable period over period.

**Maturity matters more than it looks.** Without **M**, a contact emailed yesterday enters
the denominator immediately as a non-reply, so the metric moves *inversely with send
volume* — a productive week tanks it — and any trend line is a lagged plot of outreach
volume rather than a signal about outreach quality.

**Statistical honesty.** At tens of contacts split four ways, n per slice is ~15. That can
distinguish "zero" from "not zero" and nothing finer. Until n≈100 per slice, present
**counts** (sent / delivered / replied) alongside the rate, and do not act on differences
between slices.

### 2.3 New model: `Message`

Metadata index. Headers only. No bodies, ever.

```prisma
model Message {
  id              String   @id @default(cuid())
  gmailId         String                  // Gmail message id — per-mailbox, not global
  rfc822MessageId String?                 // RFC 5322 Message-ID — globally unique, survives migration
  threadId        String                  // Gmail thread id
  accountId       String                  // CRM contact (Account.id)
  account         Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  projectId       String                  // stamped at index time, immutable — see below
  direction       String                  // "inbound" | "outbound" | "system" — see lib/types.ts DIRECTION
  fromEmail       String                  // bare lowercase address, display name stripped
  toEmail         String?                 // raw To header
  ccEmail         String?                 // raw Cc header
  matchedEmail    String                  // the contact address that caused this row to exist
  subject         String?
  snippet         String?                 // Gmail returns this free; not the body
  labelIds        String                  // comma-separated Gmail labels (SENT, DRAFT, SPAM, …)
  autoSubmitted   String?                 // Auto-Submitted header, if present
  sentAt          DateTime                // from internalDate, NOT the Date header
  createdAt       DateTime @default(now())
  lastSeenAt      DateTime                // bumped on every sync touch — identifies rows deleted upstream

  @@unique([gmailId, accountId])
  @@index([accountId, direction, sentAt])
  @@index([projectId, direction, sentAt])
  @@index([threadId])
}
```

Five things here are not obvious and each fixes a specific defect:

- **`@@unique([gmailId, accountId])`, not `gmailId` as PK.** One Gmail message can involve
  two CRM contacts (`To: alice@client.com, Cc: bob@client.com`). Keying on the Gmail id
  alone renders a many-to-many as one-to-many: whoever syncs second overwrites or is lost,
  and which contact wins depends on sync order. If that message was Alice's only outbound,
  **Alice drops out of the denominator** — a contact who was emailed recorded as never
  emailed, which is the exact failure §2.1 exists to prevent. One row per (message,
  contact) pair; duplication is free at this volume. Consequence: any *message* count must
  be `DISTINCT gmailId`, any *thread* count `DISTINCT threadId`.
- **`projectId` stamped at index time.** Requirement 1.8 makes `Account.projectId` mutable.
  Joining stats through it means moving one contact silently rewrites history — project A
  loses sends it made, project B gains messages it never sent, with no audit trail. §2.5's
  "nothing is denormalized onto `Account`" governs *derived aggregates* (`origin`,
  `repliedAt`), which are recomputable. Project-at-send-time is a point-in-time fact and is
  not.
- **`sentAt` from `internalDate`.** The `Date` header is the sender's clock — routinely
  skewed. Requirement 1.6 classifies origin by which message is earliest, so an hour of
  skew on a same-day exchange can flip an outbound-originated contact to
  inbound-originated, which under §2.2 removes them from the denominator entirely.
  `internalDate` is Gmail's authoritative receipt timestamp and costs nothing.
- **`rfc822MessageId`.** Gmail message ids are per-*mailbox*, assigned on delivery. Any
  migration into a different mailbox re-delivers the mail with new ids and **orphans every
  row here**. The RFC 5322 Message-ID is globally unique and survives. Zero extra API
  calls, one column. This is why the mailbox decision (Phase 0) must precede the index
  (Phase 1).
- **`direction` is three-valued.** A binary "not-us ⇒ inbound" rule classifies a bounce as
  a reply. Across four fresh cold-outreach domains — the highest-bounce population there
  is — a dead address would post a 100% reply rate.

### 2.4 New model: `StatusEvent`

```prisma
model StatusEvent {
  id         String   @id @default(cuid())
  accountId  String
  account    Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  fromStatus String?
  toStatus   String
  changedAt  DateTime @default(now())

  @@index([accountId, changedAt])
}
```

`Account.status` is overwritten in place (`app/api/accounts/[id]/route.ts:11-21`), and
`updatedAt` is clobbered by any unrelated edit. So *"how many prospects moved to Engaged
this month"* is unanswerable — and will always be unanswerable for any period already
elapsed. Requirement 1.5 currently delivers only a point-in-time snapshot.

This is the one item on the roadmap where **every day of delay permanently destroys data
no later work can reconstruct.** Six lines in the accounts PATCH handler. Store the raw
display string, since statuses are unvalidated free text and a later rename would
otherwise orphan history.

Note: §6 item 3.3 claims reply-rate trend "requires no new data; `Message.sentAt` is
already there." True for reply-rate trend, **false for any stage trend.** They are
different features.

### 2.5 Changes to existing models

```prisma
// Account — additions
lastSyncedAt DateTime?   // null = never synced; distinguishes "no replies" from "no data"
lastSyncError String?    // surfaces partial/failed syncs rather than silently under-counting

@@index([email])

// Project — addition (Phase 2)
fromEmail    String?     // the verified sending alias for this project
```

- **`Account.email` — normalize, index, do not make unique.** `account-list.tsx:55` always
  sends `email` (initialized `""`), and `app/api/accounts/route.ts:25` uses `?? null`,
  which does not catch `""` — so empty emails are stored as `""`, not NULL. Adding
  `@unique` today therefore makes the *second* email-less contact fail a constraint that
  NULLs would have satisfied. Fix by normalizing on write
  (`body.email?.trim().toLowerCase() || null`), adding a plain index, and making the
  reply-rate unit **distinct normalized email** rather than `Account.id`. That is correct
  regardless of the uniqueness decision and survives re-filing. (SQLite unique indexes are
  case-sensitive and Prisma v5 cannot express `COLLATE NOCASE` in-schema; normalizing at
  write time avoids hand-edited migration SQL entirely.)
- **`lastSyncedAt`.** Without it there is no way to distinguish "this contact genuinely has
  no replies" from "never synced" or "sync errored halfway." A never-synced contact
  silently drops out of the denominator; a partially synced one sits in it missing its
  inbound. Given there is one try/catch in the entire API surface, partial syncs are the
  expected failure mode, not the exotic one.
- **No `SendingIdentity` model.** At four domains this is `Project.fromEmail String?`. A
  separate model's only job would be caching a verification flag Gmail authoritatively
  owns — and cached verification goes stale, so the app says verified and the send fails.
  Call `sendAs.list` live at send time instead.
- **`Project` delete is a hard delete** (`app/api/projects/[id]/route.ts`) cascading to
  `Account` and now to `Message` and `StatusEvent`. That raises the blast radius from
  "contacts you can re-add" to "the entire historical index and its stamped project
  attribution." Refuse deletion when messages exist, or soft-delete (task 1.p).
- **`Account` is the CRM contact**, not a NextAuth account. Naming collision is known and
  deliberately deferred (D5).
- Adding a column to `Account` requires four edits: `prisma/schema.prisma`, the POST create
  in `app/api/accounts/route.ts`, the PATCH whitelist in `app/api/accounts/[id]/route.ts`,
  and `lib/types.ts`. See `CLAUDE.md`.

### 2.6 Deliverability observability

Four brand-new domains sending cold-ish outreach have a substantial chance of silent
spam-foldering. If that happens **the app reports 0% reply rate with total confidence**,
and the natural conclusion is "my copy is bad" — iterating on the wrong variable for
months. The metric would be measuring DNS while looking like a signal about writing.

Cheap disambiguation, all from data the sync already fetches:

- **Bounces leave the denominator.** A hard bounce means an invalid address, not a
  non-reply. Note this exposes a real hole in contact-scoped search: the NDR arrives from
  `mailer-daemon`, not the contact, so `{from:X to:X …}` will never match it — but Gmail
  threads it into the original conversation, so `threads.get` returns it. Classify as
  `direction: "system"` and exclude.
- **Delivery-evidence rate.** Count auto-replies, out-of-office, unsubscribes, and explicit
  declines as *evidence of delivery* but not as replies. Reply rate conditioned on delivery
  evidence measures copy; unconditioned reply rate confounds copy with deliverability. Zero
  delivery evidence at n≥20 is strong evidence of non-delivery — genuine copy problems
  still generate OOOs and "no thanks."
- **Per-domain divergence.** Four domains is a natural control group, and this is the best
  justification for requirement 1.4 — better than "which business performs better."

**Operating rule:** do not run a copy-iteration loop until delivery-evidence rate is
non-trivially above zero.

---

## 3. Phase 0 — Mail infrastructure (owner task, no code)

**Goal:** a sending identity per business that will still exist in 2027, on infrastructure
whose acceptable-use policy permits the actual use case.

**Blocks:** Phase 2 fully. Also gates Phase 1's *choice of mailbox* (§2.3,
`rfc822MessageId`) — the index must be built against the mailbox you intend to keep.

### Why this replaced the previous plan

Revision 1 had four rounds of Cloudflare forwarding + ESP SMTP + Gmail "Send mail as."
Three independent disqualifications, any one sufficient — see D2, D8, D9.

### The one decision only the owner can make

**Migrate the existing personal Gmail into Workspace, or stand up Workspace fresh?**

- *Fresh* is cleaner: client mail lands in a business mailbox from day one, which is the
  unmixing the product is for, at the mailbox layer. Existing client history stays in
  personal Gmail and is not indexed.
- *Migrate* preserves history for backfill. Google's Data Migration Service still supports
  a consumer Gmail source. But migration re-delivers mail with new Gmail message ids, so
  it must happen **before** Phase 1 builds the index.

Either is defensible. Do not start Phase 1 until this is chosen.

### Requirements

| # | Requirement |
| --- | --- |
| 0.1 | A Google Workspace tenant exists on the primary business domain, with the other three added as domain aliases. |
| 0.2 | Mail sent to `<you>@<each domain>` arrives in the Workspace mailbox. |
| 0.3 | Each domain publishes SPF, DKIM, and DMARC, and passes an authentication check. |
| 0.4 | A message sent from each alias arrives at an external address with the custom domain in `From` and no "via" annotation. |
| 0.5 | The OAuth client is configured such that refresh tokens do not expire on a 7-day cycle. |

### Tasks

- [ ] **0.a** Decide migrate-vs-fresh (above). Record the decision here.
- [ ] **0.b** Create a Google Workspace Business Starter tenant on the primary domain (one seat, ~$8.40/mo).
- [ ] **0.c** Add the other three domains as **user alias domains** (free — no per-domain or per-user charge). Note: the Admin console only allows aliasing the *primary* domain; aliasing a secondary domain requires the Directory API.
- [ ] **0.d** Add per-user email aliases where a distinct local part is wanted (e.g. `hello@`), rather than the mirrored default.
- [ ] **0.e** Publish SPF and Google's DKIM record for every domain. Workspace signs with `d=<yourdomain>`, so DMARC aligns natively — no relay involved.
- [ ] **0.f** Publish DMARC at `p=none` per domain. **`p=none` provides zero spoofing protection** — it is a monitoring stage. Move to `p=quarantine` after 2–4 weeks of clean reports.
- [ ] **0.g** Verify with mail-tester.com per domain; enrol each domain in Google Postmaster Tools.
- [ ] **0.h** Send one test message per alias to an external non-Gmail address. Confirm the custom domain in `From`, no "via" annotation, and that a reply lands in the Workspace mailbox.
- [ ] **0.i** Move the OAuth client to the Workspace tenant and set the consent screen to **Internal** user type. This is exempt from verification entirely — no unverified-app screen, no user cap, and **no 7-day refresh-token expiry**, which is what the previous plan's task 0.g was working around. (If staying on a consumer account for any reason: External + In Production also avoids the 7-day expiry, with a permanent, non-resettable 100-new-user lifetime cap and the personal-use exemption from CASA. Fine at n=1.)
- [ ] **0.j** Confirm whether the Workspace tenant needs to allowlist this app's OAuth client ID under Admin console → API controls. Likely a small admin step, not a blocker, since you are the admin.
- [ ] **0.k** If migrating (0.a): run the Data Migration Service **before** any Phase 1 sync.

### Acceptance criteria

- Test mail from each of the four aliases arrives externally with the correct `From` and no "via".
- Replies land in the Workspace mailbox.
- mail-tester scores each domain with SPF, DKIM, and DMARC all passing.
- Signing into the app twice more than 7 days apart does not require re-consent.

### Out of scope

- Any third-party ESP or SMTP relay (D2).
- Consumer Gmail "Send mail as" (D9).
- Any code.

---

## 4. Phase 1 — Read and statistics core

**Goal:** a trustworthy reply-rate number. Nothing else.

**Depends on:** Phase 0's migrate-vs-fresh decision (0.a) and, if migrating, 0.k. The
*code* is otherwise unblocked and can be written in parallel with 0.b–0.j.

### Requirements

| # | Requirement |
| --- | --- |
| 1.1 | The app can read Gmail threads involving a CRM contact, without ever listing the inbox. |
| 1.2 | Every message to or from a contact is indexed, regardless of whether it was sent through this app. |
| 1.3 | Message metadata is persisted locally so statistics do not require re-querying Gmail. Message **bodies are never persisted**. |
| 1.4 | Reply rate is displayed overall and per project, per §2.2, with the contact list behind each bucket inspectable. |
| 1.5 | Contact counts per status are displayed per project, and status changes are logged from the moment this ships. |
| 1.6 | Each contact is identifiable as inbound-originated or outbound-originated. |
| 1.7 | A failed or partial API call shows an error state — never an indefinite loading state, and never stale data presented as current. |
| 1.8 | A contact can be moved to a different project, and the move is fully reflected in the UI without a reload. |
| 1.9 | Bounced and auto-replied messages are classified as `system` and excluded from both terms of the metric. |

*(Per-sending-domain reply rate moves to Phase 2 as req 2.6 — before Phase 0 lands, every
outbound `fromEmail` is the same address and the slice is one bucket identical to
"overall". It cannot be demonstrated to discriminate, which is why revision 1's Phase 1
acceptance criteria never mentioned it.)*

### Design

**Scopes.** `lib/auth.ts:6-11` currently requests `gmail.compose`, which cannot read. Phase
1 needs **`gmail.readonly` alone**. `gmail.settings.basic` is *not* required —
`users.settings.sendAs.list` accepts `gmail.readonly`. Phase 2 replaces both `compose` and
`readonly` with **`gmail.modify`**, a single scope that covers read, send, and (Phase 3)
labels. `gmail.send` is never needed — `gmail.modify` already permits sending. Note
`gmail.compose` is *already* a restricted scope, so Phase 1 does not cross a new policy
threshold; re-consent is required after any scope change.

`gmail.metadata` is disqualified on two independent grounds: it cannot use the `q`
parameter (which is the entire design, D3), and it forces `format: METADATA`.

**Sync route.** `POST /api/sync/[accountId]`:

1. Read the contact's normalized `email`. Falsy → no-op, and record why.
2. `users.threads.list` with:
   `q: "{from:X to:X cc:X bcc:X} in:anywhere"`, plus `after:<lastSyncedAt - 2 days>` on
   subsequent syncs.
   - **Braces, not `OR`.** Gmail's `to:` does **not** match Cc or Bcc — those are separate
     documented operators. Omitting them loses contacts who were Cc'd on outreach and
     replies that Cc your address, corrupting the rate in *both* directions.
   - **`in:anywhere`** because default search excludes Spam and Trash, and a spam-foldered
     reply is still a reply. Store `labelIds` and let the stats route decide policy rather
     than baking it into the query.
   - **`after:` is day-granular** in the account's timezone; the epoch-second form is
     undocumented. Two days of slop plus idempotent upserts makes that harmless.
   - Handle `nextPageToken`. A shared `info@` address will exceed one page.
3. For each thread, `users.threads.get` with `format: "metadata"` and
   `metadataHeaders: ["From","To","Cc","Subject","Date","Message-ID","Auto-Submitted","Precedence","List-Id"]`.
   **One call per thread, not per message** — `threads.get` returns every message in the
   thread. For a contact with ~20 messages across ~6 threads that is 250 quota units and 7
   round trips, versus 410 units and 21 for per-message `messages.get`. Extra headers cost
   nothing on the same call, and adding them later requires a full re-crawl — during which
   anything since deleted from Gmail is gone permanently (§2.3).
4. **Filter before indexing.** Drop messages labelled `DRAFT` or `CHAT`; drop thread
   messages in which the contact's address appears in no header (`threads.get` returns
   whole threads, including messages between you and third parties).
5. Derive `direction`: `SENT` label → `outbound`; `From` equals the contact's address →
   `inbound`; anything else (mailer-daemon, `Auto-Submitted: auto-replied`,
   `Precedence: bulk`, `List-Id` present) → `system`.
6. Upsert on `[gmailId, accountId]`. Bump `lastSeenAt`. Stamp `projectId` from the
   contact's current project.
7. Set `lastSyncedAt` on success; set `lastSyncError` and leave `lastSyncedAt` unchanged on
   failure.

⚠️ **The app's own drafts would otherwise inflate the denominator.**
`app/api/gmail/draft/route.ts` already calls `drafts.create` per contact. A draft carries
the `DRAFT` label, lives inside the thread, and matches `to:contact` — so without step 4,
every contact you drafted to and never sent enters the reply-rate denominator with no
possible reply. The app's existing headline feature would silently poison its new headline
metric.

**Refresh strategy.** Sync a contact when it is opened. **Do not build an unbounded
"refresh all"**: 100 contacts × 250 units ≈ 25,000 against a 6,000/min per-user ceiling, so
it 429s roughly four minutes in — inside a Next route handler that will time out, and with
no background jobs (§1.1) there is nowhere to put it. If a bulk refresh is wanted, chunk it
client-side (N contacts per request) with a concurrency limiter of ~4–6 and exponential
backoff on 429 / `rateLimitExceeded`.

**`users.history.list` is rejected**, not merely unchosen: it cannot be query-filtered, so
it returns every change in the mailbox — the inbox-wide listing §1.1 forbids. It is also
operationally unusable here, since historyIds are valid "typically at least a week,
sometimes only a few hours" and an out-of-range id 404s into a full sync anyway.

**Re-auth.** `lib/auth.ts:63` sets `token.error = "RefreshAccessTokenError"` and no route
reads it. With Phase 1 this stops being cosmetic: the sync route will 502 instead of
prompting re-auth. Note Google revokes refresh tokens containing Gmail scopes on password
change, and after six months unused.

### Tasks

- [ ] **1.a** Set `GMAIL_SCOPES` in `lib/auth.ts:6-11` to `gmail.readonly` (plus openid/email/profile). Drop `gmail.compose`; do not add `gmail.settings.basic` or `gmail.send`.
- [ ] **1.b** Add `Message` (§2.3) and `StatusEvent` (§2.4); add `lastSyncedAt`, `lastSyncError`, and the `email` index to `Account` (§2.5). One migration: `npx prisma migrate dev --name add_message_index`.
- [ ] **1.c** Add `Message`, `StatusEvent`, and a `DIRECTION` constant to `lib/types.ts` (hand-mirrored; dates as `string | null`). `DIRECTION` follows the `STATUS_OPTIONS` precedent, not the schema-comment-only precedent `CLAUDE.md` flags as error-prone.
- [ ] **1.d** Normalize `email` on write in `app/api/accounts/route.ts` and the PATCH handler (`?.trim().toLowerCase() || null`) — this also fixes the `""`-instead-of-NULL poisoning.
- [ ] **1.e** Build `POST /api/sync/[accountId]` per the design above, including the `DRAFT`/`CHAT` filter and three-valued direction.
- [x] **1.f** Log status changes in `app/api/accounts/[id]/route.ts` — write a `StatusEvent` whenever `status` changes. Shipped 2026-08-19: logged inside a transaction with the update.
- [ ] **1.g** Build `GET /api/stats` implementing §2.2 exactly. Return counts alongside rates, and the contact ids behind each bucket — a bare percentage is unauditable, and one you can drill into is the difference between a number that gets trusted and one that gets ignored.
- [ ] **1.h** Surface stats on their own route, not squeezed into a pane. This is the product's reason to exist; it does not belong in a header strip. *(Supersedes revision 1's Q3.)*
- [ ] **1.i** Show "last synced" per contact, and a distinct never-synced state. An unsynced contact is not a contact with no replies.
- [ ] **1.j** Add an inbound/outbound origin badge (derived from the earliest non-`system` message by `internalDate`).
- [ ] **1.k** Link each contact's threads to Gmail via `https://mail.google.com/mail/u/<idx>/#all/<threadId>` rather than rendering conversations in-app (D11).
- [x] **1.l** **Bug:** add `.catch` + error state to both fetches in `components/crm/crm-app.tsx:26-34` and `:42-45`. `setLoading(false)` at `:32` is inside `.then`, so any rejection hangs "Loading…" forever — and this fires on the *normal* error path, since every CRUD route returns an HTML 500 that makes `r.json()` throw. The second fetch is worse than a hung spinner: line 38 clears `accounts` only when `selectedProjectId` is null, so a failed fetch leaves the **previous project's contacts rendered under the new project's header**. Satisfies 1.7.
- [x] **1.m** **Bug:** fix the stale-response race at `crm-app.tsx:36-45` — no `AbortController`, no cleanup, no generation guard, and `:44` writes unconditionally. If P1 resolves after P2, `accounts` holds P1's rows under P2's label, and any edit then PATCHes a P1 contact and `handleAccountUpdated` splices it in so it persists.
- [x] **1.n** **Bug + feature:** "move to project". Five parts, not one — revision 1's task covered about a third:
  1. Add `projectId` to the PATCH whitelist at `app/api/accounts/[id]/route.ts:11-20`. Today a `PATCH {projectId}` returns **200 OK with the account unchanged**.
  2. Filter `accounts` by `projectId` in `handleAccountUpdated` — otherwise the moved contact stays visible under the old project until reload.
  3. Decrement/increment `_count` on both projects (creation already does this at `crm-app.tsx:61-67`; there is no path for a move, and `CLAUDE.md` warns the count is maintained in two independent places).
  4. `account-detail.tsx` reads `project?.name` from the *selected project* prop at `:113` and keys its compose effects on `account?.id` with exhaustive-deps disabled — after a move it names the old project and pre-fills the old project's `approach`.
  5. Add an error branch to `patch()` (`account-detail.tsx:65-68` is `if (res.ok)` with no `else`), so a failed move doesn't leave the optimistic value on screen.
  6. A project picker in `account-detail.tsx` — without one, req 1.8 has no UI path.
  Satisfies 1.8.
- [ ] **1.o** Surface `RefreshAccessTokenError` as a re-auth prompt rather than a 502, in the sync route and anywhere else reading the session.
- [ ] **1.p** Guard `DELETE /api/projects/[id]` — refuse when messages exist, or soft-delete (§2.5).
- [ ] **1.q** Update `CLAUDE.md` — new models, new routes, changed scopes, the reply-rate definition.

### Acceptance criteria

- Adding a contact with prior history and syncing produces their full past conversation.
- An email sent to a contact directly from Gmail (not the app) appears after a sync.
- A contact who was only ever **Cc'd** on outreach appears in the denominator.
- A draft created via the app and never sent does **not** put its contact in the denominator.
- A bounced address is classified `system` and appears in neither term.
- Reply rate computed by hand from Gmail search matches the app's number for one project, using §2.2's definition including the maturity window.
- Every bucket in `/api/stats` can be expanded to the contacts behind it.
- Changing a contact's status writes a `StatusEvent`.
- Stopping the dev server mid-load produces a visible error, not "Loading…" and not the previous project's contacts.
- A contact moved between projects updates both sidebar counts, leaves the old list immediately, and persists across reload.
- Re-running a sync twice changes no row.
- `npm run build` passes.

### Out of scope

- Sending anything (Phase 2).
- Writing to Gmail in any way, including labels (Phase 3).
- Storing message bodies — ever.
- Rendering conversations in-app (D11) — deep-link instead.
- Any inbox-wide listing or query not scoped to a known contact address.
- An unbounded "refresh all" (quota; see design).

---

## 5. Phase 2 — Sending from verified domains

**Goal:** send from the right business identity, from inside the app.

**Depends on:** Phase 0 complete for at least one domain, and Phase 1.

### Requirements

| # | Requirement |
| --- | --- |
| 2.1 | Each project can be assigned a sending identity, chosen from the aliases Gmail reports. |
| 2.2 | Sending a message to a contact uses that project's identity in the `From` header. |
| 2.3 | An unverified or missing identity is refused before the API call, with a clear message. |
| 2.4 | A sent message immediately appears in the contact's history and updates `lastContact`. |
| 2.5 | Sending is limited to one recipient at a time. |
| 2.6 | Reply rate is sliceable per sending domain, attributed by the domain of each contact's **first** outbound. |

### Design

`app/api/gmail/draft/route.ts:17-23` builds the RFC 2822 message and **omits `From`
entirely**, so Gmail uses the default address. Phase 2 adds a `From` sourced from
`Project.fromEmail`. Gmail rejects a `From` that is not a verified alias — a useful safety
property, not a limitation.

Verification status is read **live from `sendAs.list` at send time**, never cached (§2.5).

**Req 2.6's grouping rule must be explicit.** A naive `GROUP BY domain(fromEmail)` is wrong
three ways: on *inbound* rows `fromEmail` is the prospect's domain, so the histogram mixes
sending and receiving domains; a contact can receive outbound from two aliases over time
and would land in two buckets, so per-domain rates would not sum to overall; and `From`
arrives as `"Jamie Lee" <jamie@x.com>`, so the group-by splinters on formatting. Attribute
each contact to the domain of their **first outbound**, with `fromEmail` normalized to a
bare lowercase address on write.

`lastContact` is currently a dead column — present in schema and seed, referenced by no
component, never set. Phase 2 makes it meaningful. Note this contradicts §2.3's
"nothing is denormalized" only in appearance: it is a cached derivation, and if it ever
disagrees with `Message`, `Message` wins.

**Policy note.** Preserve the draft-then-human-send flow as the default (§1.1). An
automated send from your own Workspace mailbox is still within Google's AUP — it prohibits
unsolicited *mass* email — but the draft flow is what keeps this unambiguous, and it was
arguably the best architectural decision in the original build.

### Tasks

- [ ] **2.a** Add `Project.fromEmail String?`; migrate. (No `SendingIdentity` model — §2.5.)
- [ ] **2.b** Switch `GMAIL_SCOPES` to `gmail.modify` alone, replacing `gmail.readonly` and `gmail.compose`. Re-consent required.
- [ ] **2.c** `GET /api/sending-identities` — calls `sendAs.list` live, returns aliases with `verificationStatus`. No local table.
- [ ] **2.d** Add `fromEmail` to the projects PATCH handler (projects use conditional-spread; accounts use a `for` loop — match the file).
- [ ] **2.e** Sending-identity picker in project settings.
- [ ] **2.f** Add a `from` parameter to `buildRawMessage` (`app/api/gmail/draft/route.ts:8-30`).
- [ ] **2.g** Build `POST /api/gmail/send` — `users.messages.send`; returns `threadId` and message id.
- [ ] **2.h** On successful send, write a `Message` row **through the same upsert and normalization path as the sync** (`[gmailId, accountId]`, stamped `projectId`), or send-written and sync-written rows will flip on every sync. Set `lastContact`.
- [ ] **2.i** Guard: refuse to send when the project has no verified identity (2.3).
- [ ] **2.j** Add the per-domain slice to `/api/stats` per the first-outbound rule (2.6).
- [ ] **2.k** Fix the hardcoded `u/0` in the draft deep link (`app/api/gmail/draft/route.ts:66`) — wrong mailbox when multi-signed-into Google. Same fix applies to task 1.k's thread links.
- [ ] **2.l** Update `CLAUDE.md` and `README.md` with the Phase 0 Workspace setup procedure.

### Acceptance criteria

- A message sent from the app arrives with the custom domain in `From` and no "via" annotation.
- The reply lands in the Workspace mailbox and appears under the contact after sync.
- A project with no identity assigned shows a clear refusal, not a 500.
- The sent message appears in Gmail's Sent folder.
- With ≥2 distinct outbound `fromEmail` values present, the per-domain denominators sum to the overall denominator.

### Out of scope

- Bulk send, multi-select, mail merge (D6).
- Templating beyond the existing `Project.approach` field.
- Scheduled or delayed send.

---

## 6. Phase 3 — Optional

Only if Phases 1–2 prove out. Each item is independent.

| # | Item | Notes |
| --- | --- | --- |
| 3.1 | **Mirror CRM status to Gmail labels** | One-way, CRM → Gmail. First feature that *writes* to the mailbox — land it after the rest is trusted. Scope to status only: once Phase 0 lands, Gmail filters set *project* labels deterministically from the alias, for free. Note applying a status label retroactively relabels old threads. |
| 3.2 | **Reply-rate trend over time** | Requires no new data; `Message.sentAt` is already there. **Not true of stage trends** — those need `StatusEvent` (§2.4), which is why it ships in Phase 1. |
| 3.3 | **Follow-up prompts** | "3 contacts have gone 14 days with no reply." Reply rate is lagging; this is the leading indicator that actually causes replies. `nextAction` already exists and is inert. Cheaper than the stats surface and arguably higher value — consider promoting it. |
| 3.4 | **`Account` → `Contact` rename** | Clears the NextAuth naming collision. Cheap only while bundled with other edits to the same files. No requirement behind it. |

---

## 7. Deliberately not doing

Recorded so these don't creep back in.

| Item | Why not |
| --- | --- |
| Full inbox sync / replication | Explicit owner constraint. Contact-scoped search covers the need. |
| `users.history.list` | Cannot be query-filtered → returns the whole mailbox, violating §1.1. Also unusable without background jobs (§4 design). |
| Storing message bodies | Gmail is the store. Deep-link instead of fetching. |
| In-app conversation rendering / cross-project stream | Gmail does both better; the latter is literally multiple-inbox (D11). |
| Third-party ESP in the send path, at any layer | Every candidate's AUP prohibits the use case (D2). |
| Consumer Gmail "Send mail as" | Being retired January 2027; new configs may already be restricted (D9). |
| Google Workspace *per domain* | It's per user. Domain aliases are free (D8). This was a costing error, not a decision. |
| `SendingIdentity` model | `Project.fromEmail` plus a live `sendAs.list` call. Cached verification goes stale (§2.5). |
| Unbounded "refresh all" | Quota-bound at ~24 contacts/min against a 6,000/min ceiling, in a route handler that times out. |
| Multi-tenancy, `User` model, ownership columns | Single tenant by design. Revisit **only** if this is ever hosted or shared — at which point it is a hard blocker, not a nice-to-have. |
| Background sync / cron / persisted refresh tokens | Volume is tens-to-hundreds. On-demand is sufficient (D5). |
| Auth.js Prisma adapter | Only needed for the above. |
| zod validation layer, 500→400 across the API | Single-user local app. Polish, not product. Add opportunistically. |
| Dark mode, dead shadcn components, `next-themes` cleanup | Cosmetic. `CLAUDE.md` documents why dark mode is inert. |
| Gmail browser extension | D7. |
| Prisma v5 → v7 upgrade | No forcing function. `skills-lock.json` pins `prisma-upgrade-v7` guidance that does **not** apply to this v5 schema. |

---

## 8. Open questions

Revision 1's Q1 and Q2 are closed; Q3 is answered by task 1.h; Q4 is answered in §2.2
(creatable, excluded from the denominator, visibly flagged).

| # | Question | Blocks |
| --- | --- | --- |
| Q1 | **Migrate the personal Gmail into Workspace, or start fresh?** Migration re-assigns every Gmail message id, so it must happen before Phase 1 builds the index. | Task 0.a → all of Phase 1 |
| Q2 | **What decision will the reply-rate number cause you to make?** "Rewrite the email" needs a copy-version column nothing in the model has. "Which business to push" needs only the per-project slice. "Am I doing enough outreach" means the real metric is volume sent, and reply rate is vanity. | §2.2 scope, task 1.g |
| Q3 | **How many outreach emails per week, now and target?** At n≈15 per slice the rate distinguishes only "zero" from "not zero". If n≈100 per slice is unreachable this year, the honest headline is a **count**, not a rate. | Whether §2.2's slicing is worth building |
| Q4 | **Is this genuinely cold outreach, or warm/referral?** Warm has an order of magnitude higher reply rate, near-zero deliverability risk, and may not justify four domains at all. | Urgency of Phase 0, weight of §2.6 |
| Q5 | **Why four separate domains rather than one?** D8 settled the *cost*, not the *strategy*: four domains means four sender reputations to warm and an already-small n divided by four. One domain concentrates both. | D8, §2.6 |
| Q6 | **Do replies often come from someone other than the person emailed?** Common in B2B. Contact-scoped `{from: to: cc: bcc:}` misses it, so reply rate reads too low. Partially mitigated by indexing whole threads, but confirm the pattern before designing for it. | §2.1's accepted limit |
| Q7 | **Should pre-existing warm history count in the denominator?** Backfilling warm relationships into a metric meant to measure new cold outreach contaminates it. Needs a date floor or a cohort split — cheap now, expensive to retrofit. | §2.2's cohort window |
| Q8 | **Will anyone else ever touch this mail?** Single-tenant with no `User` model is a migration later, and a Workspace seat is where that starts to bite. | §7 multi-tenancy |
| Q9 | Does a **custom domain** count as "third-party" under the January 2027 retirement? Google names `@yahoo.com`/`@outlook.com` and carves out "Workspace aliases or other Gmail addresses you own" — a custom domain hosted outside Google is neither, but this is inference by exclusion, never a Google statement. | Nothing — Phase 0 avoids the question entirely. Recorded for completeness. |
