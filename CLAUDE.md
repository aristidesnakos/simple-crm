# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

**Install the pre-commit hook once per clone:** `git config core.hooksPath .githooks`. Hooks are
not cloned, so this is manual. It refuses staged `*.db`, `prisma/contacts.local.json`,
`docs/*.csv`, and `.claude/dev-feedback/*` — the repo is public and `.gitignore` is otherwise the
only barrier.

```bash
npm run dev                    # next dev
npm run build                  # next build
npm run lint                   # eslint (flat config, eslint-config-next)
npx prisma migrate dev --name <name>   # change schema.prisma → new migration + regenerate client
npx prisma migrate deploy      # apply existing migrations (fresh clone / deploy)
npx prisma studio              # browse prisma/dev.db
npx tsx prisma/seed.ts         # optional seed — must be run this way
```

`npx prisma db seed` does **not** work: there's no `prisma.seed` key in `package.json` and no `prisma.config.ts`. The seed is guarded — it counts projects and skips entirely if any exist, so it can't be used to reset or reseed a populated DB.

There is no test framework in this repo — don't invent test commands. `next.config.ts` is empty boilerplate and `eslint.config.mjs` adds no custom rules beyond `eslint-config-next`, so neither is a place to look for behavior.

Prisma is **v5** (`^5.22.0`) with SQLite and seven migrations (`init`, `add_status_event`, `add_kind_and_due`, `add_interaction_log`, `add_google_credential`, `add_consent_and_suppression`, `add_resend_transport`). `prisma migrate dev` refuses to run in a non-interactive shell (an agent's); the workaround used for `add_resend_transport` was `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` into a new migration folder, then `prisma migrate deploy` — and strip Prisma's update-available banner, which that command prints to stdout and so into the file. **Restart `next dev` after running a migration** — a server started earlier holds the old generated client in memory and every write with a new column 500s with `Unknown argument`, which looks like a bug in your route and is not. `prisma/dev.db` is **gitignored, not committed** (`.gitignore` excludes `*.db` and `/prisma/*.db`) — it holds real contact data, so never `git add -f` it. Same for `/prisma/contacts.local.json` and `/docs/*.csv`, which are also gitignored real data. Note `skills-lock.json` pins nine Prisma skills including `prisma-upgrade-v7` — the repo is not on v7, so don't follow v7-shaped guidance against this schema.

Env vars (`.env`, see `.env.example`): `DATABASE_URL` and `AUTH_SECRET` are required. `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` gate Google sign-in and Gmail drafts; `OPENROUTER_API_KEY` (optional `OPENROUTER_MODEL`) gates `/api/compose` LLM drafting, which returns 501 without it. `CRM_SENDER_LEGAL_NAME` and `CRM_SENDER_POSTAL_ADDRESS` are **required for drafting** — `POST /api/gmail/draft` fails closed with a 500 naming the missing one, because every outreach email must carry a compliant footer (RS-01 REQ-06). `RESEND_API_KEY` gates sending for projects whose `sendVia` is `resend` (501 without it) and must be a **Full access** key — a Sending-access key can send but is refused by the reply poll. `CRM_I_KNOW_THE_API_IS_UNAUTHENTICATED=true` disables the `proxy.ts` host check (see below). Everything else works with no keys at all — but drafting is no longer in that set. See README.md for the Google Cloud OAuth setup (Gmail API + `gmail.compose` scope + `http://localhost:3000/api/auth/callback/google` redirect).

## Architecture

Next.js **16.3.0** (React pinned exactly at 19.2.8), App Router + Prisma/SQLite + Auth.js v5. Per AGENTS.md above, check `node_modules/next/dist/docs/` before writing Next code — App Router material is under `01-app/` (`01-getting-started/`, `02-guides/`, `03-api-reference/`).

Two-tier domain model: **Project** (top tier, and since docs/ROADMAP.md **D22** a **business**, not a campaign — D16's campaign-per-project framing is reversed, the two `Mangood — *` projects were merged by `prisma/merge-mangood.ts`, and `Account.kind` now carries the pipeline split that used to justify two rows. One consequence: a single `approach` field serves both pipelines, so the merged brief carries per-kind headings inside it; `approach` is a **writing brief addressed to the operator, not an email template** — it is rendered read-only beside the composer and passed to `/api/compose` as part of the brief, and is deliberately never pre-filled into a message body; `fromEmail` is the project's sending identity, `fromName` its display name, and `sendVia` (`gmail | resend`, docs/ROADMAP.md **D23**) which transport carries it — see the Resend section below) → **Account** (belongs to a Project, cascade-deleted with it). `Account.kind` (`customer | collaborator`) selects the status vocabulary and `nextActionDue` is what `/api/queue` orders on — both are load-bearing. Two log models hang off `Account`: `StatusEvent` (written by the accounts PATCH and by the two Resend routes when a send or a reply moves the status) and `Interaction` (written only by the Resend routes, read by `GET /api/interactions`; hand-written entries still have no UI).

### Client-heavy, one state owner

`app/page.tsx` wraps a single `"use client"` component, `components/crm/crm-app.tsx`, in `<Suspense>` (it reads `useSearchParams` to seed `?project=&account=` deep links). `CrmApp` owns *all* app state (projects, accounts, both selections) and loads it through `/api/*` routes from `useEffect`. There is a **second page and second state owner**: `app/queue/page.tsx` → `queue-view.tsx` fetches `/api/queue` itself and renders its own `TopBar` (now a nav), deep-linking back into `/`. The other CRM components (`project-sidebar`, `account-list`, `account-detail`, `top-bar`) are controlled — they receive data plus `onSelect`/`onCreated`/`onUpdated` callbacks.

The division of labor: **children own the `fetch`, `CrmApp` owns the state.** There is no store, no server-component data fetching, and nothing refetches after a mutation — the server response is spliced into the parent's arrays by hand. A new mutation that doesn't call back into `CrmApp` will leave the UI stale. Two consequences that bite:

- The account count on a project is maintained in four different places. `ProjectSidebar` synthesizes `_count` itself when creating a project (the POST response has no `_count`, and the row reads `p._count?.accounts ?? 0`); account creation increments it in `crm-app.tsx`; a project move decrements one and increments the other, also in `crm-app.tsx`; and `handleProjectUpdated` carries the existing `_count` across a project edit, because the PATCH response omits it too and the row would otherwise drop to "0 accounts". Don't "fix" the sidebar by trusting the API shape.
- Newly created accounts are appended to the end of the list, so they sit out of server order until reload. There is no sorting anywhere in the UI.

`account-detail.tsx` is an **inline auto-saving form, not a dialog**: it holds a `local` copy, mirrors on `onChange`, and PATCHes on `onBlur` with only the changed fields (the exceptions patch immediately: `Select` on `onValueChange`, the due-date input on change, and the pipeline `Select` via `changeKind`, which may patch *two* fields and toast when the current status isn't valid for the new kind). Its `patch()` rolls back `local` and toasts on failure, but has **no in-flight guard**, so blur-fired requests can race: if a slow PATCH resolves after a fast one, its stale full-row response overwrites the newer edit in the parent array. `composeWithLlm`, `createDraft`, and `patch` all check `!res.ok` and raise `sonner` toasts. Its state effects key on `account?.id` with `exhaustive-deps` disabled, so a parent update to the *same* account won't refresh `local`. The compose-template effect is the exception — it keys on the project too, so switching project does refresh it; it seeds the *subject* only, and the **body starts empty on purpose**: it used to be pre-filled with `Project.approach`, which meant pressing "Create Gmail draft" with no `OPENROUTER_API_KEY` sent the project's internal brief to a real contact. A fourth effect runs on mount only, fetching `/api/outreach/footer` once — the footer is the same for every message this deployment sends, so per-selection refetching would be noise.

Server-side, every write path hardcodes its own field list, so **adding a column to `Account` means four edits**: `prisma/schema.prisma`, the POST create in `app/api/accounts/route.ts`, the PATCH whitelist in `app/api/accounts/[id]/route.ts`, and `lib/types.ts`. One field on the `Account` *type* is **not** a column and must never be added to a whitelist: `optedOutAt` is derived per-request by the accounts GET from the `Suppression` table (see below). `Project` has the same POST/PATCH duplication. Anything needing coercion takes a fifth spot *outside* the whitelist loop: `email` goes through `normalizeEmail`, and `lastContact`/`nextActionDue` through a second loop that does `new Date()`. The accounts PATCH update runs inside a `$transaction` that also writes a `StatusEvent` on any status change — a new field belongs inside that transaction, not around it.

Search lives only in `AccountList`: client-side over the already-loaded accounts, matching `name`, `email`, and the raw `labels` string. Projects have no search or filter.

### Types are hand-mirrored, not generated

`lib/types.ts` defines `Project`/`Account`/`Suppression`/`QueueRow`/`StatusEvent`/`Interaction` by hand (dates typed as `string | null` because they cross JSON) plus `STATUS_OPTIONS_BY_KIND`, `STATUS_COLOR`, `KINDS`, `QUEUE_EXCLUDED_STATUSES`, the `Interaction` constants, and the RS-01 compliance vocabularies (`SOURCE_TYPES`, `DIRECT_SOURCE_TYPES`, `OPT_OUT_SOURCES`, `JURISDICTIONS`, `CONSENT_FIRST_JURISDICTIONS`). Because the datasource is SQLite, every one of these is a plain `String` column and the **database validates none of them**. The four compliance fields are the one exception in the *routes* — `jurisdiction`, `sourceType`, `consentedAt` and the suppression `source`/`optedOutAt` are checked against these lists by `validateComplianceFields`/`validateSuppressionFields` in `lib/contacts.ts`, because a bad value there has a legal consequence rather than a cosmetic one (a `jurisdiction` typo silently disables the consent gate). Everything else, statuses included, stays unvalidated free text on purpose. Where the allowed values live differs per field, which is easy to get wrong:

- **Account status** — `lib/types.ts` only. `STATUS_OPTIONS_BY_KIND` holds *two* vocabularies keyed on `Account.kind`: customer = `Signed Up | Emailed | Replied | Onboarded | Dormant`, collaborator = `Prospect | Contacted | Engaged | Closed Won | Closed Lost | Rejected | Parked`. The schema comment deliberately points here rather than duplicating, since one comment can't document two vocabularies.
- **Project status** (`Active | Paused | Complete`) — schema comment only. There is no constant and no picker in the UI.
- **labels** — unconstrained free text; no allowed-values list anywhere.

Neither constant constrains the other: the `Select` in `account-detail` is fed through `statusOptionsFor(kind)` in `lib/contacts.ts` (never the constant directly), and the **display string is what gets stored** (no slugs or enums). `STATUS_COLOR` covers both vocabularies, is only the status dot in `account-list` and `queue-view`, is typed `Record<string, string>` rather than keyed to the options, and needs its `?? "bg-slate-400"` fallback. Its values are raw Tailwind classes, so they must stay statically greppable for Tailwind's scanner. `Project.status` uses neither — it renders as bare text and is still not editable in the UI (the project settings dialog covers name, description, approach, and `fromEmail`, but adding a status picker would mean adding the missing constant first).

`labels` is nominally comma-separated but is **never split or trimmed anywhere** — one free-text input in, one truncated line out. There's no parsing helper to reuse; adding chips means writing one.

`lib/` holds:

- `auth.ts`, `prisma.ts`, `types.ts`, and `utils.ts` (the stock shadcn `cn`, and it stays that way).
- `contacts.ts` — the **contact** domain: `normalizeEmail`, `statusOptionsFor`, `defaultStatusFor`, the RS-01 validators (`validateComplianceFields`, `validateSuppressionFields`), and the Gmail deep-link builders (`gmailMailboxPath`, `gmailConversationUrl`).
- `outreach.ts` — the **message** domain, deliberately not part of `contacts.ts` (`normalizeEmail` and a statutory footer have nothing to say to each other): `resolveSenderIdentity`/`senderIdentityProblem` (the `CRM_SENDER_*` env pair both send paths fail closed on), `buildFooter` (the compliant footer, one builder shared by the routes and the previews so they cannot drift), `buildMessageText` (body + footer — **the chokepoint for both transports**), `encodeSubject` (RFC 2047), and the Resend-side pure helpers (`formatFrom`, `renderTemplate`/`unresolvedPlaceholders`, `isOptOutReply`, `replySubject`, `htmlToText`). It must stay **client-safe** — the invite dialog imports it to preview with the same functions the server sends with — which is why the DB-reading gates are not in it.
- `outreach-gates.ts` — server-only: `suppressionRefusal` and `jurisdictionRefusal`, the RS-01 gates shared by `POST /api/gmail/draft` and `POST /api/resend/send`. Each returns a `Refusal` or null; the route appends its own consequence sentence.
- `resend.ts` — server-only: `resendClient()` (lazy — `new Resend()` throws without a key, so never construct it at module scope), `isFatalResendError`, `listUnsubscribeHeader`, address helpers.
- `google-credential.ts` — `refreshGoogleToken` (the Google token HTTP exchange, called from the `jwt` callback), `saveGoogleCredential` (upsert; only overwrites `refreshToken` when a new one is supplied), `grantIncludesScope` (token comparison, not substring), and `getFreshGoogleAccessToken`. That last one **has no caller today** — it was built for the reply-polling path that was never started, so it is live code with no live use, not dead code to delete.
- `llm.ts` — the OpenRouter client.

`lib/prisma.ts` is the standard global-singleton guard and logs `error`/`warn` in dev, `error` otherwise; there's no query logging, so tracing N+1s means editing that line.

### Auth and Gmail

`lib/auth.ts` uses Auth.js v5 with **no database adapter**, so the JWT strategy applies by implicit default — Google's access and refresh tokens live in the JWT, and the `jwt` callback refreshes them when expired (with a 5-minute skew, because the check happens here and the token is used later in a Gmail call). The HTTP exchange itself is **not** in `auth.ts`: it lives in `lib/google-credential.ts` as `refreshGoogleToken`, so the session path and the credential-store path cannot drift apart. The `session` callback attaches `accessToken`, `error` and `scope` via `unknown` casts (module augmentation isn't set up; follow the existing cast rather than adding a partial one).

On refresh failure the `jwt` callback sets `token.error = "RefreshAccessTokenError"` and the `session` callback surfaces it. **No API route reads it** — the *client* does: `components/crm/top-bar.tsx` swaps the avatar menu for a "session expired — sign in again" button. So a stale token still yields an opaque 502 from Gmail at the point of use rather than a re-auth prompt there; the prompt is in the header, not on the draft button.

`GoogleCredential` (`prisma/schema.prisma`) persists the signed-in Google identity's tokens server-side — one row per address, and single-tenant by design, so one row in practice. Auth.js keeps owning sign-in, the session cookie, and CSRF; this exists for the one thing a JWT cookie structurally cannot do, which is hand a refresh token to code with no browser request behind it. Written from the `jwt` callback on sign-in and after a refresh, never on a plain session read. It is deliberately **not** the Auth.js Prisma adapter: the adapter requires models named `User`/`Session`/`Account`, and this schema's `Account` is a CRM contact (the naming trap below). Note the security line it draws — `refreshToken` grants ongoing Gmail access until revoked at `myaccount.google.com/permissions`, and `prisma/dev.db` is unencrypted on disk, which is fine on localhost and is the same boundary `proxy.ts` enforces.

Naming trap: the Prisma `Account` model is a **CRM contact**, which collides with NextAuth's own `Account` table. Adding a Prisma adapter later will require renaming one of them — which is exactly the rename `GoogleCredential` exists to avoid paying now.

`app/layout.tsx` strips `accessToken` — and **only** `accessToken` — from the session before it
reaches `<SessionProvider>`, so a live `gmail.compose` credential is not serialized into every
page's RSC payload. `session.error` must stay: `top-bar.tsx` reads it to show the re-auth prompt,
and removing it silently reverts that.

`POST /api/gmail/draft` reads that `accessToken` from `auth()`, builds a base64url RFC 2822 message, calls `gmail.users.drafts.create`, and writes `draftLink` back onto the Account. `buildRawMessage` appends the compliant footer via `buildMessageText` (`lib/outreach.ts`) and RFC 2047-encodes the
`Subject:` header. The footer belongs in `buildMessageText` and not in a route body, because that function is the
chokepoint every outbound message passes through — the Resend send route calls it too. The subject
encoding is not optional: headers must be ASCII, and the composer seeds every subject with an em
dash. The link is built from the nested `message.id` — **this is correct and deliberate**: the Gmail UI resolves `#drafts?compose=<message id>`, not the draft resource id, so don't "fix" it to `draft.data.id`. The mailbox path is the url-encoded signed-in email, not `u/0` — built by `gmailMailboxPath` in `lib/contacts.ts`, shared with the conversation link below, because `u/0` is whichever Google account signed in first and opens the wrong mailbox the moment a second one exists. The write-back is conditional, though — if Gmail ever omits that nested id the route still returns 200, the client toasts success, and a previously good `draftLink` is blanked in memory while the DB keeps the old value. The message also carries a `From:` header from `Project.fromEmail` when set, which is why the account is loaded before the Gmail call; Gmail rejects a `From` that isn't a verified `sendAs` alias, and `gmail.compose` can't enumerate aliases to check. Signing in is optional overall: the CRM works fully without Google, only drafting needs it.

That route is also where the compliance gates sit (the gates themselves now live in `lib/outreach-gates.ts`, shared with Resend), in order and all **before** any Gmail call: a project with `sendVia = resend` is refused with a 409 first (its From is not a Gmail alias — E5); `accountId` is required (it used to be optional, which was a bypass — no `From`, no write-back, and none of these checks); a suppression match on the normalized `to` returns **409 with no override parameter**; the jurisdiction gate returns a *different* 409 carrying `requiresAcknowledgement: true` when the contact is in `CONSENT_FIRST_JURISDICTIONS` with no `consentedAt`; and a missing `CRM_SENDER_LEGAL_NAME`/`CRM_SENDER_POSTAL_ADDRESS` returns 500. The asymmetry is the design: suppression is a "no", the jurisdiction gate is an "are you sure". The acknowledgement is per-request and is **never** written to the row, because a persisted acknowledgement is a permission. `createDraft` in `account-detail.tsx` matches this — it posts once, and only on `requiresAcknowledgement` does it `window.confirm` and post a second time with the flag, so the discriminator is read rather than the message string-matched.

`GET /api/outreach/footer` exists only so the composer can preview the exact footer the draft route will append: the composer is a client component and `process.env` isn't readable there. Both sides call `buildFooter`, which is the point (REQ-06b) — a preview that rebuilt the footer separately would drift the first time either changed. It returns `{ footer: null, problem }` rather than throwing when the identity is unconfigured, so the composer says *why* drafting will fail instead of rendering a blank box.

**Open conversation in Gmail** (`account-detail.tsx`, via `gmailConversationUrl` in `lib/contacts.ts`) is a per-contact link to `#search/from:<email> OR to:<email>` in the signed-in mailbox, addressed by url-encoded email rather than `u/0`. The **link** appears only when the contact has an email address — the helper returns `null` otherwise and the pane shows a hint instead, rather than a link that opens an empty inbox. It does not require being signed in (the mailbox falls back to `0`). Read the property carefully before touching it: this is **a plain client-side URL — no API call, no OAuth scope, no stored mail data**. It buys reply *visibility* without reply *indexing*, which would need `gmail.readonly` (a Google **restricted** scope, hence a CASA review unless the OAuth client is Internal to the Workspace tenant), a sync route, and a local message index. Gmail is already the client this mail is read and sent in, so one click into it gets the same visibility for none of that. The accepted cost, so it isn't rediscovered as a bug: no reply counts, no "who replied" column in `/queue`, no response-time statistics. Anyone reaching for a `fetch` here is re-opening that decision (**D21** in `docs/ROADMAP.md`, restated in the `lib/contacts.ts` comment block), not fixing an oversight.

### Resend transport (`sendVia = "resend"`) — docs/ROADMAP.md D23

A business whose `Project.sendVia` is `resend` (Mangood, from `Ari <ari@mail.mangood.app>`) never
touches Gmail: the CRM sends, and the CRM is the record. This **reverses** the older rule that
Resend may only sit behind Gmail as an SMTP relay — for these businesses the "record splits"
objection is gone because both directions are stored here.

- **Send** — `POST /api/resend/send` takes `{ sends: [{ accountId, subject, body,
  acknowledgeJurisdiction?, inReplyTo? }] }`, one route for the composer (a list of one) and the
  waitlist **invite dialog** (`invite-dialog.tsx`, batch with per-recipient preview). The `to` is
  read from the account row, never the request. Same gates as Gmail (suppression 409-equivalent,
  jurisdiction `requiresAcknowledgement`, identity 500), plus refusal for non-resend projects.
  One Resend call per recipient (not `/emails/batch`, which is all-or-nothing); a 401/403 or
  quota error stops the rest of the list. Results are per item with `ok`, and a request-level
  failure (no key, no identity) is a non-2xx. Idempotency key = account + hash of the final text,
  so the same message to the same person within 24h is never sent twice. **Once Resend returns an
  id the email has gone** — a later DB failure is reported as sent-with-warning, never as unsent.
  On success: outbound `Interaction` (body incl. footer), `lastContact`, `statusAfterSend`
  (Signed Up→Emailed, Prospect→Contacted) + `StatusEvent`, and a 7-day follow-up due date unless
  a future one exists. Every message carries `List-Unsubscribe: <mailto:from?subject=unsubscribe>`.
- **Receive** — `POST /api/resend/sync` ("Check replies": inbox icon above the contact list, and a
  button on `/queue`). **Polling, not a webhook**, because the app is localhost-only. Refreshes
  outbound `deliveryStatus` + `messageId` first, then pages `GET /emails/receiving` until it hits
  an already-imported id, matches by recipient **domain** → project, then sender address →
  account (fallback: In-Reply-To/References → outbound `messageId`). Unmatched senders are
  reported in the response, **not stored** — never auto-create contacts from inbound mail.
  A reply bumps `statusAfterReply` and sets `nextActionDue` to the receipt time (top of the
  queue); a reply that `isOptOutReply` writes a `Suppression` (never overwriting `optedOutAt`).
- **Read** — `GET /api/interactions?accountId=` feeds `conversation-timeline.tsx`, which
  replaces the Gmail link in `account-detail` for resend projects and offers Reply (threads via
  `inReplyTo` → server-side Message-ID lookup). Bodies render as text in `<pre>`, never HTML.
- **Never** feed a received body into `/api/compose` (D20) — inbound text is attacker-controlled.
- Resend's API returns an invalid key as `validation_error` **401**, not `invalid_api_key`; branch
  on status for auth failures, on `name` otherwise. Free plan: 100 emails/day *including received*.

### Suppression is a table, not a column — do not "simplify" it

`Suppression` (`email` as primary key, `optedOutAt`, `source`, `note`) is the do-not-contact
record, and every enforcement point matches on the **normalized email address**, never on an
account id. Two properties depend on that and both look like accidents until you know:

- **It spans projects.** `Account` is scoped to a `Project` and `email` has no unique
  constraint, so the same person legitimately holds rows in several businesses. A column would
  suppress one row and leave the others in the queue and draftable.
- **It survives erasure.** There is deliberately **no relation** to `Account`, so no cascade.
  Deleting a contact leaves their suppression standing, which is why re-creating or re-importing
  them immediately finds them suppressed with a timestamp older than the row. That is
  `docs/requirements/04-COMPLIANCE-REGISTER` §6.3's erasure-plus-objection resolution working,
  not a bug. Do not add a cascade and do not clear it on delete.

Enforced in four places, each independently: the `where` in `app/api/queue/route.ts`, a `409`
with **no override parameter** in `app/api/gmail/draft/route.ts`, a pre-insert lookup in
`prisma/import-mangood.ts`, and a banner in `account-detail`. The queue's clause carries an
`email: null` arm that is load-bearing — SQL `NOT IN` against a NULL column excludes the row, so
without it every contact with no address vanishes from the queue.

`POST /api/suppressions` is the only writer, and it is a separate route on purpose: `patch()` in
`account-detail` has no in-flight guard (E6), and routing suppression through it would put the one
write that must never be lost on the one path that can lose it. It upserts and never overwrites an
existing `optedOutAt` — the first timestamp is the one that matters — and it returns `affected`,
every account row carrying that address across every project. That return shape exists because
nothing refetches after a mutation: `opt-out-dialog.tsx` hands it to `AccountDetail`'s
`onSuppressed`, which `CrmApp` splices via `handleAccountSuppressed`, so the banner appears on the
same person in the other projects too. A suppression callback that only updated the selected row
would be silently wrong in exactly the case the table exists for.

### Deliberate v1 gaps

Single-tenant by design, and more thoroughly than "a missing auth check" — `lib/auth.ts` is imported only by the NextAuth handler, the Gmail draft route, and `app/layout.tsx` (to hydrate `SessionProvider`, which strips `accessToken` first — see the Auth and Gmail section), and the schema has **no `User` model and no owner column at all**, so ownership filtering isn't possible without a migration. Don't treat this as a bug to silently fix mid-task; flag it before adding anything network-exposed. There is no `middleware.ts` — Next 16 renamed the convention to **`proxy.ts`**, which here 403s every `/api/*` route except NextAuth's when the request hostname isn't localhost. It is a tripwire, not auth, and it is why an agent testing over a LAN IP gets 403 JSON from everything.

Matching that altitude, the API surface has:

- **Almost no request validation, with one deliberate exception.** `zod` is a dependency but validates only the *LLM's output* in `/api/compose` and the import script — still never a request body. Required-field guards exist in accounts POST, projects POST, compose, gmail draft, and suppressions POST. The exception is compliance: **accounts POST and PATCH both run `validateComplianceFields`** (hand-rolled, not zod) and suppressions POST runs `validateSuppressionFields`, returning 400. That is scoped on purpose to the fields with a legal consequence — don't read it as a green light to validate the rest. Projects PATCH and both DELETEs validate nothing, and `new Date(body.lastContact)` will still happily store `Invalid Date` (`consentedAt` is checked; `lastContact` and `nextActionDue` are not).
- **Error handling is uneven.** `/api/compose` catches its own errors with typed OpenAI branches; compose, `POST /api/projects`, the Gmail draft route, and suppressions POST each guard `request.json()` with a 400; the Gmail route also catches the Gmail call itself (502). The rest — accounts POST/PATCH, projects PATCH, both DELETEs — let a bad id surface as an unhandled Prisma `P2025` → framework 500 with no JSON error shape, with `await request.json()` unguarded. The client half is now defended where it was not: `createDraft` in `account-detail.tsx` has both a `catch` and a `finally`, and `postDraft` checks `res.ok` **before** `res.json()` — an HTML 500 used to make `res.json()` throw inside the click handler so the operator saw nothing at all, which meant a 409 nobody could see. Keep that shape if you add another mutation.
- **`DELETE /api/projects/[id]` is a hard delete** that destroys every account under it via `onDelete: Cascade`, with no confirmation and no count returned.

The two PATCH handlers use different idioms — conditional spread for projects, a `for` loop over a const array for accounts — and are no longer semantically parallel, since only the accounts one logs status transitions. Pick whichever matches the file you're editing.

Undocumented elsewhere, so noting it here: `GET /api/queue` is the only cross-project read (`force-dynamic`, filters `QUEUE_EXCLUDED_STATUSES` plus due/null, sorts in JS in two buckets because SQLite has no Prisma `nulls` ordering). `POST /api/compose` writes nothing and assembles an explicit `brief` so new columns don't silently leak into prompts. `GET /api/outreach/footer` is the composer's footer preview (see above). `POST /api/resend/send`, `POST /api/resend/sync` and `GET /api/interactions` are covered in the Resend section. `DELETE /api/accounts/[id]` exists with no UI caller, and so does `DELETE /api/suppressions?email=…` — the latter deliberately, for undoing a typo by curl; it logs loudly, and no UI should ever call it, since deleting a suppression is how somebody gets re-emailed after asking us to stop.

`prisma/` holds four scripts, all `npx tsx`, all bypassing the API — which is the accepted pattern here and is why `StatusEvent` is empty for rows that predate the UI. `seed.ts` (guarded, skips when any project exists); `import-mangood.ts` (zod-validated, reads gitignored `prisma/contacts.local.json`, and skips addresses already on the suppression list); `backfill-provenance.ts` (one-shot RS-01 provenance backfill — dry run by default, `--write` to commit, idempotent on `sourceType === null`, and it must never touch `notes`, since the signup prose there is the human-readable evidence `consentedAt` was derived from); and `export-contact.ts` (GDPR Art. 15 access request — every `Account` row for the address across *every* project, plus its `StatusEvent`/`Interaction` history and any `Suppression`, which can outlive all of them).

### UI conventions

shadcn/ui with the `radix-nova` style and `neutral` base color (`components.json`); Tailwind v4, CSS-first — there is no `tailwind.config`, and `app/globals.css` imports `tailwindcss`, `tw-animate-css`, and `shadcn/tailwind.css`, then defines every token in an `@theme inline` block over `:root` vars (achromatic OKLCH; the whole radius scale derives from `--radius: 0.625rem`). Icons: lucide. Toasts: `sonner` (`<Toaster />` mounted in `app/layout.tsx`).

Two things in the theme layer are wired but inert, so don't assume they work:

- **Dark mode is dead.** `globals.css` defines `@custom-variant dark (&:is(.dark *))` and a full `.dark` token block, but nothing ever sets the `dark` class — there is no `ThemeProvider`, and `app/layout.tsx` renders `<html>` without it or `suppressHydrationWarning`. `next-themes` is a dependency solely because `components/ui/sonner.tsx` calls `useTheme()`. Enabling dark mode means adding the provider, not writing tokens.
- **`--font-sans` is self-referential** in `globals.css` (`--font-sans: var(--font-sans)`), so the `@apply font-sans` on `html` resolves to nothing. The real families are registered by `app/layout.tsx` as `--font-geist-sans` / `--font-geist-mono`; only `--font-mono` points at its Geist variable.

TypeScript: single alias `@/*` → `./*` (repo root, not `src/`). `tsconfig.json` includes `.next/types` and `.next/dev/types`, which is what makes Next 16's generated `LayoutProps<"/">` — used in `app/layout.tsx` — resolve; that type won't exist until a build or `next dev` has run.

`ProjectSidebar` and `AccountList` duplicate the same create-dialog idiom verbatim (Dialog + local `open`, ghost `Plus` trigger, `space-y-3` body of Label/Input pairs, footer button disabled on `saving || !name.trim()`, an `if (!res.ok)` toast before the callback, reset-and-close in `try`, `catch`, and `setSaving(false)` in `finally`). It is not extracted — match it if you add a third. Note the `htmlFor` ids are unnamespaced (`pname`/`pdesc`/`papproach`/`pfrom` vs `aname`/`aemail`, and `epname`/`epdesc`/`epapproach`/`epfrom` in the settings dialog); those prefixes are the only thing preventing a DOM id collision, since the dialogs mount in the same tree.

`project-settings-dialog.tsx` is the edit counterpart and deliberately does *not* follow that idiom: it seeds its inputs by mounting a keyed inner form only while the dialog is open, rather than copying props into state from an effect the way `account-detail` does — `react-hooks/set-state-in-effect` flags that pattern, and a fresh mount per open has nothing to sync. It also checks `res.ok` *before* `res.json()`, since the projects PATCH has no error handling and a bad id returns an HTML 500. It has no delete button on purpose: `DELETE /api/projects/[id]` cascade-deletes every contact under the project.

Session state is not threaded as props — `TopBar` and `AccountDetail` each call `useSession()` independently. Do the same rather than lifting it. `TopBar` is the only caller of `signIn`/`signOut`, hardcoded to `signIn("google")`.

`components/ui/resizable.tsx` wraps **react-resizable-panels v4**, whose API differs from what older shadcn snippets use: `Group`/`Panel`/`Separator`, an `orientation` prop on the group, and sizes passed as strings (`defaultSize="18"`). Don't port v1-era `PanelGroup direction=` code into it.

### Dev feedback capture

`components/dev/dev-feedback.tsx` (ported from the swimmingrhodes-gr project) wraps a
section so right-clicking it opens a comment box; submitting rasterizes that exact
element with `html-to-image` and POSTs to `app/api/dev-feedback/route.ts`, which appends
to the gitignored `.claude/dev-feedback.json` and `.claude/dev-feedback/*.png`.
`.claude/skills/iterate/SKILL.md` is the other half — it reads the log, fixes each
item, and marks entries resolved.

Both halves are gated on `process.env.NODE_ENV !== "production"`: the component renders
children with no wrapper and no JS, and the route 404s. Wrapped sections are named
`Crm.TopBar`, `Crm.ProjectSidebar`, `Crm.AccountList`, `Crm.AccountDetail` (all in
`crm-app.tsx`) and `Queue.List` (`queue-view.tsx`) — the `name` prop is the only link
back to a file, so keep it matching the component. The wrapper is `display: contents`,
so it never affects layout but also has no box of its own; capture targets its single
child. Right-click is deliberately left alone over `input`/`textarea`/`select`/
contenteditable so paste still works inside the account form.
