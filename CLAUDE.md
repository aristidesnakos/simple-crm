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

Prisma is **v5** (`^5.22.0`) with SQLite, one `init` migration, and `prisma/dev.db` committed to the tree. Note `skills-lock.json` pins nine Prisma skills including `prisma-upgrade-v7` — the repo is not on v7, so don't follow v7-shaped guidance against this schema.

Required env vars (`.env`): `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`. See README.md for the Google Cloud OAuth setup (Gmail API + `gmail.compose` scope + `http://localhost:3000/api/auth/callback/google` redirect).

## Architecture

Next.js **16.3.0** (React pinned exactly at 19.2.8), App Router + Prisma/SQLite + Auth.js v5. Per AGENTS.md above, check `node_modules/next/dist/docs/` before writing Next code — App Router material is under `01-app/` (`01-getting-started/`, `02-guides/`, `03-api-reference/`).

Two-tier domain model: **Project** (top tier, has an `approach` field used as the outreach email template) → **Account** (belongs to a Project, cascade-deleted with it).

### Client-heavy, one state owner

`app/page.tsx` renders a single `"use client"` component, `components/crm/crm-app.tsx`, which owns *all* app state (projects, accounts, both selections) and loads it through `/api/*` routes from `useEffect`. The other CRM components (`project-sidebar`, `account-list`, `account-detail`, `top-bar`) are controlled — they receive data plus `onSelect`/`onCreated`/`onUpdated` callbacks.

The division of labor: **children own the `fetch`, `CrmApp` owns the state.** There is no store, no server-component data fetching, and nothing refetches after a mutation — the server response is spliced into the parent's arrays by hand. A new mutation that doesn't call back into `CrmApp` will leave the UI stale. Two consequences that bite:

- The account count on a project is maintained in two different places. `ProjectSidebar` synthesizes `_count` itself when creating a project (the POST response has no `_count`, and the row reads `p._count?.accounts ?? 0`), while account creation increments it up in `crm-app.tsx`. Don't "fix" the sidebar by trusting the API shape.
- Newly created accounts are appended to the end of the list, so they sit out of server order until reload. There is no sorting anywhere in the UI.

`account-detail.tsx` is an **inline auto-saving form, not a dialog**: it holds a `local` copy, mirrors on `onChange`, and PATCHes on `onBlur` with only the changed fields (`Select` is the exception — it patches immediately on `onValueChange`). Its `patch()` has **no error branch and no in-flight guard**: a failed PATCH silently leaves the optimistic value on screen, and blur-fired requests can race. The Gmail draft call is the only fetch in the app that checks `!res.ok` and raises `sonner` toasts. Its state effects key on `account?.id` with `exhaustive-deps` disabled, so a parent update to the *same* account won't refresh `local`, and switching project without switching account leaves a stale compose template.

Server-side, every write path hardcodes its own field list, so **adding a column to `Account` means four edits**: `prisma/schema.prisma`, the POST create in `app/api/accounts/route.ts`, the PATCH whitelist in `app/api/accounts/[id]/route.ts`, and `lib/types.ts`. `Project` has the same POST/PATCH duplication. `lastContact` sits outside the PATCH whitelist loop because it needs `new Date()` coercion — date fields need that special case too.

Search lives only in `AccountList`: client-side over the already-loaded accounts, matching `name`, `email`, and the raw `labels` string. Projects have no search or filter.

### Types are hand-mirrored, not generated

`lib/types.ts` defines `Project`/`Account` by hand (dates typed as `string | null` because they cross JSON) plus `STATUS_OPTIONS` and `STATUS_COLOR`. Because the datasource is SQLite, every status is a plain `String` column and **nothing validates any of them server-side**. Where the allowed values live differs per field, which is easy to get wrong:

- **Account status** — dual-documented: a `schema.prisma` comment *and* `STATUS_OPTIONS`/`STATUS_COLOR` in `lib/types.ts`. Keep them in sync.
- **Project status** (`Active | Paused | Complete`) — schema comment only. There is no constant and no picker in the UI.
- **labels** — unconstrained free text; no allowed-values list anywhere.

The two constants are consumed in mutually exclusive places and neither constrains the other: `STATUS_OPTIONS` only fills the `Select` in `account-detail`, and the **display string is what gets stored** (no slugs or enums). `STATUS_COLOR` is only the status dot in `account-list`, is typed `Record<string, string>` rather than keyed to `STATUS_OPTIONS`, and needs its `?? "bg-slate-400"` fallback. Its values are raw Tailwind classes, so they must stay statically greppable for Tailwind's scanner. `Project.status` uses neither — it renders as bare text and isn't editable in the UI.

`labels` is nominally comma-separated but is **never split or trimmed anywhere** — one free-text input in, one truncated line out. There's no parsing helper to reuse; adding chips means writing one.

`lib/` holds only `auth.ts`, `prisma.ts`, `types.ts`, and `utils.ts` (the stock shadcn `cn` and nothing else) — there is no shared-helper module, so new utilities need a home decided deliberately. `lib/prisma.ts` is the standard global-singleton guard and logs only `error`/`warn`; there's no query logging, so tracing N+1s means editing that line.

