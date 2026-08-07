# simple-crm — Roadmap

Spec-driven development plan. Each phase states its **goal**, **requirements** (numbered
and testable), **design**, **tasks**, **acceptance criteria**, and **out of scope**.
Requirements are the contract; tasks are the means. If a task doesn't serve a numbered
requirement, cut it.

Status: Phase 0 not started. Last updated 2026-08-07.

---

## 1. Product intent

A clean, dedicated view of **client-work communications only**. The owner's main Gmail
inbox mixes client mail with everything else; this app is the unmixed view, organized by
project, with statistics Gmail cannot produce.

**North-star metric: reply rate.** Everything in the data model exists to make reply rate
correct and sliceable. Secondary: threads per stage, and inbound-originated vs.
outbound-originated contacts.

Sending is a means to that end, not the point of the product.

### 1.1 Architectural principles

| Principle | Meaning |
| --- | --- |
| **Gmail is the system of record** | The app indexes Gmail. It never becomes the primary store for message content. |
| **Index, not mirror** | Store message *metadata* (ids, direction, timestamps, addresses). Bodies stay in Gmail and are fetched on demand. |
| **Contact-scoped reads only** | Never list the inbox. Every read is a search for an address already in the CRM. |
| **Single tenant** | "Master user" is the OS user. Businesses are Projects. No `User` model, no ownership columns, no multi-tenancy. |
| **On-demand, not synced** | At tens-to-hundreds of messages, query when needed. No background jobs, no cron, no persisted refresh tokens. |

### 1.2 Decision log

Settled decisions and why, so they are not relitigated.

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | Gmail API for both send and read; **not** an app-level Resend/third-party integration | Replies and sent copies must live in Gmail. A separate sending service splits the record and forces a second inbound path — i.e. the inbox replication we're avoiding, in a second database. |
| D2 | Resend (or equivalent) belongs **behind** Gmail as the SMTP backend for a `Send mail as` alias | Gives a verified custom-domain sending identity while the app still only talks to Gmail. |
| D3 | **Contact-scoped search**, not the earlier threadId-only plan | threadId-only cannot see a prospect who emails first, and cannot see sends made outside the app — which would silently inflate reply rate. See §2.1. |
| D4 | Read/stats before send | Send is blocked on DNS/SMTP setup for 4 domains (Phase 0). Read is blocked on nothing. |
| D5 | No Auth.js Prisma adapter; no `Account` → `Contact` rename on the critical path | The adapter was only needed for persisted refresh tokens for background sync. There is no background sync (§1.1). The rename is opportunistic cleanup, not a prerequisite. |
| D6 | No bulk send / mail merge | "Multiple emails" meant multiple *sending identities*, not blasting recipients. Bulk cold send from fresh domains is also a deliverability risk. |
| D7 | Web app, not a Gmail browser extension | An extension decorates the mixed inbox rather than unmixing it, still needs the same API backend for stats, and adds a frontend coupled to Gmail's DOM. |
| D8 | Single-domain-per-business (4 domains) | Matches the existing business structure. Revisit only if the per-domain setup cost proves prohibitive. |

---

## 2. Data model

### 2.1 Why contact-scoped search is load-bearing

Reply rate is `contacts with ≥1 inbound ÷ contacts with ≥1 outbound`. The denominator is
only correct if the CRM knows about **every** email sent to a contact — including ones
sent directly from Gmail rather than through the app. An app that records only its own
sends undercounts the denominator and reports a reply rate that is **too high, silently**.

A search for `to:<contact> OR from:<contact>` finds the message regardless of origin. The
same mechanism therefore covers three needs at once:

1. Cold inbound from a known contact.
2. Sends made outside the app (self-correcting index).
3. Retroactive backfill of all prior history when a contact is added.

**Known limit (accepted):** a cold prospect not yet in the CRM is invisible, because there
is no address to search for. Adding the contact backfills their entire history. The
alternative — listing the inbox — is explicitly rejected.

### 2.2 New model: `Message`

Metadata index. Headers only. No bodies.

```prisma
model Message {
  id        String   @id            // Gmail message id
  threadId  String                  // Gmail thread id
  accountId String                  // CRM contact (Account.id)
  account   Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  direction String                  // "inbound" | "outbound"
  fromEmail String                  // which alias sent it — enables per-domain stats
  toEmail   String
  subject   String?
  snippet   String?                 // Gmail returns this free; not the body
  sentAt    DateTime
  createdAt DateTime @default(now())

  @@index([accountId, sentAt])
  @@index([threadId])
}
```

