# simple-crm — Roadmap (revision 3)

**2026-08-19.** Revision 2 is archived at `docs/ROADMAP-v2-archive.md` — 642 lines, 40
tasks, 4 shipped in 12 days. Its research is still good; its scope was the problem. Read
it for decision rationale (D1–D11), not for what to build.

Rule for this document: **if the next revision is longer than this one, planning has
outrun delivery again.** This is the failure mode this repo has already demonstrated once.

---

## 1. Intent

An operator's console for running several product lines at once. It answers one question:
**who am I overdue to talk to, across everything.**

**North star: open loops.** Contacts with a next action that is due, overdue, or missing.
A count and an age — never a rate.

Reply rate was the revision 2 north star. It is cut. It needs n≈100 per slice to
distinguish anything; the real list is 9 warm inbound signups. Revision 2 conceded this in
its own Q3 and specified the stats engine anyway.

## 2. Decisions added this revision

D1–D11 stand in the archive unless listed here. D21–D22 were added **2026-09-14**,
after a review of the email architecture.

| # | Decision | Rationale |
| --- | --- | --- |
| **D12** | North star is **open loops**, not reply rate. | Leading, not lagging. Works at n=9. It is also the only thing the current architecture structurally cannot show — `crm-app.tsx` holds one `selectedProjectId`. |
| **D13** | **Reverses D4.** Phase 0 (Workspace + DNS) is parallel and owner-owned, not the critical path. | D4 assumed cold outreach from new domains. The list is warm opt-in inbound, which also closes archive-Q4. Deliverability urgency (archive §2.6) drops with it. |
| **D14** | **Cut the `Message` index, the sync route, and `/api/stats`** (archive §2.3, tasks 1.a/1.b/1.e/1.g/1.j). | They exist to compute reply rate. No consumer, no build. This also closes Q1 by removing the thing a mailbox migration would orphan. |
| **D15** | **Two pipelines, one model.** `Account.kind` = `customer` \| `collaborator`, with a status vocabulary per kind. | One `STATUS_OPTIONS` list is sales vocabulary. "Closed Won" is meaningless for a waitlist signup and "Rejected" is wrong. Free-text column like every other status here. |
| **D16** | Project = **campaign, named by product** (`Mangood — Waitlist`, `Mangood — Partners`). No Product tier. | Trigger to revisit: ~3 products × 3 campaigns making the sidebar unscannable. **Reversed 2026-09-14 by D22** — the trigger fired at 2 campaigns × 1 product, and for a different reason than predicted: the sending identity, not scannability. |
| **D17** | **Keep building simple-crm.** Adopt-vs-build (EspoCRM) is deferred, not decided. | Evaluating a CRM for two days in order to send nine emails is the same disease as revision 3. Revisit at ~50 contacts across 3+ campaigns with multiple live sending identities. |
| **D19** | **OpenRouter for the LLM, not a direct provider SDK.** | Model portability is the point: one gateway, one key, and the model is a config string. Matches `~/Documents/llanai` (`lib/gpt-server.ts`), so both projects share one account and one mental model. Structured output uses the portable `json_object` mode with zod validating the parse — strict `json_schema` is enforced by only some models, which would re-couple us to a provider. |
| **D18** | **No owner column, no `Account`→`Contact` rename yet**, despite "tool now, product later". | At one owner the backfill is a one-line `UPDATE`; the expensive part is ownership filtering across every route, and that costs the same whenever it's paid. Rename trigger: the day a Prisma adapter is added, bundled with it. |
| **D21** | **Reply visibility, not reply indexing** — ship a per-contact "Open conversation in Gmail" link in `account-detail`, not a `gmail.readonly` scope, a sync route, an `Interaction` index and reply stats. **D14 is therefore not reversed.** | The index was scoped and rejected on cost/risk: `gmail.readonly` is a Google **restricted** scope, so without 0.d (OAuth client in the tenant, **Internal** consent screen) it triggers a CASA security review — weeks, uncertain outcome — and it still needs a sync route, a local metadata index, a timeline UI, and careful handling of the D20 CRM/Gmail boundary (Gmail-derived content must never enter the `/api/compose` brief). What ships instead is a plain client-side URL, `https://mail.google.com/mail/u/<url-encoded mailbox address>/#search/<url-encoded query>` with the query `from:<contact email> OR to:<contact email>`: **zero new OAuth scopes, zero sync, zero stored mail data, no re-consent**, one click from a contact to the whole thread history in Gmail — which is already where mail is read and sent (D1/D11, and answer 2 of the 2026-09-14 clarification). Accepted cost, recorded so it is not rediscovered: **no reply counts, no "who replied" column in `/queue`, no reply-rate or response-time statistics, and no way to see an unanswered thread without opening Gmail.** The statistics goal is **deferred, not abandoned**. Trigger to revisit: the day a reply rate or a response time actually has to be reported, or the day the Gmail round-trip demonstrably costs more than the index would — which is a judgement to make after a batch has actually been sent, not before. |
| **D22** | **Project = business, not campaign. Reverses D16.** `Mangood — Waitlist` (9 accounts) and `Mangood — Partners` (17) merge into one project, `Mangood` (26); `Mangood — Partners` is deleted once empty. | One row per business in the sidebar — click a business and you are in that identity; two rows for one business is the opposite of that. Each business has its own sending domain (2026-09-14 answer 1), and a sending identity belongs to a **business**, not a campaign: with two Mangood projects the same `fromEmail` has to be typed twice and drifts. `Account.kind` (D15) already carries the pipeline split, so collapsing the projects loses nothing — and it is the cheaper of the two options considered; the other was a Business tier above Project. Known rough edge: both projects' `approach` briefs are substantive and different (waitlist re-engagement vs. founder-to-founder partnership outreach), so they are **concatenated under per-pipeline headings** rather than one being discarded — `account-detail` renders `project.approach` read-only beside the composer and the operator needs whichever matches the contact's `kind`. One field now serves two pipelines; a per-kind brief is the obvious refinement if it grates. |

