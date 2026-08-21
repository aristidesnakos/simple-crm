# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

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

Prisma is **v5** (`^5.22.0`) with SQLite and four migrations (`init`, `add_status_event`, `add_kind_and_due`, `add_interaction_log`). `prisma/dev.db` is **gitignored, not committed** (`.gitignore` excludes `*.db` and `/prisma/*.db`) — it holds real contact data, so never `git add -f` it. Same for `/prisma/contacts.local.json` and `/docs/*.csv`, which are also gitignored real data. Note `skills-lock.json` pins nine Prisma skills including `prisma-upgrade-v7` — the repo is not on v7, so don't follow v7-shaped guidance against this schema.

Env vars (`.env`, see `.env.example`): `DATABASE_URL` and `AUTH_SECRET` are required. `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` gate Google sign-in and Gmail drafts; `OPENROUTER_API_KEY` (optional `OPENROUTER_MODEL`) gates `/api/compose` LLM drafting, which returns 501 without it. `CRM_I_KNOW_THE_API_IS_UNAUTHENTICATED=true` disables the `proxy.ts` host check (see below). Everything else works with no keys at all. See README.md for the Google Cloud OAuth setup (Gmail API + `gmail.compose` scope + `http://localhost:3000/api/auth/callback/google` redirect).

## Architecture

Next.js **16.3.0** (React pinned exactly at 19.2.8), App Router + Prisma/SQLite + Auth.js v5. Per AGENTS.md above, check `node_modules/next/dist/docs/` before writing Next code — App Router material is under `01-app/` (`01-getting-started/`, `02-guides/`, `03-api-reference/`).