Everything requested derives from this table. **Nothing is denormalized onto `Account`** —
at this volume, derive rather than cache. `Account.origin`, `repliedAt`, and
`firstContactAt` are all computed, not stored.

### 2.3 New model: `SendingIdentity` (Phase 2)

```prisma
model SendingIdentity {
  id          String    @id @default(cuid())
  email       String    @unique       // e.g. hello@business-one.com
  displayName String?
  domain      String
  verified    Boolean   @default(false)  // mirrors Gmail sendAs verificationStatus
  createdAt   DateTime  @default(now())
  projects    Project[]
}
```

Plus `Project.sendingIdentityId String?` (nullable — existing rows are untouched).

Populated from `users.settings.sendAs.list`, not hand-entered.

### 2.4 Existing schema notes

- `Account` is the **CRM contact**, not a NextAuth account. Naming collision is known and
  deliberately deferred (D5).
- Adding a column to `Account` requires four edits: `prisma/schema.prisma`, the POST create
  in `app/api/accounts/route.ts`, the PATCH whitelist in `app/api/accounts/[id]/route.ts`,
  and `lib/types.ts`. See `CLAUDE.md`.

---

## 3. Phase 0 — Mail infrastructure (owner task, no code)

**Goal:** prove one domain can send through Gmail before any send code is written.

**Blocks:** Phase 2 only. Phase 1 proceeds in parallel.

### Requirements

| # | Requirement |
| --- | --- |
| 0.1 | At least one business domain appears in Gmail Settings → Accounts → *Send mail as* with verification confirmed. |
| 0.2 | Mail sent to that address arrives in the primary Gmail mailbox. |
| 0.3 | The OAuth consent screen no longer expires refresh tokens on a 7-day cycle. |

### Tasks

- [ ] **0.a** Pick one of the four domains as the pilot.
- [ ] **0.b** Configure inbound forwarding so `<you>@<domain>` lands in the primary Gmail mailbox (Cloudflare Email Routing is free and sufficient).
- [ ] **0.c** Obtain SMTP credentials for the domain from a sending provider (Resend, Mailgun, Postmark) and add its SPF/DKIM DNS records.
- [ ] **0.d** In Gmail → Settings → Accounts → *Send mail as* → add the address → "Send through SMTP servers" → enter the credentials.
- [ ] **0.e** Confirm the verification code Gmail emails to that address (arrives via 0.b).
- [ ] **0.f** Send one test email from the alias and confirm it lands correctly and shows the right `From`.
- [ ] **0.g** In Google Cloud Console, move the OAuth consent screen from *Testing* to *In production*. In Testing status Google expires refresh tokens after ~7 days, forcing constant re-auth. Expect an "unverified app" warning as the owner; proceeding is fine. **Verify against current Google docs — these policies change.**
- [ ] **0.h** Repeat 0.b–0.f for the remaining three domains once the pilot works.

### Acceptance criteria

- A test email sent from the alias arrives at an external address with the custom domain in `From`.
- A reply to that email lands in the primary Gmail mailbox.
- Signing into the app twice more than 7 days apart does not require re-consent.

### Out of scope

- Google Workspace per domain (~$7/user/month/domain — rejected on cost for 4 domains).
- Any code.

---

## 4. Phase 1 — Read and statistics core

**Goal:** the clean client-only view, with reply rate. This is the product.

**Depends on:** nothing. Start immediately.

### Requirements

| # | Requirement |
| --- | --- |
| 1.1 | The app can read Gmail threads involving a CRM contact, without ever listing the inbox. |
| 1.2 | Opening a contact shows their full conversation history — every message to or from that address, regardless of whether it was sent through this app. |
| 1.3 | Message metadata is persisted locally so statistics do not require re-querying Gmail. Message **bodies are not persisted**. |
| 1.4 | Reply rate is displayed overall, per project, and per sending domain. |
| 1.5 | Contact counts per status ("threads per stage") are displayed per project. |
| 1.6 | Each contact is identifiable as inbound-originated or outbound-originated. |
| 1.7 | A failed API call shows an error state, never an indefinite loading state. |
| 1.8 | A contact can be moved to a different project. |

### Design

**Scopes.** `lib/auth.ts:6-11` currently requests `gmail.compose` only, which cannot read.
Phase 1 adds read access and `sendAs` enumeration. Expected set:
`gmail.modify` + `gmail.settings.basic`. **Verify the exact minimum against Google's scope
table before wiring** — do not request more than needed. Note these are restricted scopes;
re-consent is required after the change.