## 3. Phase 0 — mail infrastructure (owner, parallel, 48h timebox)

Does not block anything below. **If it is not done in 48h, the nine go out from personal
Gmail and mangood.app becomes the sender for the next batch.** The list has already decayed
a median of 103 days; that cost is real and the domain's is not.

- [ ] **0.a** Google Workspace Business Starter, one seat. Primary domain = a neutral
      company domain if one exists (this is lock-in). Other domains attach as **user alias
      domains** — verify in Admin console, not secondary domains, or it bills 4×.
- [ ] **0.b** Alias `hello@mangood.app`.
- [ ] **0.c** SPF + Google DKIM + DMARC `p=none` on mangood.app. Required before the first
      send — 6 of 9 recipients are Gmail. Verify with mail-tester.com.
- [ ] **0.d** Move the OAuth client into the tenant, consent screen **Internal** (exempt
      from verification and from the 7-day refresh-token expiry). Allowlist the client ID
      under Admin → API controls if the tenant requires it. **This is now the gate for any
      future reply indexing** (D21), not a convenience: an Internal consent screen is the
      only thing that makes a restricted scope such as `gmail.readonly` cheap later.
- [ ] **0.e** Answer archive-Q1 **fresh, not migrate** — recommended, and now cheap either
      way since D14 removed the message index that a migration would have orphaned.

**0.b + 0.c are what let E5's mitigation be lifted.** Until a `mangood.app` `sendAs` alias
actually verifies, `Project.fromEmail` stays null on the merged `Mangood` project (§7, E5).
Check Q5 before touching DNS.

## 4. Phase 1 — this week (code)

Goal: both lists are in the app, and `/queue` tells you who to talk to today.

**Schema — one migration**, `add_kind_and_due`:

