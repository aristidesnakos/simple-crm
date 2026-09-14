# Ari's CRM

A minimal, project-tiered CRM: a list of contacts grouped under projects, styled like
an email client (project sidebar → contact list → contact detail), with real Gmail draft
creation built in. A second view, `/queue`, cuts across every project and shows what's
overdue. Built for one person running outreach on localhost — see
[self-hosting](#path-to-self-hosting-online) before putting it anywhere else.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind
- shadcn/ui (Radix-based)
- Prisma + SQLite (swap to Postgres/MySQL for self-hosting)
- Auth.js (next-auth v5) with Google OAuth, requesting the `gmail.compose` scope
- `googleapis` for creating real Gmail drafts
- OpenRouter (optional) for AI-assisted drafting

## Data model

- **Project** — the top tier (one campaign): name, description, status (`Active` /
  `Paused` / `Complete`), `fromEmail` (the sending identity for this campaign — leave it
  blank to use your mailbox default), and an **approach** field. Approach is a *brief
  written to you*, not an email template: it's shown read-only beside the composer while
  you write, and it's given to the AI drafter as context. It is deliberately never
  pre-filled into a message body.
- **Account** — the bottom tier, belongs to a Project. This is a contact, despite the
  name. Name, email, `kind`, status, labels, last contact, next action + due date, notes,
  a Gmail draft link (set automatically once you create a draft), an optional notes link,
  and provenance/jurisdiction fields (below).
- **Suppression** — the do-not-contact list, keyed on the **email address** rather than on
  a contact row. See below.

### Two pipelines, two status vocabularies

`Account.kind` picks which set of statuses a contact uses. Changing a contact's pipeline in
the UI moves its status along with it when the old value doesn't exist in the new list.

| kind | statuses |
| --- | --- |
| `customer` | Signed Up → Emailed → Replied → Onboarded → Dormant |
| `collaborator` | Prospect → Contacted → Engaged → Closed Won / Closed Lost / Rejected / Parked |

The lists live in `lib/types.ts` (`STATUS_OPTIONS_BY_KIND`) and are stored as the display
string. Nothing in the database enforces them.

### Provenance and consent

Each contact also records where they came from and which rules apply to them:
`sourceType` (`waitlist_form` / `partner_sheet` / `referral` / `manual` / `research`),
`sourceDetail` (which sheet, which form, who referred), `consentedAt` (when they
affirmatively opted in, where that applies), and `jurisdiction` (`US` / `EU` / `UK` / `CA` /
`JP` / `OTHER` / `UNKNOWN`, hand-set — nothing guesses it from an email domain).

Drafting to a contact in a consent-first jurisdiction with no consent date on file prompts
for confirmation before it will create the draft. The acknowledgement is per-draft and is
never saved to the contact.

### Do-not-contact

Recording an opt-out writes a row to the `Suppression` table, keyed on the normalized email
address. Two consequences worth knowing, both deliberate:

- **It covers every campaign.** The same person can be a contact in several projects; one
  opt-out suppresses all of them.
- **It survives deleting the contact.** There is no cascade, so re-importing that person
  later immediately finds them suppressed.

A suppressed contact drops out of the queue and the Gmail draft route refuses to draft to
them (server-side — not just hidden in the UI), with no override.

### The queue

`/queue` is the one view that reads across every project: every contact whose next action
is due, overdue, or never set, and whose status doesn't already mean "nothing is owed
here". Overdue first, then the ones with no due date, oldest-waiting first. Suppressed
contacts are excluded.

## Running locally

```bash
npm install
cp .env.example .env   # see "Environment variables" below — SQLite itself needs no setup
npx prisma migrate deploy
npx tsx prisma/seed.ts   # optional: adds one example project + two example accounts
npm run dev
```

Note the seed is run with `npx tsx`, not `npx prisma db seed` — there's no `prisma.seed`
key in `package.json` and no `prisma.config.ts`, so the Prisma command does nothing. The
seed is also guarded: it skips entirely if the database already has any project, so it
can't be used to reset or re-seed.

Open http://localhost:3000. The app works immediately without Google sign-in — you can
browse/add/edit projects and contacts, work the queue, and record opt-outs. Sign in with
Google (top right) to enable "Create Gmail draft" on the contact detail pane.

## Environment variables

Copy `.env.example` to `.env`. Only the first two are needed to run the app at all; the
rest each gate one feature, and the app tells you which one is missing when you hit it.

| Variable | Required? | What it gates |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | The database. `file:./dev.db` for local SQLite. |
| `AUTH_SECRET` | **Yes** | Session encryption. Generate with `npx auth secret`. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | For Gmail only | Google sign-in and Gmail draft creation. Everything else in the CRM works without them. |
| `CRM_SENDER_LEGAL_NAME` | **For drafting** | The legal entity sending the mail. |
| `CRM_SENDER_POSTAL_ADDRESS` | **For drafting** | A real postal address. |
| `OPENROUTER_API_KEY` | For AI drafting | `POST /api/compose`. Without it the route returns 501 and the composer still works by hand. |
| `OPENROUTER_MODEL` | No | Any OpenRouter model slug. Defaults to `google/gemini-3-flash-preview`. |
| `CRM_I_KNOW_THE_API_IS_UNAUTHENTICATED` | No | Disables the non-localhost API block. See [self-hosting](#path-to-self-hosting-online). |

**The two `CRM_SENDER_*` variables are required before any email can be drafted.** Every
outreach email carries a footer identifying who is sending it and giving a postal address
and a way to opt out, because CAN-SPAM, CASL and others each require it. If either variable
is blank, `POST /api/gmail/draft` fails with a 500 naming the one that's missing and
creates nothing — deliberately, since a footer with a gap in it looks compliant and isn't.
The exact footer is previewed under the composer so you can see what goes out.

### Setting up Google OAuth (for real Gmail drafts)

1. In [Google Cloud Console](https://console.cloud.google.com), create a project (or reuse one).
2. Enable the **Gmail API** for that project (APIs & Services → Library).
3. APIs & Services → OAuth consent screen: add yourself as a test user if the app is in
   "Testing" mode, and add the scope `https://www.googleapis.com/auth/gmail.compose`.
4. APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application.
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
   - Copy the client ID and secret into `.env` as `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.
5. Generate a real `AUTH_SECRET`: `npx auth secret` (replace the placeholder in `.env`).

### Working with mail

- **Draft an email** — opens a composer on the contact. The project's approach brief sits
  above it read-only, and the compliance footer preview below it. "Draft with AI" fills
  the subject and body if `OPENROUTER_API_KEY` is set; otherwise write it yourself.
  "Create Gmail draft" creates a real draft in your Gmail and saves a link back to it on
  the contact. Nothing is ever sent by the app — you send from Gmail.
- **Open conversation in Gmail** — jumps to a Gmail search for everything sent to or
  received from that contact, in both directions. It appears once the contact has an email
  address. This is just a link: no API call, no extra OAuth scope, and none of your mail is
  copied into the CRM. Replies are read in Gmail, which also means the CRM can't count them
  or show a "replied" column — that's the trade being made, not an oversight.

The app requests only the `gmail.compose` scope, which allows creating drafts and cannot
read your mailbox.

## Path to self-hosting online

> **Read this first: the API is not authenticated, and the app will refuse to serve it off
> localhost.**
>
> Every route under `/api` except Google sign-in has no session check, no owner column, and
> no per-user filtering — `DELETE /api/projects/[id]` cascade-deletes a project with all of
> its contacts and history, unauthenticated. The schema has no `User` model at all, so this
> isn't a missing check you can add in one place; it's a design decision for a single-user
> tool.
>
> `proxy.ts` is what keeps that honest. (Next 16 renamed the `middleware` convention to
> `proxy`.) It returns a 403 with an explanatory JSON body for every `/api/*` request whose
> hostname isn't `localhost` / `127.0.0.1` / `::1`, so `next dev --host` on café wifi or a
> first deploy fails loudly rather than quietly exposing everything. NextAuth's own routes
> are exempt, since the OAuth callback has to work on a real hostname.
>
> It is a **tripwire, not authentication**. `CRM_I_KNOW_THE_API_IS_UNAUTHENTICATED=true`
> switches it off — and setting it is the moment you take on building real auth yourself.
> If you get a 403 from every API call while testing over a LAN IP, this is why.

With that understood, nothing else changes structurally — same Next.js app, same Prisma
schema:

1. Swap `DATABASE_URL` in `.env` for a Postgres connection string (Prisma supports this with
   a one-line change to `prisma/schema.prisma`'s `provider`), and re-run
   `npx prisma migrate deploy` against it.
2. Deploy to Railway, Fly.io, Render, or a small VPS with Docker — all support Next.js + a
   managed Postgres add-on out of the box.
3. Add the production URL's `/api/auth/callback/google` as a second authorized redirect URI
   in the same Google Cloud OAuth client (you can keep both localhost and production
   registered at once).
4. Set the env vars from the table above on the host — at minimum `DATABASE_URL`,
   `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `CRM_SENDER_LEGAL_NAME` and
   `CRM_SENDER_POSTAL_ADDRESS`.

One more thing that changes off localhost: signing in stores a Google **refresh token** in
the database, which grants ongoing Gmail access until it's revoked at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions). `prisma/dev.db`
is unencrypted on disk. That's fine locally and is something to plan for anywhere else.

## Notes

- This is a v1 scaffold: single-user, no row-level auth checks (anyone who can reach the
  app can read/write all data) — fine for local/personal use, but add real access control
  before putting it somewhere multi-user or public.
- `prisma/dev.db` is gitignored, as are `prisma/contacts.local.json` and `docs/*.csv`. They
  hold real contact data. There's a pre-commit hook that refuses them — install it once per
  clone with `git config core.hooksPath .githooks`, since hooks aren't cloned.
- The UI is intentionally minimal — three resizable panes, no unread/read states, no threading.
  It's meant to be extended incrementally as real usage reveals what's missing.