**Sync route.** `POST /api/sync/[accountId]`:
1. Read the contact's `email`. No email → no-op.
2. `users.threads.list` with `q: "from:<email> OR to:<email>"`.
3. For each message, `users.messages.get` with `format: "metadata"` and
   `metadataHeaders: ["From","To","Subject","Date"]` — headers only, never the body.
4. Derive `direction` by comparing `From` against the user's own addresses (profile address
   plus every alias from `sendAs.list`).
5. Upsert `Message` rows keyed on the Gmail message id. Idempotent — re-running changes nothing.

**Thread display.** Bodies fetched on demand when a thread is expanded; not stored.

**Stats route.** `GET /api/stats?projectId=` — aggregates over `Message`, returns reply
rate overall / per project / per domain, plus status counts.

**Refresh strategy.** Sync a contact when it is opened, plus an explicit "refresh all"
control. No background jobs (§1.1). At hundreds of messages this is comfortably within
Gmail's quota; watch latency, not quota.

### Tasks

- [ ] **1.a** Verify required Gmail scopes against Google's official scope table; update `GMAIL_SCOPES` in `lib/auth.ts:6-11`.
- [ ] **1.b** Add the `Message` model (§2.2) to `prisma/schema.prisma`; run `npx prisma migrate dev --name add_message_index`.
- [ ] **1.c** Add `Message` to `lib/types.ts` (hand-mirrored; dates as `string | null` — they cross JSON).
- [ ] **1.d** Add a helper to resolve the user's own addresses (profile + `sendAs.list`), cached per request. Needs a deliberate home — `lib/` has no shared-helper module today.
- [ ] **1.e** Build `POST /api/sync/[accountId]` per the design above. Idempotent upserts.
- [ ] **1.f** Build `GET /api/messages?accountId=` returning stored metadata, newest first.
- [ ] **1.g** Build `GET /api/threads/[threadId]` fetching bodies on demand from Gmail.
- [ ] **1.h** Render conversation history in `components/crm/account-detail.tsx` — collapsed list of messages, expand to fetch body. Respect the existing inline auto-saving form pattern; do not convert it to a dialog.
- [ ] **1.i** Add an inbound/outbound origin badge to the contact (derived from the earliest `Message`).
- [ ] **1.j** Build `GET /api/stats` — reply rate overall / per project / per `fromEmail` domain, plus status counts.
- [ ] **1.k** Surface stats in the UI. Placement TBD; a project-level header strip in `account-list.tsx` is the least invasive option.
- [ ] **1.l** **Bug:** add `.catch` + error state to both fetches in `components/crm/crm-app.tsx:26-34` and `:42-45`. Currently `setLoading(false)` lives inside `.then`, so any API failure hangs on "Loading…" forever. Satisfies 1.7.
- [ ] **1.m** **Bug:** add `projectId` to the PATCH whitelist at `app/api/accounts/[id]/route.ts:11-20`, and a "move to project" control in the detail pane. Contacts currently cannot be re-filed. Satisfies 1.8.
- [ ] **1.n** Update `CLAUDE.md` — new model, new routes, changed scopes.

### Acceptance criteria

- Adding a contact with an address that has prior history, then syncing, produces their full past conversation.
- An email sent to a contact directly from Gmail (not the app) appears after a sync.
- Reply rate computed by hand from Gmail search matches the number the app reports, for one project.
- Stopping the dev server mid-load produces a visible error, not "Loading…".
- A contact moved between projects persists across reload.
- `npm run build` passes.

### Out of scope

- Sending anything (Phase 2).
- Writing to Gmail in any way, including labels (Phase 3).
- Storing message bodies — ever.
- Any inbox-wide listing or query not scoped to a known contact address.

---

## 5. Phase 2 — Sending from verified domains

**Goal:** send from the right business identity, from inside the app.

**Depends on:** Phase 0 complete for at least one domain. Phase 1 recommended first (its
`sendAs` helper is reused).

### Requirements

| # | Requirement |
| --- | --- |
| 2.1 | Each project can be assigned a verified sending identity, chosen from the aliases Gmail reports. |
| 2.2 | Sending a message to a contact uses that project's identity in the `From` header. |
| 2.3 | An unverified or missing identity is refused before the API call, with a clear message. |
| 2.4 | A sent message immediately appears in the contact's history and updates `lastContact`. |
| 2.5 | Sending is limited to one recipient at a time. |

### Design

`app/api/gmail/draft/route.ts:17-23` builds the RFC 2822 message and **omits `From`
entirely**, so Gmail uses the default address. Phase 2 adds a `From` header sourced from
the project's `SendingIdentity`. Gmail rejects a `From` that is not a verified alias — a
useful safety property, not a limitation.

