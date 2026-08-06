# Ari's CRM

A minimal, project-tiered CRM: a list of clients/prospects grouped under projects, styled like
an email client (project sidebar → account list → account detail), with real Gmail draft
creation built in.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind
- shadcn/ui (Radix-based)
- Prisma + SQLite (swap to Postgres/MySQL for self-hosting)
- Auth.js (next-auth v5) with Google OAuth, requesting the `gmail.compose` scope
- `googleapis` for creating real Gmail drafts

## Data model

- **Project** — the top tier: name, description, status, and an "approach" field (your
  reusable pitch/template for that project, pre-filled into new drafts).
- **Account** — the bottom tier, belongs to a Project: name, email, status (Prospect /
  Contacted / Engaged / Closed Won / Closed Lost / Rejected), labels, next action, notes,
  a Gmail draft link (set automatically once you create a draft), and an optional notes link.

## Running locally

```bash
npm install
cp .env.example .env   # fill in the Google OAuth values (see below) — SQLite needs no setup
npx prisma migrate deploy
npx tsx prisma/seed.ts   # optional: adds one example project + two example accounts
npm run dev
```

Open http://localhost:3000. The app works immediately without Google sign-in — you can
browse/add/edit projects and accounts. Sign in with Google (top right) to enable "Create
Gmail draft" on the account detail pane.

### Setting up Google OAuth (for real Gmail drafts)

1. In [Google Cloud Console](https://console.cloud.google.com), create a project (or reuse one).
2. Enable the **Gmail API** for that project (APIs & Services → Library).
3. APIs & Services → OAuth consent screen: add yourself as a test user if the app is in
   "Testing" mode, and add the scope `https://www.googleapis.com/auth/gmail.compose`.
4. APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application.
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
   - Copy the client ID and secret into `.env` as `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.
5. Generate a real `AUTH_SECRET`: `npx auth secret` (replace the placeholder in `.env`).

## Path to self-hosting online

Nothing else changes structurally — same Next.js app, same Prisma schema:

1. Swap `DATABASE_URL` in `.env` for a Postgres connection string (Prisma supports this with
   a one-line change to `prisma/schema.prisma`'s `provider`), and re-run
   `npx prisma migrate deploy` against it.
2. Deploy to Railway, Fly.io, Render, or a small VPS with Docker — all support Next.js + a
   managed Postgres add-on out of the box.
3. Add the production URL's `/api/auth/callback/google` as a second authorized redirect URI
   in the same Google Cloud OAuth client (you can keep both localhost and production
   registered at once).
4. Set the same env vars (`DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`)
   on the host.

## Notes

- This is a v1 scaffold: single-user, no row-level auth checks (anyone who can reach the
  app can read/write all data) — fine for local/personal use, but add access control before
  putting it somewhere multi-user or public.
- The UI is intentionally minimal — three resizable panes, no unread/read states, no threading.
  It's meant to be extended incrementally as real usage reveals what's missing.