Two-tier domain model: **Project** (top tier; `approach` is the outreach email template, `fromEmail` the campaign's sending identity) → **Account** (belongs to a Project, cascade-deleted with it). `Account.kind` (`customer | collaborator`) selects the status vocabulary and `nextActionDue` is what `/api/queue` orders on — both are load-bearing. Two log models hang off `Account`: `StatusEvent` (written only by the accounts PATCH) and `Interaction` (migrated, but no API and no UI yet — see `lib/types.ts`).

### Client-heavy, one state owner

`app/page.tsx` wraps a single `"use client"` component, `components/crm/crm-app.tsx`, in `<Suspense>` (it reads `useSearchParams` to seed `?project=&account=` deep links). `CrmApp` owns *all* app state (projects, accounts, both selections) and loads it through `/api/*` routes from `useEffect`. There is a **second page and second state owner**: `app/queue/page.tsx` → `queue-view.tsx` fetches `/api/queue` itself and renders its own `TopBar` (now a nav), deep-linking back into `/`. The other CRM components (`project-sidebar`, `account-list`, `account-detail`, `top-bar`) are controlled — they receive data plus `onSelect`/`onCreated`/`onUpdated` callbacks.

The division of labor: **children own the `fetch`, `CrmApp` owns the state.** There is no store, no server-component data fetching, and nothing refetches after a mutation — the server response is spliced into the parent's arrays by hand. A new mutation that doesn't call back into `CrmApp` will leave the UI stale. Two consequences that bite:

- The account count on a project is maintained in three different places. `ProjectSidebar` synthesizes `_count` itself when creating a project (the POST response has no `_count`, and the row reads `p._count?.accounts ?? 0`); account creation increments it in `crm-app.tsx`; and a project move decrements one and increments the other, also in `crm-app.tsx`. Don't "fix" the sidebar by trusting the API shape.
- Newly created accounts are appended to the end of the list, so they sit out of server order until reload. There is no sorting anywhere in the UI.

`account-detail.tsx` is an **inline auto-saving form, not a dialog**: it holds a `local` copy, mirrors on `onChange`, and PATCHes on `onBlur` with only the changed fields (the exceptions patch immediately: `Select` on `onValueChange`, the due-date input on change, and the pipeline `Select` via `changeKind`, which may patch *two* fields and toast when the current status isn't valid for the new kind). Its `patch()` rolls back `local` and toasts on failure, but has **no in-flight guard**, so blur-fired requests can race: if a slow PATCH resolves after a fast one, its stale full-row response overwrites the newer edit in the parent array. `composeWithLlm`, `createDraft`, and `patch` all check `!res.ok` and raise `sonner` toasts. Its state effects key on `account?.id` with `exhaustive-deps` disabled, so a parent update to the *same* account won't refresh `local`. The compose-template effect is the exception — it keys on the project too, so switching project does refresh it.

Server-side, every write path hardcodes its own field list, so **adding a column to `Account` means four edits**: `prisma/schema.prisma`, the POST create in `app/api/accounts/route.ts`, the PATCH whitelist in `app/api/accounts/[id]/route.ts`, and `lib/types.ts`. `Project` has the same POST/PATCH duplication. Anything needing coercion takes a fifth spot *outside* the whitelist loop: `email` goes through `normalizeEmail`, and `lastContact`/`nextActionDue` through a second loop that does `new Date()`. The accounts PATCH update runs inside a `$transaction` that also writes a `StatusEvent` on any status change — a new field belongs inside that transaction, not around it.

Search lives only in `AccountList`: client-side over the already-loaded accounts, matching `name`, `email`, and the raw `labels` string. Projects have no search or filter.

### Types are hand-mirrored, not generated

`lib/types.ts` defines `Project`/`Account` by hand (dates typed as `string | null` because they cross JSON) plus `STATUS_OPTIONS_BY_KIND`, `STATUS_COLOR`, `KINDS`, `QUEUE_EXCLUDED_STATUSES`, and the `Interaction` constants. Because the datasource is SQLite, every status is a plain `String` column and **nothing validates any of them server-side**. Where the allowed values live differs per field, which is easy to get wrong:

- **Account status** — `lib/types.ts` only. `STATUS_OPTIONS_BY_KIND` holds *two* vocabularies keyed on `Account.kind`: customer = `Signed Up | Emailed | Replied | Onboarded | Dormant`, collaborator = `Prospect | Contacted | Engaged | Closed Won | Closed Lost | Rejected | Parked`. The schema comment deliberately points here rather than duplicating, since one comment can't document two vocabularies.
- **Project status** (`Active | Paused | Complete`) — schema comment only. There is no constant and no picker in the UI.
- **labels** — unconstrained free text; no allowed-values list anywhere.

Neither constant constrains the other: the `Select` in `account-detail` is fed through `statusOptionsFor(kind)` in `lib/contacts.ts` (never the constant directly), and the **display string is what gets stored** (no slugs or enums). `STATUS_COLOR` covers both vocabularies, is only the status dot in `account-list` and `queue-view`, is typed `Record<string, string>` rather than keyed to the options, and needs its `?? "bg-slate-400"` fallback. Its values are raw Tailwind classes, so they must stay statically greppable for Tailwind's scanner. `Project.status` uses neither — it renders as bare text and isn't editable in the UI.

`labels` is nominally comma-separated but is **never split or trimmed anywhere** — one free-text input in, one truncated line out. There's no parsing helper to reuse; adding chips means writing one.

`lib/` holds `auth.ts`, `prisma.ts`, `types.ts`, `utils.ts` (the stock shadcn `cn`, and it stays that way), `contacts.ts` (`normalizeEmail`, `statusOptionsFor`, `defaultStatusFor` — the home for domain helpers), and `llm.ts` (the OpenRouter client). `lib/prisma.ts` is the standard global-singleton guard and logs `error`/`warn` in dev, `error` otherwise; there's no query logging, so tracing N+1s means editing that line.

### Auth and Gmail

`lib/auth.ts` uses Auth.js v5 with **no database adapter**, so the JWT strategy applies by implicit default — Google's access and refresh tokens live in the JWT, and the `jwt` callback hand-rolls a refresh against `oauth2.googleapis.com/token` when expired. The `session` callback attaches `accessToken` via an `unknown` cast (module augmentation isn't set up; follow the existing cast rather than adding a partial one). On refresh failure it sets `token.error = "RefreshAccessTokenError"` and surfaces it on the session — but **no route ever reads it**, so a stale token yields a 502 from Gmail instead of a re-auth prompt.

Naming trap: the Prisma `Account` model is a **CRM contact**, which collides with NextAuth's own `Account` table. Adding a Prisma adapter later will require renaming one of them.

`POST /api/gmail/draft` reads that `accessToken` from `auth()`, builds a base64url RFC 2822 message, calls `gmail.users.drafts.create`, and writes `draftLink` back onto the Account. The link is built from the nested `message.id` — **this is correct and deliberate**: the Gmail UI resolves `#drafts?compose=<message id>`, not the draft resource id, so don't "fix" it to `draft.data.id`. The mailbox path is the url-encoded signed-in email, not `u/0`. The write-back is conditional, though — if Gmail ever omits that nested id the route still returns 200, the client toasts success, and a previously good `draftLink` is blanked in memory while the DB keeps the old value. The message also carries a `From:` header from `Project.fromEmail` when set, which is why the account is loaded before the Gmail call; Gmail rejects a `From` that isn't a verified `sendAs` alias, and `gmail.compose` can't enumerate aliases to check. Signing in is optional overall: the CRM works fully without Google, only drafting needs it.

### Deliberate v1 gaps

Single-tenant by design, and more thoroughly than "a missing auth check" — `auth` is imported only by the Gmail route and `app/layout.tsx` (to hydrate `SessionProvider` — note that puts the raw Google `accessToken` in the RSC payload), and the schema has **no `User` model and no owner column at all**, so ownership filtering isn't possible without a migration. Don't treat this as a bug to silently fix mid-task; flag it before adding anything network-exposed. There is no `middleware.ts` — Next 16 renamed the convention to **`proxy.ts`**, which here 403s every `/api/*` route except NextAuth's when the request hostname isn't localhost. It is a tripwire, not auth, and it is why an agent testing over a LAN IP gets 403 JSON from everything.

Matching that altitude, the API surface has:

- **Almost no request validation.** `zod` is a dependency but validates only the *LLM's output* in `/api/compose` and the import script — never a request body. Required-field guards exist in accounts POST, projects POST, compose, and gmail draft; both PATCHes and both DELETEs have none, and `new Date(body.lastContact)` will happily store `Invalid Date`.
- **Error handling is uneven.** `/api/compose` catches its own errors with typed OpenAI branches, `POST /api/projects` guards its `request.json()`, and the Gmail route catches the Gmail call. The rest — accounts POST/PATCH, projects PATCH, both DELETEs — let a bad id surface as an unhandled Prisma `P2025` → framework 500 with no JSON error shape, with `await request.json()` unguarded. Note the client half matters too: `createDraft` in `account-detail.tsx` has a `finally` but **no `catch`**, so an HTML 500 makes `res.json()` throw and the user sees nothing at all.
- **`DELETE /api/projects/[id]` is a hard delete** that destroys every account under it via `onDelete: Cascade`, with no confirmation and no count returned.

The two PATCH handlers use different idioms — conditional spread for projects, a `for` loop over a const array for accounts — and are no longer semantically parallel, since only the accounts one logs status transitions. Pick whichever matches the file you're editing.

Undocumented elsewhere, so noting it here: `GET /api/queue` is the only cross-project read (`force-dynamic`, filters `QUEUE_EXCLUDED_STATUSES` plus due/null, sorts in JS in two buckets because SQLite has no Prisma `nulls` ordering). `POST /api/compose` writes nothing and assembles an explicit `brief` so new columns don't silently leak into prompts. `DELETE /api/accounts/[id]` exists with no UI caller. `prisma/import-mangood.ts` is a second loader (`npx tsx`), zod-validated, reading gitignored `prisma/contacts.local.json` — it and `seed.ts` bypass the API, which is why `StatusEvent` is empty for existing rows.

### UI conventions

shadcn/ui with the `radix-nova` style and `neutral` base color (`components.json`); Tailwind v4, CSS-first — there is no `tailwind.config`, and `app/globals.css` imports `tailwindcss`, `tw-animate-css`, and `shadcn/tailwind.css`, then defines every token in an `@theme inline` block over `:root` vars (achromatic OKLCH; the whole radius scale derives from `--radius: 0.625rem`). Icons: lucide. Toasts: `sonner` (`<Toaster />` mounted in `app/layout.tsx`).

Two things in the theme layer are wired but inert, so don't assume they work:

- **Dark mode is dead.** `globals.css` defines `@custom-variant dark (&:is(.dark *))` and a full `.dark` token block, but nothing ever sets the `dark` class — there is no `ThemeProvider`, and `app/layout.tsx` renders `<html>` without it or `suppressHydrationWarning`. `next-themes` is a dependency solely because `components/ui/sonner.tsx` calls `useTheme()`. Enabling dark mode means adding the provider, not writing tokens.
- **`--font-sans` is self-referential** in `globals.css` (`--font-sans: var(--font-sans)`), so the `@apply font-sans` on `html` resolves to nothing. The real families are registered by `app/layout.tsx` as `--font-geist-sans` / `--font-geist-mono`; only `--font-mono` points at its Geist variable.

TypeScript: single alias `@/*` → `./*` (repo root, not `src/`). `tsconfig.json` includes `.next/types` and `.next/dev/types`, which is what makes Next 16's generated `LayoutProps<"/">` — used in `app/layout.tsx` — resolve; that type won't exist until a build or `next dev` has run.

`ProjectSidebar` and `AccountList` duplicate the same create-dialog idiom verbatim (Dialog + local `open`, ghost `Plus` trigger, `space-y-3` body of Label/Input pairs, footer button disabled on `saving || !name.trim()`, an `if (!res.ok)` toast before the callback, reset-and-close in `try`, `catch`, and `setSaving(false)` in `finally`). It is not extracted — match it if you add a third. Note the `htmlFor` ids are unnamespaced (`pname`/`pdesc`/`papproach` vs `aname`/`aemail`); the `p`/`a` prefix is the only thing preventing a DOM id collision, since both dialogs mount in the same tree.

Session state is not threaded as props — `TopBar` and `AccountDetail` each call `useSession()` independently. Do the same rather than lifting it. `TopBar` is the only caller of `signIn`/`signOut`, hardcoded to `signIn("google")`.

`components/ui/resizable.tsx` wraps **react-resizable-panels v4**, whose API differs from what older shadcn snippets use: `Group`/`Panel`/`Separator`, an `orientation` prop on the group, and sizes passed as strings (`defaultSize="18"`). Don't port v1-era `PanelGroup direction=` code into it.

### Dev feedback capture

`components/dev/dev-feedback.tsx` (ported from the swimmingrhodes-gr project) wraps a
section so right-clicking it opens a comment box; submitting rasterizes that exact
element with `html-to-image` and POSTs to `app/api/dev-feedback/route.ts`, which appends
to the gitignored `.claude/dev-feedback.json` and `.claude/dev-feedback/*.png`.
`.claude/skills/feedback/SKILL.md` is the other half — it reads the log, fixes each
item, and marks entries resolved.

Both halves are gated on `process.env.NODE_ENV !== "production"`: the component renders
children with no wrapper and no JS, and the route 404s. Wrapped sections are named
`Crm.TopBar`, `Crm.ProjectSidebar`, `Crm.AccountList`, `Crm.AccountDetail` (all in
`crm-app.tsx`) and `Queue.List` (`queue-view.tsx`) — the `name` prop is the only link
back to a file, so keep it matching the component. The wrapper is `display: contents`,
so it never affects layout but also has no box of its own; capture targets its single
child. Right-click is deliberately left alone over `input`/`textarea`/`select`/
contenteditable so paste still works inside the account form.
