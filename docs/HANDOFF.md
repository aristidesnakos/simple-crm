# Handoff — get the first nine emails sent

**Repo:** `/Users/ari/Documents/simple-crm` · **Written:** 2026-09-14
(supersedes the 2026-08-20 handoff, which is now wrong in most of its particulars)

## Read first, in this order

1. `AGENTS.md` — this is Next.js **16**. Read `node_modules/next/dist/docs/` before
   writing any Next code. Non-negotiable; the version differs from training data.
   (Example of why: `middleware.ts` is deprecated in 16, renamed `proxy.ts`.)
2. `CLAUDE.md` — architecture and conventions. Assume some drift; verify claims against
   code before planning work around them.
3. `docs/ROADMAP.md` — **§2 and §7 are the important parts**: the decisions (D21 and D22
   are the newest, both 2026-09-14) and the nine known defects (E1–E9), each deferred to
   a stated trigger. §4 is shipped work. §3 (Phase 0, DNS/Workspace) is owner-only —
   **do not touch it.**
4. `README.md` — "Setting up Google OAuth" has the exact console click-path.
5. `.env.example` — every env var and what each one gates.

## The goal

Nine warm inbound waitlist signups, submitted 2026-04-16 to 2026-06-25. **Zero emails
have ever been sent.** Success is measured in emails sent, target 9. Not tasks checked.

## Current state (2026-09-14)

| | |
| --- | --- |
| Projects | **2** after the D22 merge: `Mangood` (26 accounts) and `MichiKanji — Shodo Schools` (8) |
| `StatusEvent` / `Interaction` / `Suppression` rows | **0 / 0 / 0** |
| Accounts with a `draftLink` | **1** — the only draft ever created (Alessio, ~2026-08-23) |
| Emails sent | **0** |
| Google OAuth | `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are **set**, and `AUTH_SECRET` is a real 44-char secret. The draft path is live — it has executed once. |
| `OPENROUTER_API_KEY` | **unset**, deliberately (E9). `/api/compose` returns 501 and the app works without it. |
| `Project.fromEmail` | **null** on the merged `Mangood` project — E5's mitigation, see below. |

The merge (D22) and the `fromEmail` clear are **data changes, not code changes** — both
verified against `prisma/dev.db` on 2026-09-14 (2 projects, 26 + 8, both `fromEmail`
null). The database is gitignored real contact data; never `git add -f` it.

## What changed since the 2026-08-20 handoff

- **Fixed:** the RFC 2047 subject encoding (every subject carries an em dash, so this
  fired on every draft); the missing `catch` in `createDraft`, which used to swallow an
  HTML 500 with no toast at all; and the client half of **E4** — `draftLink` is now
  overwritten only when the response value is truthy.
- **Half fixed: E3.** The refresh branch now passes `refreshToken` through to
  `saveGoogleCredential`, so the stored `GoogleCredential` row is no longer left with a
  null refresh token. A 5-minute clock-skew buffer exists. What remains is that `auth()`
  in a route handler cannot write a refreshed token back to the cookie.
- **Fired: E5.** `ari@mangood.app` was set as `fromEmail` while no `mangood.app` `sendAs`
  alias has ever verified, and the one existing draft was built with that `From:`.
  Mitigation: `fromEmail` is cleared to null until an alias verifies. See ROADMAP §7.
- **Decided: D21 and D22.** Reply *tracking* inside the CRM is not being built; a Gmail
  deep link gives reply *visibility* instead. Project now means business, not campaign.
- **Still open: E4's server half.** The draft route returns 200 even when it skips the
  `draftLink` write-back.

## Step 0 — human only, cannot be delegated

Done on this machine, kept here because a fresh clone needs it again:

- Create the Google Cloud OAuth client (Web app), enable the Gmail API, add scope
  `https://www.googleapis.com/auth/gmail.compose`, redirect URI
  `http://localhost:3000/api/auth/callback/google`. Paste into `.env`.
- Run `npx auth secret` — a placeholder `AUTH_SECRET` is not a secret.
- Set `CRM_SENDER_LEGAL_NAME` and `CRM_SENDER_POSTAL_ADDRESS`. `POST /api/gmail/draft`
  fails closed with a 500 naming the missing one: every outreach email carries a
  compliant footer (RS-01 REQ-06).
- Send **one** draft to yourself, end to end, and report what broke.

## Step 1 — send the nine

By hand, through the app. This is the deliverable. The draft path has run exactly once,
so treat the second draft as still-unproven, not as routine.

## Hard constraints

- **Do not build the interaction-log UI.** `Interaction` is migrated
  (`20260820134639_add_interaction_log`) and intentionally has no API and no UI. D21
  keeps it that way: replies are read in Gmail, not indexed here. After the sends.
- **Do not build a Gmail read path or widen the OAuth scopes.** That is D21 and its
  revisit trigger, and it is gated on Phase 0 task 0.d.
- **Do not set `OPENROUTER_API_KEY`.** That is E9's trigger: `/api/compose` sends contact
  names and notes to a third-party model with no disclosure, opt-out, or record.
- **Do not touch Phase 0** (Workspace, domain alias, SPF/DKIM/DMARC). Owner-only. Check
  ROADMAP Q5 — whether Resend inbound is configured on `mangood.app` — before any DNS
  change; moving MX to Google would break it.
- **Do not set `fromEmail` back on `Mangood`** until a `sendAs` alias actually verifies.
- **Do not preemptively fix E5–E9.** Each has a trigger in `docs/ROADMAP.md` §7.
- **`proxy.ts` fails closed** for `/api/*` on any non-localhost host. That is a tripwire,
  not authentication — the API has no per-user auth at all. Don't deploy this.

## Acceptance

- `npx tsc --noEmit` clean.
- `npm run lint` reports **exactly 3** `react-hooks/set-state-in-effect` errors and **0
  warnings**. The three are the known pre-existing set: two effects in
  `components/crm/account-detail.tsx` and one in `components/crm/crm-app.tsx`. **Any
  fourth error is new and is yours.** The warning count is 0 as of 2026-09-14, when the
  unused `eslint-disable` directive in `lib/outreach.ts` was removed — a warning is a
  regression, not background noise.
  Line numbers drift: they were `account-detail.tsx:56` / `:94` / `crm-app.tsx:106`
  earlier on 2026-09-14 and are `:65` / `:102` / `:106` after the same day's edits. Match
  on the rule and the file, not the line.
- Nine emails sent.