`lastContact` is currently a dead column: present in the schema and seed, referenced by no
component, never set. Phase 2 makes it meaningful. It already has special handling in the
PATCH whitelist (`app/api/accounts/[id]/route.ts:23-25`) because it needs `new Date()`
coercion.

### Tasks

- [ ] **2.a** Add `SendingIdentity` + `Project.sendingIdentityId` (§2.3); migrate.
- [ ] **2.b** `GET /api/sending-identities` — calls `sendAs.list`, upserts local rows, returns them with verification status.
- [ ] **2.c** Add `sendingIdentityId` to the projects PATCH handler (note: projects use conditional-spread idiom, accounts use a `for` loop — match the file).
- [ ] **2.d** Sending-identity picker in `components/crm/project-sidebar.tsx` or project settings.
- [ ] **2.e** Add a `from` parameter to `buildRawMessage` in `app/api/gmail/draft/route.ts:8-30`.
- [ ] **2.f** Build `POST /api/gmail/send` — `users.messages.send`, returns `threadId` and message id.
- [ ] **2.g** On successful send, write a `Message` row and set `lastContact`.
- [ ] **2.h** Guard: refuse to send when the project has no verified identity (2.3).
- [ ] **2.i** Fix the hardcoded `u/0` in the draft deep link (`app/api/gmail/draft/route.ts:66`) — wrong mailbox when multi-signed-into Google.
- [ ] **2.j** Update `CLAUDE.md` and `README.md` with the per-domain setup procedure from Phase 0.

### Acceptance criteria

- A message sent from the app arrives with the custom domain in `From`.
- The reply lands in the primary Gmail mailbox and appears under the contact after sync.
- A project with no identity assigned shows a clear refusal, not a 500.
- The sent message appears in Gmail's Sent folder.

### Out of scope

- Bulk send, multi-select, mail merge (D6).
- Templating beyond the existing `Project.approach` field.
- Scheduled or delayed send.

---

## 6. Phase 3 — Optional

Only if Phases 1–2 prove out. Each item is independent.

| # | Item | Notes |
| --- | --- | --- |
| 3.1 | **Mirror CRM status/project to Gmail labels** | One-way, CRM → Gmail. Gives the project view on mobile for little code. First feature that *writes* to the mailbox — land it after the rest is trusted. Applying a status label retroactively relabels old threads; consider whether that's wanted. |
| 3.2 | **Cross-project activity view** | A single "recent client communications" stream across all projects — the fullest expression of the clean-inbox goal. |
| 3.3 | **Reply-rate trend over time** | Requires no new data; `Message.sentAt` is already there. |
| 3.4 | **`Account` → `Contact` rename** | Clears the NextAuth naming collision. Cheap only while bundled with other edits to the same files. Touches schema, both accounts routes, `lib/types.ts`, all four `components/crm/*`, plus a migration. |

---

## 7. Deliberately not doing

Recorded so these don't creep back in.

| Item | Why not |
| --- | --- |
| Full inbox sync / replication | Explicit owner constraint. Contact-scoped search covers the need. |
| Storing message bodies | Gmail is the store. Bodies on demand only. |
| Multi-tenancy, `User` model, ownership columns | Single tenant by design. Revisit **only** if this is ever hosted — at which point it is a hard blocker, not a nice-to-have. |
| Background sync / cron / persisted refresh tokens | Volume is tens-to-hundreds. On-demand is sufficient (D5). |
| Auth.js Prisma adapter | Only needed for the above. |
| zod validation layer, 500→400 across the API | Single-user local app. Polish, not product. Add opportunistically. |
| Dark mode, dead shadcn components, `next-themes` cleanup | Cosmetic. `CLAUDE.md` documents why dark mode is inert. |
| Gmail browser extension | D7. |
| Prisma v5 → v7 upgrade | No forcing function. Note `skills-lock.json` pins `prisma-upgrade-v7` guidance that does **not** apply to this v5 schema. |

---

## 8. Open questions

| # | Question | Blocks |
| --- | --- | --- |
| Q1 | Exact minimum Gmail scope set — is `gmail.modify` sufficient for send, or is `gmail.send` also required? | Task 1.a |
| Q2 | Does moving the consent screen to *In production* with unverified restricted scopes have a user cap that matters here? (Single user, so likely not.) | Task 0.g |
| Q3 | Where do project-level statistics belong in the three-pane layout without crowding it? | Task 1.k |
| Q4 | Should a contact with no email address be creatable at all? Sync silently no-ops for them today. | Task 1.e |
