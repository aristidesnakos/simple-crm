# Handoff — get the first nine emails sent

**Repo:** `/Users/ari/Documents/simple-crm` · **Written:** 2026-08-20

## Read first, in this order

1. `AGENTS.md` — this is Next.js **16**. Read `node_modules/next/dist/docs/` before
   writing any Next code. Non-negotiable; the version differs from training data.
   (Example of why: `middleware.ts` is deprecated in 16, renamed `proxy.ts`.)
2. `CLAUDE.md` — architecture and conventions. Corrected 2026-08-20, but assume some
   drift remains; verify claims against code before planning work around them.
3. `docs/ROADMAP.md` — **§7 is the important part**: nine known defects (E1–E9), each
   deferred to a stated trigger. §4 is shipped work. §3 (Phase 0, DNS/Workspace) is
   owner-only — **do not touch it.**
4. `README.md` — "Setting up Google OAuth" has the exact console click-path.
5. `.env.example` — every env var and what each one gates.

## The goal

Nine warm inbound waitlist signups, submitted 2026-04-16 to 2026-06-25, median ~104 days
stale. **Zero emails have ever been sent.** The Gmail draft path has never executed once,
because `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are empty strings.

Success is measured in emails sent, target 9. Not tasks checked.

## Step 0 — human only, cannot be delegated

Ari must do these; an agent cannot:

- Create the Google Cloud OAuth client (Web app), enable the Gmail API, add scope
  `https://www.googleapis.com/auth/gmail.compose`, redirect URI
  `http://localhost:3000/api/auth/callback/google`. Paste into `.env`.
- Run `npx auth secret` — the current `AUTH_SECRET` is a placeholder, not a real secret.
- Send **one** draft to himself, end to end, and report what broke.

Everything below is blocked until that one test send has been attempted.

## Step 1 — fix only what the test send actually breaks

Two defects sit on that untested path. Neither is as likely as first thought — verify
before touching either, and fix **only if it actually fires**:

- **E3** — `lib/auth.ts:36-66`. If the access token is expired *and* `token.refreshToken`
  is falsy, neither branch runs: it falls through to `return token` at line 66 with the
  stale expired token and no `token.error`. Separately, `token.error` is set at line 63
  and surfaced at line 71, but **nothing in the app ever reads `session.error`**.
  Symptom: an opaque 502 from Gmail instead of a "reconnect Google" prompt.
  **But it will not fire on a fresh sign-in**: lines 19-20 send `access_type=offline` and
  `prompt=consent`, so Google re-issues a refresh token every time and line 30 persists
  it. Treat E3 as latent. What can bite in the same callback: expiry is compared exactly,
  with no skew buffer, so a request landing in the final second of the hour ships an
  expired token; and `auth()` called inside a route handler cannot write a refreshed
  token back to the JWT cookie, so past the hour every draft click re-refreshes.
  Fix: set `token.error` on the missing-refresh-token path too, and read `session.error`
  in `components/crm/top-bar.tsx` (already the only caller of `signIn`/`signOut`).

- **E4** — `app/api/gmail/draft/route.ts:87-106`. `draftId` is captured at line 87 then
  discarded; `draftLink` is built from `messageId` (a different resource's id) at 95-96,
  and the DB write at 99 is gated on it. Client side
  (`components/crm/account-detail.tsx:140-150`) toasts *"Draft created in Gmail"* on any
  200 and overwrites `local.draftLink` with `undefined`, hiding the failure behind a
  success message.
  **Do not "fix" the id.** `message.id` is the right one — the Gmail UI resolves
  `#drafts?compose=<hex message id>`; `draft.data.id` is the Draft resource id
  (`r-88149...`) and produces a dead link. `drafts.create` returns `message.id` by
  default, so this is a landmine, not a first-run event.
  Fix: only overwrite `draftLink` when truthy. `draftId` is genuinely dead weight —
  returned and ignored.

- **Not on the original list, and more likely than either:** `createDraft`
  (`components/crm/account-detail.tsx:131-153`) has a `finally` but **no `catch`**, unlike
  `composeWithLlm` twelve lines above it. An unhandled 500 returns Next's HTML error page,
  `res.json()` throws, and the rejection escapes the click handler — **no toast, no error,
  the button just resets**. Reachable via the unguarded `request.json()` at
  `app/api/gmail/draft/route.ts:54` and the Prisma call at `:64-69`, which sits outside
  the try block. Keep the `next dev` terminal visible: that branch prints nothing at all
  in the browser.

- **Fires on every draft, including all nine:** `buildRawMessage` writes
  `Subject: ${subject}` as raw UTF-8, but RFC 2822 headers must be ASCII —
  `charset=utf-8` at `route.ts:27` covers the body only. `account-detail.tsx:51` builds
  `Following up — {project}` with an **em dash**, so every subject carries a raw
  multi-byte character into a header and renders as `Following up â€" Mangood` in Gmail.
  Fix: RFC 2047 encoded-words for the subject.

## Step 2 — send the nine

By hand, through the app. This is the deliverable.

## Hard constraints

- **Do not build the interaction-log UI.** The `Interaction` table is migrated
  (`20260820134639_add_interaction_log`) and intentionally has no API and no UI. A
  timeline is worth more built against real replies than an empty table. After the sends.
- **Do not set `OPENROUTER_API_KEY`.** That is E9's trigger: `/api/compose` sends contact
  names and notes to a third-party model with no disclosure, opt-out, or record. Resolve
  the disclosure gap first. The app works fully without it (the route returns 501).
- **Do not touch Phase 0** (Workspace, domain alias, SPF/DKIM/DMARC). Owner-only, and the
  nine go out from personal Gmail.
- **Do not preemptively fix E5–E9.** Each has a trigger in `docs/ROADMAP.md` §7. Three
  active build days produced zero sent emails; that is the failure mode to avoid.
- **`proxy.ts` fails closed** for `/api/*` on any non-localhost host. That is a tripwire,
  not authentication — the API has no per-user auth at all. Don't deploy this.

## Acceptance

- `npx tsc --noEmit` clean.
- `npm run lint` reports **exactly 3** `set-state-in-effect` errors — the known
  pre-existing set in `account-detail.tsx:42`, `:51`, and `crm-app.tsx:105`. Any fourth
  is yours.
- Nine emails sent.