- [x] **1.1** `Account.kind String @default("customer")` — `customer | collaborator`. *Shipped: migration 20260819162332_add_kind_and_due.*
- [x] **1.2** `Account.nextActionDue DateTime?`. The seed's `nextAction: "Follow up in 3
      days"` is a date trapped in free text; this is the whole argument. *Shipped: same migration.*
- [x] **1.3** `Project.fromEmail String?` (pulled forward from archive 2.a). *Shipped: schema + projects POST/PATCH.*

**Import:**

- [x] **1.4** Normalize `email` on write in both accounts routes — `?.trim().toLowerCase()
      || null`. Two of the nine need it; it also fixes `""`-instead-of-NULL. *Shipped: normalizeEmail in lib/contacts.ts, both accounts routes and both projects routes. Verified: two mixed-case waitlist rows folded on import.*
- [x] **1.5** Import the 9 CSV rows into `Mangood — Waitlist`, `kind=customer`, with
      `createdAt` set to the real submission timestamp so age is honest, and the signup
      date in `notes`. *Shipped: prisma/import-mangood.ts, 9 rows, createdAt set to submission time.*
- [x] **1.6** Import the collaborator sheet into `Mangood — Partners`,
      `kind=collaborator`. *Shipped: 17 rows from the partner sheet, 10 live + 7 Parked.*

**Vocabulary:**

- [x] **1.7** `lib/types.ts`: `STATUS_OPTIONS` → `STATUS_OPTIONS_BY_KIND`. Customer:
      `Signed Up | Emailed | Replied | Onboarded | Dormant`. Collaborator: keep the
      existing sales ladder. Extend `STATUS_COLOR` — values stay literal Tailwind classes
      so the scanner still finds them. *Shipped: STATUS_OPTIONS_BY_KIND + QUEUE_EXCLUDED_STATUSES in lib/types.ts.*
- [x] **1.8** `AccountDetail`'s `Select` reads the list for the account's `kind`. *Shipped: kind-aware Select, plus a Pipeline picker that moves status with kind.*

**The queue — this is the product:**

- [x] **1.9** `GET /api/queue` — accounts across **all** projects where `nextActionDue` is
      past or null, ordered by due date then days since `lastContact`. Returns the project
      name per row. *Shipped: GET /api/queue. Verified live: 13 rows, overdue first.*
- [x] **1.10** `/queue` on its own route with its own client component. Not a pane inside
      `crm-app.tsx` — that component owns one `selectedProjectId` and is the reason a
      cross-project view doesn't exist today. *Shipped: /queue + components/crm/queue-view.tsx, nav in TopBar. Verified in a browser.*
- [x] **1.11** `nextActionDue` editable in `account-detail`, and shown in `account-list`.
      It needs the `new Date()` coercion special case in the PATCH whitelist, same as
      `lastContact`. *Shipped: date input in account-detail, coercion in the PATCH whitelist.*

**Sending as the right identity:**

- [x] **1.12** `from` parameter on `buildRawMessage` (archive 2.f), sourced from
      `Project.fromEmail`. Null → current behavior, so this degrades cleanly if Phase 0
      slips. *Shipped: from parameter sourced from Project.fromEmail, omitted when null.*
- [x] **1.13** Fix the hardcoded `u/0` in the draft deep link (archive 2.k) — wrong mailbox
      the moment two Google accounts are signed in, which Phase 0 guarantees. *Shipped: link now addresses the mailbox by email, not index.*

- [x] **1.14** LLM drafting — `POST /api/compose` returns a subject and body for the
      composer; a human still edits and still presses send. Replaces the static
      `Project.approach` template, which could not use the per-brand outreach angle the
      partner sheet already carries. *Shipped: OpenRouter via the OpenAI-compatible SDK,
      matching `~/Documents/llanai`. Model is `OPENROUTER_MODEL`, defaulting to
      `google/gemini-3-flash-preview`. Untested end-to-end — no `OPENROUTER_API_KEY` on
      this machine; the missing-key guard returns a 501 with instructions, verified.*