### Auth and Gmail

`lib/auth.ts` uses Auth.js v5 with **no database adapter**, so the JWT strategy applies by implicit default — Google's access and refresh tokens live in the JWT, and the `jwt` callback hand-rolls a refresh against `oauth2.googleapis.com/token` when expired. The `session` callback attaches `accessToken` via an `unknown` cast (module augmentation isn't set up; follow the existing cast rather than adding a partial one). On refresh failure it sets `token.error = "RefreshAccessTokenError"` and surfaces it on the session — but **no route ever reads it**, so a stale token yields a 502 from Gmail instead of a re-auth prompt.

Naming trap: the Prisma `Account` model is a **CRM contact**, which collides with NextAuth's own `Account` table. Adding a Prisma adapter later will require renaming one of them.

`POST /api/gmail/draft` reads that `accessToken` from `auth()`, builds a base64url RFC 2822 message, calls `gmail.users.drafts.create`, and writes `draftLink` back onto the Account. That link is built from the nested `message.id`, not the draft id, and the write-back is conditional — if Gmail omits it the route still returns 200 while silently leaving the Account unchanged. Signing in is optional overall: the CRM works fully without Google, only drafting needs it.

### Deliberate v1 gaps

Single-tenant by design, and more thoroughly than "a missing auth check" — `auth` is imported *only* by the Gmail route, there's no `middleware.ts`, and the schema has **no `User` model and no owner column at all**, so ownership filtering isn't possible without a migration. Don't treat this as a bug to silently fix mid-task; flag it before adding anything network-exposed.

Matching that altitude, the API surface has:

- **No input validation.** No zod/yup in the project. Only two required-field guards exist (accounts POST, gmail draft); `POST /api/projects` has none, so a missing `name` reaches Prisma and throws. `new Date(body.lastContact)` will happily store `Invalid Date`.
- **One try/catch in the whole API**, in the Gmail route. Every CRUD route lets a bad id surface as an unhandled Prisma `P2025` → framework 500 with no JSON error shape, and every `await request.json()` is unguarded, so malformed JSON is an uncaught 500 everywhere.
- **`DELETE /api/projects/[id]` is a hard delete** that destroys every account under it via `onDelete: Cascade`, with no confirmation and no count returned.

The two PATCH handlers implement identical semantics with different idioms (conditional spread for projects, a `for` loop over a const array for accounts) — pick whichever matches the file you're editing.

### UI conventions

shadcn/ui with the `radix-nova` style and `neutral` base color (`components.json`); Tailwind v4, CSS-first — there is no `tailwind.config`, and `app/globals.css` imports `tailwindcss`, `tw-animate-css`, and `shadcn/tailwind.css`, then defines every token in an `@theme inline` block over `:root` vars (achromatic OKLCH; the whole radius scale derives from `--radius: 0.625rem`). Icons: lucide. Toasts: `sonner` (`<Toaster />` mounted in `app/layout.tsx`).

Two things in the theme layer are wired but inert, so don't assume they work:

- **Dark mode is dead.** `globals.css` defines `@custom-variant dark (&:is(.dark *))` and a full `.dark` token block, but nothing ever sets the `dark` class — there is no `ThemeProvider`, and `app/layout.tsx` renders `<html>` without it or `suppressHydrationWarning`. `next-themes` is a dependency solely because `components/ui/sonner.tsx` calls `useTheme()`. Enabling dark mode means adding the provider, not writing tokens.
- **`--font-sans` is self-referential** in `globals.css` (`--font-sans: var(--font-sans)`), so the `@apply font-sans` on `html` resolves to nothing. The real families are registered by `app/layout.tsx` as `--font-geist-sans` / `--font-geist-mono`; only `--font-mono` points at its Geist variable.

TypeScript: single alias `@/*` → `./*` (repo root, not `src/`). `tsconfig.json` includes `.next/types` and `.next/dev/types`, which is what makes Next 16's generated `LayoutProps<"/">` — used in `app/layout.tsx` — resolve; that type won't exist until a build or `next dev` has run.

`ProjectSidebar` and `AccountList` duplicate the same create-dialog idiom verbatim (Dialog + local `open`, ghost `Plus` trigger, `space-y-3` body of Label/Input pairs, footer button disabled on `saving || !name.trim()`, reset-and-close in `try` with `setSaving(false)` in `finally`, no `catch`). It is not extracted — match it if you add a third. Note the `htmlFor` ids are unnamespaced (`pname`/`pdesc` vs `aname`/`aemail`); the `p`/`a` prefix is the only thing preventing a DOM id collision, since both dialogs mount in the same tree.

Session state is not threaded as props — `TopBar` and `AccountDetail` each call `useSession()` independently. Do the same rather than lifting it. `TopBar` is the only caller of `signIn`/`signOut`, hardcoded to `signIn("google")`.

`components/ui/resizable.tsx` wraps **react-resizable-panels v4**, whose API differs from what older shadcn snippets use: `Group`/`Panel`/`Separator`, an `orientation` prop on the group, and sizes passed as strings (`defaultSize="18"`). Don't port v1-era `PanelGroup direction=` code into it.