### Acceptance

- `/queue` lists contacts from both projects in one view, oldest loop first.
- A draft for a `Mangood — Waitlist` contact has `From: hello@mangood.app` and opens in the
  right mailbox.
- `npm run lint` still reports exactly **3** pre-existing `set-state-in-effect` errors.
- Stopping the dev server mid-load shows an error and a retry, not "Loading…" forever
  (shipped in 1.l/1.m, never verified in a browser).

## 5. Parked

One line each. Nothing here is scheduled.

| Item | Trigger to unpark |
| --- | --- |
| Reply rate, `Message` index, `/api/sync`, `/api/stats` | ~100 contacts emailed per slice. Not this year at current volume. D21 re-confirms the cut and substitutes a Gmail deep link. |
| Adopt-vs-build (EspoCRM eval) | ~50 contacts, 3+ campaigns, multiple live sending identities (D17). |
| Product tier above Project | ~3 products × 3 campaigns (D16). |
| `Account` → `Contact` rename | The day a Prisma adapter is added (D18). |
| Owner column / multi-tenancy | The day this is hosted for anyone else (D18). |
| `POST /api/gmail/send` | When drafting-then-sending-by-hand actually becomes the bottleneck. |
| Guard `DELETE /api/projects/[id]` | Before anyone but the author can reach it. |
| Status → Gmail label mirroring, reply-rate trend | After Phase 1 is trusted. |
| Contact-scoped Gmail read + metadata index (the communications surface). Note `gmail.metadata` does **not** permit the `q` search parameter, so this needs `gmail.readonly` — a restricted scope, affordable only because 0.d's Internal consent screen exempts verification and CASA. `D20` (docs/requirements/04 §5.2) must be settled first: a read scope puts inbound bodies in the same process that builds the compose brief. | Phase 0 0.d landed, D20 recorded, **and** D21's revisit trigger fired — a reply rate that has to be reported, or a Gmail round-trip that costs more than the index. |
| `gmail.settings.basic` on the same re-consent, so `users.settings.sendAs.list` can preflight `Project.fromEmail`. Kills **E5** — the app currently cannot tell an unverified alias from a Gmail outage. | Whenever the scope is next widened; do not re-consent twice. |
| Sending-identity column on `Interaction`. Per-TLD statistics can't attribute a message without it. | The day the metadata index is built. |
| zod, 500→400, dark mode, Prisma v7 | Never, absent a forcing function. See archive §7. |

## 6. Open questions

Archive Q1 (answer: fresh), Q3, Q4 (warm), Q7 are closed or void under D12/D13/D14.

| # | Question | Blocks |
| --- | --- | --- |
| Q2 | Which domain is the Workspace primary? Lock-in. | Task 0.a |
| Q3 | Archive Q5 — why four domains rather than one? Four sender reputations divide an already-small n. | Nothing this week; revisit before domains 2–4 send. |
| Q4 | Archive Q6 — do replies come from someone other than the person emailed? | Nothing now (D14 stands under D21; there is no index that cares). |
| Q5 | Is **Resend inbound configured on `mangood.app`**? Moving MX to Google for the alias domain would break it if so. | Tasks 0.b/0.c — must be checked **before any DNS change**. |

---

## 7. Known defects, deferred with triggers

Found 2026-08-20 by a four-lens review. All verified against the code. None are
scheduled: each is deferred to a **stated trigger**, so that "later" is a condition and
not a mood. Fixed on the day they were found: the two create dialogs swallowing every
server error, and `POST /api/projects` returning a body-less 500.

**Updated 2026-09-14:** E3 and E4 are each half fixed — the rows say which half. E5's
trigger has fired; it is mitigated, not fixed.

| # | Defect | Trigger to fix |
| --- | --- | --- |
| E1 | Every `/api` route except NextAuth's is unauthenticated; `DELETE /api/projects/[id]` cascade-deletes silently. | **Any** non-localhost host. `proxy.ts` now fails closed on this, so the trigger enforces itself. Real per-user auth is still unbuilt. |
| E3 | **Partially fixed 2026-09-14.** The refresh branch of `lib/auth.ts` called `saveGoogleCredential` **without** `refreshToken`, so the persisted `GoogleCredential` row ended up with a null refresh token and `getFreshGoogleAccessToken` (`lib/google-credential.ts`) could never succeed — fixed; the refresh token is now passed through. The original stale-token path is also closed (`token.error` is set when no refresh token is stored) and there **is** a 5-minute clock-skew buffer, so the old "last second of the hour 502s" note no longer applies. What still stands: `auth()` inside a route handler cannot persist a refreshed token back to the JWT cookie, so every call past the hour mark re-refreshes. | **Latent, not imminent** — `prompt=consent` + `access_type=offline` force a refresh token on every sign-in. Trigger for the remainder: a refresh cost that shows up in draft latency, or the first server-side path with no browser request behind it (which is what `GoogleCredential` exists for). |
| E4 | **Client half fixed 2026-09-14** — `account-detail.tsx` now overwrites `draftLink` only when the response value is truthy, so a response that omits the nested `message.id` no longer blanks a good link in memory. **Server half unchanged and still standing:** the route returns 200 even when it skips the write-back, so the client still toasts success on a draft whose link was never stored. | Only if Gmail omits the nested `message.id`. Note the id choice itself is **correct** — `#drafts?compose=<message id>` is what the Gmail UI resolves; `draft.data.id` would be a dead link. |
| E5 | **Trigger fired.** `fromEmail = ari@mangood.app` was set on `Mangood — Waitlist` while no `mangood.app` `sendAs` alias has ever been verified, and the one draft ever created (Alessio, forwardfooding.com, ~2026-08-23) was built with that `From:` header. Worse, the failure mode is not the documented one: Gmail commonly **rewrites** an unverified `From` to the primary address silently rather than erroring, so the draft route's comment claiming "Gmail rejects a `From` that isn't a verified `sendAs` alias" is an **unverified assumption** — nobody has watched it fail. `gmail.compose` still cannot enumerate aliases, so the app cannot preflight without a second sensitive scope. | **Fired — mitigated, not fixed.** `fromEmail` is cleared to **null** on the merged `Mangood` project until the alias actually verifies: `buildRawMessage` omits the header when null and Gmail falls back to the mailbox default, which is the clean degradation the field was designed for (1.12). Lift the mitigation when 0.b/0.c land and an alias verifies; settle rewrite-vs-reject by observation at the same time. `mangood.app`/`michikanji` are Resend domains, not Workspace ones — each needs inbound forwarding to receive Gmail's confirmation code before `sendAs` will verify (see Q5). |
| E6 | `patch()` has no in-flight guard; a slow PATCH can revert a newer edit. | First observed lost edit. Cheap to fix, impossible to notice — accept the exposure. |
| E7 | No server-side `status`/`kind` validation; a bad value renders an unselectable `Select` with no UI path back. | **Already firing.** `prisma/seed.ts` writes `Prospect`/`Contacted` onto rows whose `kind` defaults to `customer`, whose vocabulary has neither — those rows render a blank picker today. The seed was not updated with the two-pipeline migration. |
| E8 | `StatusEvent` only records changes made through the accounts PATCH route. Imports and Prisma Studio bypass it silently. `Interaction` inherits this. | Before writing any second import script. |
| E9 | `/api/compose` sends contact names and notes to OpenRouter and onward to a third-party model. No disclosure, no opt-out, no record. | **Before `OPENROUTER_API_KEY` is ever set.** This is a disclosure gap, not a scale one — n does not make it better. |

`Interaction` is migrated (`20260820134639_add_interaction_log`) and deliberately has no
API and no UI: a timeline is worth more built against real replies than an empty table,
and until an email is sent there is no conversation to lose. Build it after the first
sends, not before.
