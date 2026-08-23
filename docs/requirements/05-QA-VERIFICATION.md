# 05 — QA & Verification Plan

**Set:** RS-01 · **Status:** Draft, awaiting execution · **Opened:** 2026-08-21
**Owner:** QA / Tech Lead · **Executes against:** `docs/requirements/01-PRD-outreach-compliance.md`

---

## 0. How this plan works

**This repository has no test framework, and this plan does not invent one.** `CLAUDE.md` states
it plainly: there is no runner, no assertion library, no `npm test`. Every procedure below is
therefore a manual sequence of real commands against a real database and a real dev server, with
an observable expected result and a pass/fail line.

That is deliberate rather than a compromise. The requirements in RS-01 are almost entirely about
what happens at the boundary between this app and the outside world — Gmail, an LLM gateway, a
public git remote, a person who replied "stop". Those boundaries are not mockable at this scale,
and a green unit test asserting that a footer function returns a string proves nothing about
whether the message that reached Gmail carried the footer. **We verify the artifact, not the
function.**

One procedure per requirement, numbered `VER-nn` to match `REQ-nn`. Execute in order within a
milestone. Record results in §6.

Two procedures carry a `b` suffix because their requirement has a property that a single pass
cannot demonstrate: `VER-01b` proves that one opt-out covers every campaign, and `VER-10b` proves
the jurisdiction pass is complete across all three projects. Both exist because the same procedure
without them passes on a row-scoped or single-campaign implementation, which is precisely the class
of defect this set is trying to prevent.

---

## 1. Preconditions & environment

### 1.1 Mandatory before any procedure runs

| # | Precondition | Command / check |
| --- | --- | --- |
| P1 | Working tree clean, or changes intentionally staged for the ticket under test. | `git status --short` |
| P2 | **Database backed up to a durable location.** Several procedures write and delete rows. | see §1.2 |
| P3 | Migrations applied. | `npx prisma migrate deploy` |
| P4 | Dev server running **on localhost**. | `npm run dev` |
| P5 | `sqlite3` available. | `which sqlite3` |

### 1.2 Back up the database first — non-negotiable

`prisma/dev.db` holds **real contact data for 34 identifiable people**. It is gitignored
(`*.db`, `/prisma/*.db`) and must stay that way.

```bash
mkdir -p ~/backups/simple-crm
cp prisma/dev.db ~/backups/simple-crm/dev.db.$(date +%Y%m%d-%H%M%S)
ls -la ~/backups/simple-crm/
```

> **Never** `git add -f` the database, a `.db-journal`, `prisma/contacts.local.json`, or
> `docs/*.csv`. The remote is **public** (`aristidesnakos/simple-crm`). A single forced add is
> irreversible — git history is not a place you can delete someone's email address from.
>
> Do not leave backups in a session scratch directory. PRD finding F12 exists because two such
> copies already got left behind.

### 1.3 The localhost trap — read this before filing a bug

`proxy.ts` returns **403 JSON from every `/api/*` route** when the request hostname is not
`localhost`, `127.0.0.1`, or `[::1]`. NextAuth's own routes are exempt.

This means: verifying from another machine, from a phone on the same wifi, or against
`http://192.168.x.x:3000` makes **every single procedure below fail identically** with a 403 and
an error string about the API being unauthenticated. That is the tripwire working as designed
(roadmap E1), not a defect in the feature under test.

```bash
# Confirm you are hitting the right host before you start.
curl -s http://localhost:3000/api/projects | head -c 120; echo
# A 403 with "only safe on localhost" means you are NOT on localhost. Fix that first.
```

### 1.4 Which procedures need Google credentials

Most do not. Sign-in is only required where a real Gmail draft must be created.

| Needs Google sign-in | Procedures |
| --- | --- |
| **No** — runs with no keys at all | VER-01, VER-02, VER-04, VER-05, VER-08, VER-09, VER-10b, VER-13, VER-15, VER-16, VER-18, and all of §4 |
| **Yes** — creates or inspects a real draft | VER-03, VER-06, VER-06b, VER-10; VER-01b step 4 only (steps 1–3 run without) |
| **Yes** — needs a signed-in session to be meaningful | VER-11 |
| Needs `OPENROUTER_API_KEY` | VER-07, VER-14, VER-17 |

If credentials are unavailable, execute the no-credential set, mark the rest **BLOCKED** in §6
with the reason, and do **not** mark them passed. A blocked P0 verification blocks the M0 gate
exactly as a failed one does (§7).

---

## 2. Test data setup

### 2.1 Do not use the seed

`prisma/seed.ts` is unusable as a fixture source, for two independent reasons:

1. It is **guarded** — it counts projects and returns early if any exist. Against a populated
   database it does nothing at all.
2. It writes `Prospect` / `Contacted` onto rows whose `kind` defaults to `customer`, whose
   vocabulary contains neither. That is roadmap defect **E7, already firing** — those rows render
   a blank, unselectable status picker. Seeding would import a known bug into your fixtures.

Build fixtures through the API instead.

### 2.2 Create the QA projects and five fixture contacts

**Two** throwaway projects, not one. The second exists solely so cross-project suppression
(`REQ-01`) can be verified at all — with one project it passes trivially and proves nothing.

```bash
# 1. Two throwaway projects. Capture both ids. The second exists so that the same
#    person can hold a row in two campaigns — see F_TWIN below.
QA_PROJECT=$(curl -s -X POST http://localhost:3000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"ZZ QA Fixtures","description":"RS-01 verification. Delete after."}' \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

QA_PROJECT_B=$(curl -s -X POST http://localhost:3000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"ZZ QA Fixtures B","description":"Second campaign, same operator. Delete after."}' \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

echo "QA_PROJECT=$QA_PROJECT"; echo "QA_PROJECT_B=$QA_PROJECT_B"
```

```bash
# 2. F-SUPPRESSED — the critical fixture. Status stays ACTIVE ("Prospect").
#    This row is what distinguishes column-based suppression from status-based:
#    a status-based implementation will happily leave it in the queue.
F_SUPPRESSED=$(curl -s -X POST http://localhost:3000/api/accounts \
  -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$QA_PROJECT\",\"name\":\"QA Suppressed\",\"email\":\"qa-suppressed@example.com\",\"kind\":\"collaborator\",\"status\":\"Prospect\"}" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

# 3. F-EU — consent-first jurisdiction, no consent on file.
F_EU=$(curl -s -X POST http://localhost:3000/api/accounts \
  -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$QA_PROJECT\",\"name\":\"QA EU Contact\",\"email\":\"qa-eu@example.com\",\"kind\":\"collaborator\",\"status\":\"Prospect\"}" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

# 4. F-PARTNER — obtained from the partner sheet, not from the person.
F_PARTNER=$(curl -s -X POST http://localhost:3000/api/accounts \
  -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$QA_PROJECT\",\"name\":\"QA Partner Sourced\",\"email\":\"qa-partner@example.com\",\"kind\":\"collaborator\",\"status\":\"Prospect\",\"notes\":\"Runs a mid-size grooming brand. Mentioned refill packaging.\"}" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

# 5. F-CLEAN — US, direct signup, nothing special. The control row.
F_CLEAN=$(curl -s -X POST http://localhost:3000/api/accounts \
  -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$QA_PROJECT\",\"name\":\"QA Clean US\",\"email\":\"qa-clean@example.com\",\"kind\":\"customer\",\"status\":\"Signed Up\"}" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

# 6. F-TWIN — THE SAME PERSON as F-SUPPRESSED, in the second project.
#    This is the fixture that distinguishes person-scoped suppression from row-scoped.
#    A per-row implementation leaves this one in the queue and lets it be drafted, which
#    is the exact failure REQ-01 exists to prevent once one operator runs several
#    campaigns. Same address, deliberately different name and casing — normalizeEmail
#    folds the case, and if it does not, that is a finding.
F_TWIN=$(curl -s -X POST http://localhost:3000/api/accounts \
  -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$QA_PROJECT_B\",\"name\":\"QA Suppressed (other campaign)\",\"email\":\"QA-Suppressed@Example.com\",\"kind\":\"collaborator\",\"status\":\"Prospect\"}" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

# 7. F-NOEMAIL — no address at all. Guards against the NOT IN / NULL trap in the queue
#    filter (TRD §5.1, risk R10): a suppression filter written as `email NOT IN (...)`
#    silently drops every row like this one, and 11 of the 34 real contacts look like it.
F_NOEMAIL=$(curl -s -X POST http://localhost:3000/api/accounts \
  -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$QA_PROJECT\",\"name\":\"QA No Email\",\"kind\":\"collaborator\",\"status\":\"Prospect\"}" \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

echo "F_SUPPRESSED=$F_SUPPRESSED"; echo "F_EU=$F_EU"
echo "F_PARTNER=$F_PARTNER";       echo "F_CLEAN=$F_CLEAN"
echo "F_TWIN=$F_TWIN";             echo "F_NOEMAIL=$F_NOEMAIL"
```

Export these into a file so later procedures can source them:

```bash
cat > /tmp/rs01-fixtures.env <<ENV
QA_PROJECT=$QA_PROJECT
QA_PROJECT_B=$QA_PROJECT_B
F_SUPPRESSED=$F_SUPPRESSED
F_EU=$F_EU
F_PARTNER=$F_PARTNER
F_CLEAN=$F_CLEAN
F_TWIN=$F_TWIN
F_NOEMAIL=$F_NOEMAIL
ENV
source /tmp/rs01-fixtures.env
```

### 2.3 Set the compliance fields

Fields exposed by the API after `CRM-101` lands go through `PATCH`. Anything not yet exposed is
set directly, and **that gap is itself a finding** — note it in §6.

```bash
source /tmp/rs01-fixtures.env

# Suppression goes through its OWN route and its OWN table. It is keyed on the address,
# not on an account id — that is the whole of REQ-01, and passing an id here instead of
# an address is the mistake this snippet exists to prevent. Note that ONE call is
# expected to cover both F_SUPPRESSED and F_TWIN.
curl -s -X POST http://localhost:3000/api/suppressions \
  -H 'Content-Type: application/json' \
  -d '{"email":"qa-suppressed@example.com","optedOutAt":"2026-08-15T00:00:00.000Z","source":"reply","note":"Replied: please remove me."}'; echo

# Fallback — direct write. Prisma stores DateTime on SQLite as epoch milliseconds.
sqlite3 prisma/dev.db \
  "INSERT OR REPLACE INTO Suppression (email, optedOutAt, source, note, createdAt, updatedAt)
   VALUES ('qa-suppressed@example.com', 1755216000000, 'reply', 'Replied: please remove me.', 1755216000000, 1755216000000);"

# The provenance and jurisdiction fields ARE columns on Account, so they go through PATCH.
curl -s -X PATCH "http://localhost:3000/api/accounts/$F_EU" \
  -H 'Content-Type: application/json' -d '{"jurisdiction":"EU","consentedAt":null}' | head -c 120; echo
curl -s -X PATCH "http://localhost:3000/api/accounts/$F_PARTNER" \
  -H 'Content-Type: application/json' \
  -d '{"jurisdiction":"US","sourceType":"partner_sheet","sourceDetail":"Partner outreach sheet, row 12"}' | head -c 120; echo
curl -s -X PATCH "http://localhost:3000/api/accounts/$F_CLEAN" \
  -H 'Content-Type: application/json' \
  -d '{"jurisdiction":"US","sourceType":"waitlist_form","consentedAt":"2025-05-20T00:00:00.000Z"}' | head -c 120; echo

# Confirm the fixture state before proceeding. Two queries, because suppression is no
# longer readable from the account row.
sqlite3 -header -column prisma/dev.db \
  "SELECT name, status, jurisdiction, sourceType, consentedAt FROM Account
   WHERE projectId IN ('$QA_PROJECT','$QA_PROJECT_B');"
sqlite3 -header -column prisma/dev.db "SELECT * FROM Suppression;"
```

> **Expected: exactly one `Suppression` row**, and **two** `Account` rows carrying the address
> `qa-suppressed@example.com` — one in each project. If the second shows the address in mixed
> case, `normalizeEmail` is not being applied on the accounts POST path and every procedure below
> is compromised. Stop and record it.

### 2.4 Teardown

Run after every session. The cascade removes accounts, status events, and interactions.

```bash
source /tmp/rs01-fixtures.env
curl -s -X DELETE "http://localhost:3000/api/projects/$QA_PROJECT"
curl -s -X DELETE "http://localhost:3000/api/projects/$QA_PROJECT_B"
sqlite3 prisma/dev.db \
  "SELECT COUNT(*) AS should_be_zero FROM Account WHERE projectId IN ('$QA_PROJECT','$QA_PROJECT_B');"

# The suppression row does NOT cascade — that is deliberate (doc 04 §6.3), so the QA
# address has to be cleaned up explicitly. Verify it survived the cascade first: that
# survival is itself part of VER-15, so do not skip straight to the delete.
sqlite3 prisma/dev.db "SELECT COUNT(*) AS should_be_one FROM Suppression WHERE email='qa-suppressed@example.com';"
sqlite3 prisma/dev.db "DELETE FROM Suppression WHERE email='qa-suppressed@example.com';"

rm -f /tmp/rs01-fixtures.env
```

> `DELETE /api/projects/[id]` is a hard cascade delete with no confirmation. Confirm both ids are
> the fixture projects and not one of the three real ones before running it. **Never** run the
> `DELETE FROM Suppression` above without its `WHERE` clause — an unscoped delete there silently
> un-suppresses everyone who has ever opted out, and there is no second copy.

---

## 3. Verification procedures

### VER-01 — Suppression is a person-scoped record, not a status and not a column

**Proves:** REQ-01 · **Credentials:** none · **Priority:** P0

1. Confirm the table exists and is keyed on the address:
   ```bash
   sqlite3 prisma/dev.db "PRAGMA table_info(Suppression);"
   ```
2. Confirm suppression is **not** a column on `Account` — a hybrid design would pass every other
   step here while reintroducing the cascade and cross-project problems the table exists to solve:
   ```bash
   sqlite3 prisma/dev.db "PRAGMA table_info(Account);" | grep -Ec 'optedOutAt|optOutSource|optOutNote'
   ```
3. Confirm a status change does **not** disturb suppression:
   ```bash
   source /tmp/rs01-fixtures.env
   curl -s -X PATCH "http://localhost:3000/api/accounts/$F_SUPPRESSED" \
     -H 'Content-Type: application/json' -d '{"status":"Engaged"}' > /dev/null
   sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Suppression WHERE email='qa-suppressed@example.com';"
   ```
4. Confirm a second opt-out for the same person does not error and does not move the timestamp —
   the **first** date is the one that matters legally:
   ```bash
   curl -s -X POST http://localhost:3000/api/suppressions \
     -H 'Content-Type: application/json' \
     -d '{"email":"qa-suppressed@example.com","source":"verbal","note":"Said so again on a call."}'; echo
   sqlite3 prisma/dev.db "SELECT DATE(optedOutAt/1000,'unixepoch'), source FROM Suppression WHERE email='qa-suppressed@example.com';"
   ```
5. Confirm suppression is readable back through the API as a derived field on **both** rows,
   in **both** projects:
   ```bash
   curl -s "http://localhost:3000/api/accounts?projectId=$QA_PROJECT"   | grep -o '"optedOutAt":[^,]*' | head -5
   curl -s "http://localhost:3000/api/accounts?projectId=$QA_PROJECT_B" | grep -o '"optedOutAt":[^,]*' | head -5
   ```

**Expected:** step 1 shows `email` as the primary key. **Step 2 returns `0`.** After step 3 the
suppression row still exists and `status` is `Engaged`. Step 4 returns 200, leaves the date at
`2026-08-15`, and updates `source` to `verbal`. Step 5 returns a non-null timestamp for
`F_SUPPRESSED` **and** for `F_TWIN` — one opt-out, two campaigns.

**Fail if:** the table is missing; suppression columns also exist on `Account`; a status write
clears the record; the second opt-out 409s or overwrites the original date; `F_TWIN` comes back
with `optedOutAt: null`; or suppression is represented anywhere as a `status` string.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-01b — One opt-out covers every campaign

**Proves:** REQ-01 · **Credentials:** none · **Priority:** P0

Split out from VER-01 because it is the property most likely to be lost in review — a per-row
implementation looks correct in every single-project test and fails only here. `F_TWIN` is the
same address as `F_SUPPRESSED`, in a different project, created with mixed-case input.

1. Confirm the two rows are genuinely distinct accounts holding the same normalized address:
   ```bash
   source /tmp/rs01-fixtures.env
   sqlite3 -header -column prisma/dev.db \
     "SELECT id, projectId, email FROM Account WHERE id IN ('$F_SUPPRESSED','$F_TWIN');"
   ```
2. Confirm **one** suppression row covers both:
   ```bash
   sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Suppression;"
   ```
3. Confirm neither appears in the queue:
   ```bash
   curl -s http://localhost:3000/api/queue | grep -c "$F_TWIN"
   ```
4. Confirm the draft route refuses the twin as well (needs Google sign-in; if unavailable, mark
   this step BLOCKED and carry it into VER-03):
   ```bash
   curl -s -o /dev/stderr -w '%{http_code}\n' -X POST http://localhost:3000/api/gmail/draft \
     -H 'Content-Type: application/json' \
     -d "{\"accountId\":\"$F_TWIN\",\"to\":\"qa-suppressed@example.com\",\"subject\":\"QA twin\",\"body\":\"QA\"}"
   ```

**Expected:** two distinct ids, both with `qa-suppressed@example.com` in lowercase. One suppression
row. Step 3 returns `0`. Step 4 returns `409`.

**Fail if:** the twin's email is stored in mixed case; two suppression rows exist; the twin appears
in the queue; or the draft route builds a message for it. **Any of these means suppression is
row-scoped**, which is REQ-01 unmet regardless of what the other procedures say.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-02 — The queue never surfaces a suppressed contact

**Proves:** REQ-02 · **Credentials:** none · **Priority:** P0

This is the single most important procedure in the plan. `F-SUPPRESSED` carries the status
`Prospect` (or `Engaged` after VER-01), which is **not** in `QUEUE_EXCLUDED_STATUSES`. An
implementation that filters only on the status vocabulary will leave it in the queue and pass
every other check.

1. Confirm the row would otherwise qualify — active status, no due date:
   ```bash
   source /tmp/rs01-fixtures.env
   sqlite3 -header -column prisma/dev.db \
     "SELECT status, nextActionDue, email FROM Account WHERE id='$F_SUPPRESSED';"
   ```
2. Fetch the queue and search for it:
   ```bash
   curl -s http://localhost:3000/api/queue | grep -c "$F_SUPPRESSED"
   ```
3. Confirm the non-suppressed fixtures **are** present, so the filter is not simply over-broad:
   ```bash
   curl -s http://localhost:3000/api/queue | grep -c "$F_EU"
   curl -s http://localhost:3000/api/queue | grep -c "$F_CLEAN"
   ```
4. **Confirm contacts with no email address still appear.** This is the `NOT IN` / `NULL` trap
   (TRD §5.1, risk R10): in SQL, `email NOT IN (…)` excludes a row whose `email` is `NULL`, so a
   filter that reads correctly can silently delete a third of the queue. Eleven of the 34 real
   contacts have no address.
   ```bash
   curl -s http://localhost:3000/api/queue | grep -c "$F_NOEMAIL"
   ```
5. Compare the queue length against a pre-change baseline on **real** data, not fixtures:
   ```bash
   curl -s http://localhost:3000/api/queue | grep -o '"id"' | wc -l
   ```
6. Confirm the filter lives in the query, not in JS after the fetch:
   ```bash
   grep -n 'suppress\|notIn' app/api/queue/route.ts
   ```

**Expected:** step 2 returns `0`. Steps 3 and 4 return `1` for each. Step 5 matches the count
recorded before the change (13 rows was the last recorded figure — re-baseline before starting).
Step 6 shows the exclusion inside the `where` clause of `prisma.account.findMany`, not in the
`.sort()` below it.

**Fail if:** the suppressed row appears; the non-suppressed rows disappear; **`F_NOEMAIL`
disappears**; the queue count drops unexpectedly; or the exclusion is implemented by adding a
value to `QUEUE_EXCLUDED_STATUSES`.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-03 — The draft route refuses a suppressed contact

**Proves:** REQ-03 · **Credentials:** Google sign-in required · **Priority:** P0

1. Record the current `draftLink` so you can prove nothing was written:
   ```bash
   source /tmp/rs01-fixtures.env
   sqlite3 prisma/dev.db "SELECT COALESCE(draftLink,'<null>') FROM Account WHERE id='$F_SUPPRESSED';"
   ```
2. Attempt a draft. Use a browser session cookie, or drive it from the UI — the route reads
   `auth()`, so an unauthenticated `curl` returns `401` and proves nothing:
   ```bash
   curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/api/gmail/draft \
     -H 'Content-Type: application/json' \
     -b "$HOME/.qa-cookies.txt" \
     -d "{\"accountId\":\"$F_SUPPRESSED\",\"to\":\"qa-suppressed@example.com\",\"subject\":\"QA\",\"body\":\"QA body\"}"
   ```
3. Confirm no Gmail call happened and no link was written:
   ```bash
   sqlite3 prisma/dev.db "SELECT COALESCE(draftLink,'<null>') FROM Account WHERE id='$F_SUPPRESSED';"
   ```
4. Confirm the guard precedes the Gmail call in source order, and that it queries the suppression
   table rather than reading a field off the loaded account:
   ```bash
   grep -n 'suppression\|drafts.create' app/api/gmail/draft/route.ts
   ```
5. Confirm there is no bypass:
   ```bash
   grep -niE 'force|override|ignoreOptOut|skipSuppression' app/api/gmail/draft/route.ts
   ```
6. Repeat step 2 for `$F_TWIN` — the same person in the other campaign. One opt-out, both
   campaigns refused:
   ```bash
   curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/api/gmail/draft \
     -H 'Content-Type: application/json' -b "$HOME/.qa-cookies.txt" \
     -d "{\"accountId\":\"$F_TWIN\",\"to\":\"qa-suppressed@example.com\",\"subject\":\"QA\",\"body\":\"QA body\"}"
   ```

**Expected:** step 2 returns **`HTTP 409`** with a JSON body naming the opt-out date
(`2026-08-15`). Step 3 shows `draftLink` unchanged. Step 4 shows a `prisma.suppression` lookup at a
lower line number than `drafts.create`. Step 5 returns nothing. Step 6 also returns **409**.

**Fail if:** any status other than 409; a 200 with a created draft; the guard sits after the
Gmail call; the guard reads `account.optedOutAt` instead of querying by address; a `draftLink`
appears; step 6 returns anything but 409; or any override parameter exists. REQ-03 specifies **no**
override — unlike REQ-10, which has one by design.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-04 — Suppression survives re-import

**Proves:** REQ-04 · **Credentials:** none · **Priority:** P0

The import script guards **per project name** — against the live database it skips everything and
proves nothing. It also bypasses the API entirely (roadmap E8). Run this against an isolated copy
so the real data is never touched.

**Precondition:** `prisma/contacts.local.json` exists. If it does not, mark BLOCKED — the
requirement cannot be verified without the loader's input.

1. Build an isolated copy of the database:
   ```bash
   cp prisma/dev.db /tmp/qa-import.db
   ```
2. Pick a real address from the import file and suppress it in the copy. Note the suppression is
   recorded **against the address**, with no reference to any account row — that independence is
   what makes the next step meaningful:
   ```bash
   VICTIM=$(sqlite3 /tmp/qa-import.db "SELECT email FROM Account WHERE email IS NOT NULL LIMIT 1;")
   echo "VICTIM=$VICTIM"
   sqlite3 /tmp/qa-import.db \
     "INSERT OR REPLACE INTO Suppression (email, optedOutAt, source, createdAt, updatedAt)
      VALUES ('$VICTIM', 1755216000000, 'reply', 1755216000000, 1755216000000);"
   ```
3. Delete **both** the contact row and its project, so the per-project guard does not
   short-circuit and nothing but the suppression record remains. This is the strongest form of the
   test: the person has been fully erased and must still not be re-imported.
   ```bash
   sqlite3 /tmp/qa-import.db "DELETE FROM Project WHERE name LIKE 'Mangood%';"
   sqlite3 /tmp/qa-import.db "SELECT COUNT(*) AS accounts_left FROM Account WHERE email='$VICTIM';"
   sqlite3 /tmp/qa-import.db "SELECT COUNT(*) AS suppressions_left FROM Suppression WHERE email='$VICTIM';"
   ```
4. Re-run the import against the copy and capture the log:
   ```bash
   DATABASE_URL="file:/tmp/qa-import.db" npx tsx prisma/import-mangood.ts 2>&1 | tee /tmp/qa-import.log
   grep -i "$VICTIM" /tmp/qa-import.log
   ```
5. Confirm no row was created for the suppressed address:
   ```bash
   sqlite3 -header -column /tmp/qa-import.db \
     "SELECT COUNT(*) AS rows FROM Account WHERE email='$VICTIM';"
   ```
6. Confirm the summary count at the end of the run names the skip, so it cannot scroll past unread:
   ```bash
   tail -5 /tmp/qa-import.log
   ```
7. Clean up:
   ```bash
   rm -f /tmp/qa-import.db /tmp/qa-import.log
   ```

**Expected:** step 3 shows `accounts_left = 0` and `suppressions_left = 1` — the record outlived
the contact, which is doc 04 §6.3's whole resolution. Step 4 prints a skip line naming the address.
Step 5 shows `rows = 0`. Step 6 shows a non-zero skipped count.

**Fail if:** the address is re-imported; the skip is silent or absent from the summary; or the
suppression record did not survive step 3.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-05 — Opt-out is recordable in one action from the UI

**Proves:** REQ-05 · **Credentials:** none · **Priority:** P0

1. Open `http://localhost:3000`, select **ZZ QA Fixtures**, select **QA Clean US**.
2. With devtools Network open, use the opt-out control. Enter a note such as
   `Replied 2026-08-21 asking to be removed.`
3. Observe the request. Confirm it is **one** `POST /api/suppressions`, and that **no** PATCH to
   `/api/accounts/…` accompanies it — a suppression written through the accounts route is
   suppression back on the auto-saving path, which is risk R5.
4. Assert the write:
   ```bash
   sqlite3 -header -column prisma/dev.db \
     "SELECT email, optedOutAt, source, note FROM Suppression WHERE email='qa-clean@example.com';"
   ```
5. Reload `/queue` and confirm the contact is gone.
6. Confirm the banner appears on the contact **without a reload**, and that the compose controls
   are disabled. The response carries `affected`; if the banner only appears after a refresh, the
   splice back into `CrmApp` is missing (TRD §12.2).
7. Simulate a failure and confirm the operator is told. Stop the dev server, click the control
   again on another contact, and confirm a toast appears rather than a button that silently stops
   spinning — `POST /api/suppressions` is not covered by `patch()`'s rollback-and-toast, so it
   needs its own `catch`.
8. Undo for later procedures:
   ```bash
   sqlite3 prisma/dev.db "DELETE FROM Suppression WHERE email='qa-clean@example.com';"
   ```

**Expected:** a single POST carrying address, source, and note; all three persisted; the row absent
from `/queue` after reload; the banner immediate; a toast on failure.

**Fail if:** it takes more than one action; the note is discarded; the row still appears in the
queue; the failure is silent; or any part of the suppression is written through the accounts PATCH.
Note that `account-detail` state effects key on `account?.id` with `exhaustive-deps` disabled — if
the panel does not reflect the change without navigating away, that is a real finding against
REQ-05, not a quirk to wave through.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-06 — Every built message carries a compliant footer

**Proves:** REQ-06, REQ-06c · **Credentials:** Google sign-in required · **Priority:** P0

The footer is appended **server-side inside `buildRawMessage`**. It is therefore invisible in the
composer textarea. Two inspection paths; only one is authoritative.

**Path A — read the created draft in Gmail (AUTHORITATIVE).** This is what the recipient would
receive.

1. From the UI, create a draft for **QA Partner Sourced**.
2. Follow the `draftLink` written to the row:
   ```bash
   source /tmp/rs01-fixtures.env
   sqlite3 prisma/dev.db "SELECT draftLink FROM Account WHERE id='$F_PARTNER';"
   ```
3. Open it in Gmail and read the bottom of the message body.

**Path B — decode the raw message (diagnostic only).** Confirms construction, not delivery.

```bash
grep -n -A 25 'function buildRawMessage' app/api/gmail/draft/route.ts
```

4. Confirm fail-closed behaviour when the address is not configured:
   ```bash
   grep -rn 'POSTAL\|SENDER_LEGAL\|footer' app/api/gmail/draft/route.ts lib/ .env.example
   # Temporarily unset the address var in .env, restart dev, retry a draft.
   ```
5. Confirm the **blank** case fails closed too — the subtler half of risk R8. A `""` in `.env` is
   not null, so a `??` check would accept it and emit a footer with a gap where the address goes.
   ```bash
   # Set CRM_SENDER_POSTAL_ADDRESS="" in .env, restart dev, retry a draft.
   ```
6. **Subject encoding (REQ-06c).** Rename `ZZ QA Fixtures` to something containing a non-ASCII
   character — `ZZ QA Fixtures — 書道` will do, and it also matches the em dash the composer inserts
   by default. Create a draft and read the subject line **in Gmail**, not in the composer.

**Expected:** the Gmail draft body ends with the sender's legal identity, a physical postal
address, and a plain opt-out instruction. With the address unset (step 4) or blank (step 5), draft
creation returns a non-2xx with a specific error naming the missing variable — **not** a draft with
a blank or placeholder address. In step 6 the subject renders correctly in Gmail, with no `â€"` or
`?` substitutions.

**Fail if:** the footer is absent from the Gmail draft; it is generated by the model rather than
the route; it contains a placeholder; an unconfigured or blank address yields a silently
footer-less message; or the subject line is corrupted. A footer that exists in `buildRawMessage`
but not in the Gmail draft is a **fail** — Path A governs.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-06b — Composer preview matches what is sent

**Proves:** REQ-06b · **Credentials:** Google sign-in required · **Priority:** P1

1. In `account-detail`, compose a message for **QA Partner Sourced** and read the preview.
2. Create the draft and open it in Gmail.
3. Compare the two byte-for-byte at the footer.
**Expected:** identical footer text in both. No divergence in wording, address, or opt-out line.

**Fail if:** the preview omits the footer, or shows a different one. A preview that does not match
the sent artifact is worse than no preview — it makes the operator confident about something they
did not check. Note `process.env` is not readable client-side, so a naive implementation renders
nothing at all here.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-07 — Composer instructions no longer fight the footer or instruct concealment

**Proves:** REQ-07 · **Credentials:** `OPENROUTER_API_KEY` · **Priority:** P0

1. Confirm the two prompt lines are gone:
   ```bash
   grep -n 'Do not invent a title or company footer' app/api/compose/route.ts
   grep -n 'Never state or imply that this message was written by AI' app/api/compose/route.ts
   ```
2. Confirm a voice instruction replaced the concealment line rather than it simply vanishing:
   ```bash
   grep -n -B 2 -A 12 'Rules:' app/api/compose/route.ts
   ```
3. Generate a draft and confirm output quality did not regress — still plain text, still under
   ~120 words, still opens on a specific detail from the notes:
   ```bash
   source /tmp/rs01-fixtures.env
   curl -s -X POST http://localhost:3000/api/compose \
     -H 'Content-Type: application/json' \
     -d "{\"accountId\":\"$F_PARTNER\"}" | python3 -m json.tool
   ```

**Expected:** both greps in step 1 return nothing. Step 2 shows a voice instruction in their place.
Step 3 returns valid `{subject, body, rationale}`.

**Fail if:** either line survives; the concealment line was deleted with no replacement, degrading
copy quality; or the route now returns a 502 shape error because the prompt edit broke the
`json_object` contract.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-08 — Structured provenance exists and round-trips

**Proves:** REQ-08 · **Credentials:** none · **Priority:** P1

1. Columns present:
   ```bash
   sqlite3 prisma/dev.db "PRAGMA table_info(Account);" | grep -E 'sourceType|sourceDetail|consentedAt'
   ```
2. Vocabulary is declared, not ad-hoc:
   ```bash
   grep -n 'SOURCE_TYPES\|sourceType' lib/types.ts
   ```
3. Settable on create:
   ```bash
   source /tmp/rs01-fixtures.env
   curl -s -X POST http://localhost:3000/api/accounts -H 'Content-Type: application/json' \
     -d "{\"projectId\":\"$QA_PROJECT\",\"name\":\"QA Provenance\",\"sourceType\":\"referral\",\"sourceDetail\":\"Intro from X\"}" \
     | python3 -m json.tool | grep -E 'sourceType|sourceDetail'
   ```
4. Editable via PATCH — and note that `consentedAt` is a **date**, so it belongs in the second
   coercion loop in `app/api/accounts/[id]/route.ts`, not the plain whitelist:
   ```bash
   grep -n -A 6 'lastContact.*nextActionDue' "app/api/accounts/[id]/route.ts"
   ```

**Expected:** three columns; a named vocabulary constant in `lib/types.ts`; create echoes both
fields; `consentedAt` appears alongside `lastContact` and `nextActionDue` in the date-coercion
loop.

**Fail if:** `consentedAt` sits in the plain whitelist — it will store the raw JSON string instead
of a `DateTime`, and SQLite will accept it silently.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-09 — Backfill is complete and non-destructive

**Proves:** REQ-09 · **Credentials:** none · **Priority:** P1

The backfill must set provenance **without touching `notes`**. The waitlist signup dates are
currently prose inside `notes`; they are to be *copied* into `consentedAt`, not moved.

1. Snapshot `notes` for every pre-existing row **before** running the backfill:
   ```bash
   sqlite3 prisma/dev.db \
     "SELECT id || '|' || COALESCE(notes,'') FROM Account WHERE id NOT IN (SELECT id FROM Account WHERE projectId=(SELECT id FROM Project WHERE name LIKE 'ZZ QA%')) ORDER BY id;" \
     | shasum -a 256 | tee /tmp/notes-before.sha
   ```
2. Run the backfill:
   ```bash
   npx tsx prisma/backfill-provenance.ts
   ```
3. Re-hash `notes` and compare:
   ```bash
   sqlite3 prisma/dev.db \
     "SELECT id || '|' || COALESCE(notes,'') FROM Account WHERE id NOT IN (SELECT id FROM Account WHERE projectId=(SELECT id FROM Project WHERE name LIKE 'ZZ QA%')) ORDER BY id;" \
     | shasum -a 256 | tee /tmp/notes-after.sha
   diff /tmp/notes-before.sha /tmp/notes-after.sha && echo "NOTES UNCHANGED"
   ```
4. Assert zero unprovenanced rows:
   ```bash
   sqlite3 prisma/dev.db "SELECT COUNT(*) AS missing_source FROM Account WHERE sourceType IS NULL;"
   ```
5. Assert every waitlist row has a consent timestamp:
   ```bash
   sqlite3 -header -column prisma/dev.db \
     "SELECT COUNT(*) AS waitlist_without_consent FROM Account WHERE sourceType='waitlist_form' AND consentedAt IS NULL;"
   ```
6. Spot-check three rows by hand against the original source:
   ```bash
   sqlite3 -header -column prisma/dev.db \
     "SELECT name, sourceType, sourceDetail, DATE(consentedAt/1000,'unixepoch') AS consented FROM Account WHERE sourceType IS NOT NULL LIMIT 3;"
   ```

**Expected:** step 3 prints `NOTES UNCHANGED`. Step 4 returns `0`. Step 5 returns `0`. Step 6
dates match the signup dates recorded in the notes prose.

**Fail if:** the hashes differ (the backfill mutated notes — **stop and restore from backup**);
any row is left with a null `sourceType`; or a consent date is invented rather than derived.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-10 — Consent-first jurisdiction gate

**Proves:** REQ-10 · **Credentials:** Google sign-in required · **Priority:** P0

1. Confirm the column exists and the fixture is set:
   ```bash
   source /tmp/rs01-fixtures.env
   sqlite3 -header -column prisma/dev.db \
     "SELECT jurisdiction, consentedAt FROM Account WHERE id='$F_EU';"
   ```
2. Attempt a draft **without** acknowledgement:
   ```bash
   curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/api/gmail/draft \
     -H 'Content-Type: application/json' -b "$HOME/.qa-cookies.txt" \
     -d "{\"accountId\":\"$F_EU\",\"to\":\"qa-eu@example.com\",\"subject\":\"QA\",\"body\":\"QA body\"}"
   ```
3. Attempt **with** acknowledgement:
   ```bash
   curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/api/gmail/draft \
     -H 'Content-Type: application/json' -b "$HOME/.qa-cookies.txt" \
     -d "{\"accountId\":\"$F_EU\",\"to\":\"qa-eu@example.com\",\"subject\":\"QA\",\"body\":\"QA body\",\"acknowledgeJurisdiction\":true}"
   ```
4. Confirm the acknowledgement was **not** persisted — the block is per-request:
   ```bash
   sqlite3 prisma/dev.db "PRAGMA table_info(Account);" | grep -i acknowledg
   ```
5. Repeat step 2 and confirm it blocks again.
6. Confirm consent on file removes the block without acknowledgement:
   ```bash
   sqlite3 prisma/dev.db "UPDATE Account SET consentedAt=1747699200000 WHERE id='$F_EU';"
   # retry step 2 — expect success
   sqlite3 prisma/dev.db "UPDATE Account SET consentedAt=NULL WHERE id='$F_EU';"
   ```

**Expected:** step 2 → `409` naming the jurisdiction. Step 3 → `200`. Step 4 → no column
(nothing remembered). Step 5 → `409` again. Step 6 → `200` with no flag.

**Fail if:** the acknowledgement is persisted anywhere; the gate stops firing after one
acknowledgement; or a US-jurisdiction contact is blocked (over-broad — retest with `$F_CLEAN`).

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-10b — Every emailable contact has a jurisdiction

**Proves:** REQ-10b · **Credentials:** none · **Priority:** P0 · **Manual checklist**

Not automated, by design (PRD non-goal N1). A human reads **23 rows across three projects**.

> **Scope is every contact with an email address, not one campaign.** The database holds **25
> collaborator rows** — 17 in `Mangood — Partners`, 8 in `MichiKanji — Shodo Schools` — and 23 of
> the 34 contacts have an address. Both Japanese-reading domains at PRD F8 are in
> `MichiKanji — Shodo Schools`, and JP is in `CONSENT_FIRST_JURISDICTIONS`, so scoping this to the
> partner list would skip the sharpest case the requirement exists for. Scoping it to emailable
> contacts also does not go stale when a fourth project is added.

```bash
# The review sheet. Every contact that can actually be emailed, grouped by project.
sqlite3 -header -column prisma/dev.db \
  "SELECT p.name AS project, a.kind, a.name, a.email,
          COALESCE(a.jurisdiction,'<UNSET>') AS juris,
          CASE WHEN a.consentedAt IS NULL THEN '' ELSE 'consent' END AS consent
   FROM Account a JOIN Project p ON p.id = a.projectId
   WHERE a.email LIKE '%@%'
   ORDER BY p.name, juris, a.name;"
```

```bash
# Hard gate: this must return 0 before any send.
sqlite3 prisma/dev.db \
  "SELECT COUNT(*) AS unset FROM Account WHERE email LIKE '%@%' AND jurisdiction IS NULL;"
```

```bash
# Sanity check on the scope itself. If these numbers have moved, re-read this procedure
# rather than assuming the checklist below is still the right size.
sqlite3 -header -column prisma/dev.db \
  "SELECT p.name, COUNT(*) AS rows,
          SUM(CASE WHEN a.email LIKE '%@%' THEN 1 ELSE 0 END) AS emailable
   FROM Project p LEFT JOIN Account a ON a.projectId = p.id GROUP BY p.id;"
# Expected 2026-08-22: Waitlist 9/9, Partners 17/12, Shodo Schools 8/2. Total 34/23.
```

| ☐ | Check |
| --- | --- |
| ☐ | All 23 emailable rows reviewed individually against the recipient's actual location — not guessed from the email TLD. A `.com` says nothing, and neither does a `.org`. |
| ☐ | **`MichiKanji — Shodo Schools` reviewed, not skipped.** It is absent from most of this document set's prose and holds the two domains that read Japanese. |
| ☐ | Every row has a non-null `jurisdiction`. |
| ☐ | Any row set to `CA` (Canada) flagged to Product — CASL has no legitimate-interest route, and consent must be on file. |
| ☐ | Any row set to `JP` flagged to Product — doc 04 §2 says treat as consent-first and get the exemption confirmed, rather than assuming the business-disclosure exemption applies. |
| ☐ | Any row set to `EU` / `UK` / `JP` either has `consentedAt` set or has a recorded decision to proceed. |
| ☐ | Anything genuinely ambiguous recorded as `UNKNOWN`, which is treated as consent-first and therefore fails safe. Do not guess. |

**Reviewed by:** ______________  **Date:** ____________  **Rows reviewed:** ____ / 23

`PASS ☐   FAIL ☐`

---

### VER-11 — No Google credential in any client-reachable payload

**Proves:** REQ-11 · **Credentials:** Google sign-in required to be meaningful · **Priority:** P1

1. Sign in, then read the live access token from the credential store:
   ```bash
   TOKEN=$(sqlite3 prisma/dev.db "SELECT accessToken FROM GoogleCredential LIMIT 1;")
   echo "token length: ${#TOKEN}"
   echo "prefix: ${TOKEN:0:12}"
   ```
2. Fetch both pages with the session cookie and search the payload:
   ```bash
   curl -s -b "$HOME/.qa-cookies.txt" http://localhost:3000/       > /tmp/page-root.html
   curl -s -b "$HOME/.qa-cookies.txt" http://localhost:3000/queue  > /tmp/page-queue.html
   grep -c "$TOKEN"        /tmp/page-root.html /tmp/page-queue.html
   grep -c "${TOKEN:0:12}" /tmp/page-root.html /tmp/page-queue.html
   grep -c 'accessToken'   /tmp/page-root.html /tmp/page-queue.html
   ```
3. Confirm the sanitisation is in the layout, and that it strips **only** the token:
   ```bash
   grep -n -A 12 'const session = await auth' app/layout.tsx
   grep -n 'error' app/layout.tsx        # expect NO match — session.error must survive
   ```
4. Confirm sign-in state still works: the avatar menu renders the signed-in address, and
   sign-out still functions.
5. **Confirm the expired-session prompt still renders.** `components/crm/top-bar.tsx:34-36` reads
   `session.error === "RefreshAccessTokenError"` to swap the avatar menu for a "Session expired —
   sign in again" button. Stripping that field alongside the token silently reverts a shipped fix,
   and every other step in this procedure would still pass.
   ```bash
   grep -n 'RefreshAccessTokenError' components/crm/top-bar.tsx
   ```
   Then force the state: with the dev server running, corrupt the stored refresh token so the next
   refresh fails, reload, and confirm the button appears rather than the avatar.
   ```bash
   cp prisma/dev.db /tmp/qa-ver11.db                     # you are about to break a credential
   sqlite3 prisma/dev.db "UPDATE GoogleCredential SET refreshToken='invalid', expiresAt=0;"
   # reload http://localhost:3000 and observe the top bar, then restore:
   cp /tmp/qa-ver11.db prisma/dev.db && rm -f /tmp/qa-ver11.db
   ```
   Restoring the file is not enough on its own — the JWT cookie holds its own copy of the tokens,
   so sign out and back in afterwards to return to a clean state.
6. Clean up — these files contain session data:
   ```bash
   rm -f /tmp/page-root.html /tmp/page-queue.html
   ```

**Expected:** every `grep -c` in step 2 returns `0`. Step 3 shows the token stripped before it
reaches `<SessionProvider>`, and shows `error` **not** being stripped. Step 4 unaffected. Step 5
renders the re-auth button.

**Fail if:** the token or its prefix appears in either payload; **or the expired-session button no
longer appears**. Note the token is a live `gmail.compose` credential — a hit here means any script
on the page can draft mail as the user. And note that a `VER-11` that checked only the first half
would pass while reverting roadmap E3's fix, which is why step 5 exists.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-13 — Limited Use boundary recorded and enforced

**Proves:** REQ-13 · **Credentials:** none · **Priority:** P1

1. Confirm the decision is recorded:
   ```bash
   grep -n 'D20' docs/ROADMAP.md
   ```
2. Confirm the compose brief is still assembled explicitly, field by field, and never spreads a
   row:
   ```bash
   grep -n -A 22 'const brief = \[' app/api/compose/route.ts
   grep -n '\.\.\.account' app/api/compose/route.ts
   ```
3. Confirm no Gmail-derived field can enter the brief:
   ```bash
   grep -niE 'threadId|interaction|message.*body|gmail' app/api/compose/route.ts
   ```
4. Confirm the boundary comment exists and names the constraint.

**Expected:** step 1 finds a `D20` row naming the CRM-authored / Gmail-derived boundary. Step 2
shows explicit field assembly with no spread. Step 3 returns nothing, or only a comment.

**Fail if:** the brief spreads the account row (a future column would leak silently); any
`Interaction` row with a non-null `threadId` can reach the prompt; or the decision is undocumented.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-14 — LLM routing is non-retaining and on a GA model

**Proves:** REQ-14 · **Credentials:** `OPENROUTER_API_KEY` · **Priority:** P1

1. Confirm the default model is not a preview endpoint:
   ```bash
   grep -n 'DEFAULT_MODEL' lib/llm.ts
   ```
2. Confirm the routing preference is on the request:
   ```bash
   grep -n -B 3 -A 10 'chat.completions.create' app/api/compose/route.ts
   ```
3. Observe the actual outbound request body:
   ```bash
   source /tmp/rs01-fixtures.env
   curl -s -X POST http://localhost:3000/api/compose \
     -H 'Content-Type: application/json' -d "{\"accountId\":\"$F_PARTNER\"}" > /dev/null
   # Then confirm on the OpenRouter dashboard that the request routed to a
   # non-collecting provider and that the model matches DEFAULT_MODEL.
   ```
4. Confirm the processor entry exists:
   ```bash
   grep -n -i 'openrouter' docs/requirements/04-COMPLIANCE-REGISTER.md
   ```

**Expected:** `DEFAULT_MODEL` contains no `-preview` / `-exp` suffix. The completion call carries
a provider preference denying data collection. The dashboard confirms the routed provider. Doc 04
§5 lists the gateway as a processor with purpose, data categories, and safeguard.

**Fail if:** the model is still `google/gemini-3-flash-preview`; the preference is absent or was
silently dropped by SDK typing (verify against the dashboard, not the source); or no processor
entry exists.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-15 — A data-subject request can be fulfilled

**Proves:** REQ-15 · **Credentials:** none · **Priority:** P1

1. **Access.** Export one contact's full record:
   ```bash
   npx tsx prisma/export-contact.ts qa-partner@example.com
   ```
2. Confirm the export includes related history, not just the row:
   ```bash
   source /tmp/rs01-fixtures.env
   sqlite3 prisma/dev.db "SELECT COUNT(*) FROM StatusEvent WHERE accountId='$F_PARTNER';"
   sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Interaction WHERE accountId='$F_PARTNER';"
   ```
3. **Erasure.** Verify the cascade rather than assuming it:
   ```bash
   sqlite3 prisma/dev.db "INSERT INTO StatusEvent (id, accountId, fromStatus, toStatus, changedAt) VALUES ('qa-se-1','$F_PARTNER','Prospect','Engaged',$(date +%s)000);"
   curl -s -X DELETE "http://localhost:3000/api/accounts/$F_PARTNER"
   sqlite3 prisma/dev.db "SELECT COUNT(*) AS orphans FROM StatusEvent WHERE accountId='$F_PARTNER';"
   ```
4. **Erasure plus objection — the collision case (doc 04 §6.3).** This is the one the runbook
   says is most likely to be got wrong, and it is now testable rather than aspirational. Erase a
   contact who is also suppressed, and confirm the suppression record survives:
   ```bash
   source /tmp/rs01-fixtures.env
   curl -s -X DELETE "http://localhost:3000/api/accounts/$F_SUPPRESSED"
   sqlite3 prisma/dev.db "SELECT COUNT(*) AS account_gone FROM Account WHERE id='$F_SUPPRESSED';"
   sqlite3 prisma/dev.db "SELECT email, DATE(optedOutAt/1000,'unixepoch') FROM Suppression WHERE email='qa-suppressed@example.com';"
   ```
   Then confirm the objection is still honoured for the **twin** in the other campaign, whose row
   was not deleted:
   ```bash
   curl -s http://localhost:3000/api/queue | grep -c "$F_TWIN"
   ```
5. **Objection.** Otherwise covered by VER-01/01b/02/03 — the `Suppression` row is the objection
   record.
6. Confirm the runbook is written and matches what you just did:
   ```bash
   grep -n -A 5 -i 'runbook\|access\|erasure\|objection' docs/requirements/04-COMPLIANCE-REGISTER.md | head -40
   ```

**Expected:** the export runs and includes status events and interactions. Step 3 shows
`orphans = 0`. Step 4 shows `account_gone = 0` **and one surviving suppression row** carrying only
the address and the timestamp; step 4's queue check returns `0`. Doc 04 §6 describes all three
request types with the same commands.

**Fail if:** the export omits related records; the cascade leaves orphans; **the suppression record
is deleted along with the contact** — that is the failure mode §6.3 exists to prevent, and it means
the person can be re-imported and re-emailed after asking for both erasure and no contact; or the
runbook describes a procedure that does not work.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-16 — Contact data cannot reach the public repo

**Proves:** REQ-16 · **Credentials:** none · **Priority:** P1 · **Part manual**

1. Confirm the stray copies are gone:
   ```bash
   ls -la /private/tmp/claude-501/-Users-ari-Documents-simple-crm/*/scratchpad/ 2>/dev/null
   find /private/tmp -name 'dev.db.bak' -o -name 'contacts.backup.json' 2>/dev/null
   ```
2. Confirm the hook is installed and wired:
   ```bash
   git config core.hooksPath
   ls -la .githooks/pre-commit && test -x .githooks/pre-commit && echo "executable"
   ```
3. Exercise it — it must refuse:
   ```bash
   cp prisma/dev.db /tmp/decoy.db && cp /tmp/decoy.db ./decoy.db
   git add -f ./decoy.db 2>/dev/null
   git commit -m "QA: this must be refused" ; echo "exit=$?"
   git reset HEAD ./decoy.db 2>/dev/null; rm -f ./decoy.db /tmp/decoy.db
   ```
4. Confirm nothing sensitive is already tracked:
   ```bash
   git ls-files | grep -iE '\.db$|contacts\.local|\.csv$|dev-feedback' ; echo "matches above should be none"
   ```

| ☐ | Manual check |
| --- | --- |
| ☐ | Both scratch copies from PRD finding F12 deleted. |
| ☐ | Hook refuses `*.db`, `contacts.local.json`, `docs/*.csv`, `.claude/dev-feedback/*`. |
| ☐ | Repo history spot-checked — no contact data was ever committed. |
| ☐ | Every developer on the repo has run `git config core.hooksPath .githooks`. Hooks are not cloned; a hook nobody enabled protects nobody. |

**Expected:** step 1 finds nothing. Step 3 exits non-zero and the commit is refused. Step 4 lists
nothing.

`PASS ☐   FAIL ☐`

---

### VER-17 — First contact discloses where we got their details

**Proves:** REQ-17 · **Credentials:** `OPENROUTER_API_KEY` required · **Priority:** P0 · **Part manual**

> Blocked without a key: `/api/compose` returns `501` by design. If the key is unset, record this
> procedure as BLOCKED — not PASS. REQ-17 is P0 and gates the first partner send.

1. Confirm `sourceType` and `sourceDetail` actually reach the model. The brief in
   `app/api/compose/route.ts` is assembled explicitly so new columns cannot leak in silently —
   which also means they cannot appear unless someone added them:
   ```bash
   grep -n 'sourceType\|sourceDetail' app/api/compose/route.ts
   ```
   Expected: both appear inside the `brief` array. If they do not, REQ-17 cannot pass regardless
   of what the model writes.

2. Confirm the system prompt requires the disclosure, and that the old blockers are gone:
   ```bash
   sed -n '35,50p' app/api/compose/route.ts
   ```
   Expected: no "Do not invent a title or company footer" (PRD finding F2), no "Never state or
   imply that this message was written by AI", and a rule requiring a source sentence when the
   contact did not sign up directly.

3. Draft for the **partner-sheet** fixture (indirectly obtained — disclosure required):
   ```bash
   PARTNER_ID=$(sqlite3 prisma/dev.db "select id from Account where sourceType='partner_sheet' limit 1;")
   curl -s -X POST http://localhost:3000/api/compose \
     -H 'Content-Type: application/json' \
     -d "{\"accountId\":\"$PARTNER_ID\"}" | python3 -m json.tool
   ```

4. Draft for the **waitlist** fixture (obtained directly — no Art 14 source sentence owed):
   ```bash
   WAITLIST_ID=$(sqlite3 prisma/dev.db "select id from Account where sourceType='waitlist_form' limit 1;")
   curl -s -X POST http://localhost:3000/api/compose \
     -H 'Content-Type: application/json' \
     -d "{\"accountId\":\"$WAITLIST_ID\"}" | python3 -m json.tool
   ```

5. Read both bodies. This step is human judgment and cannot be asserted by grep — a sentence can
   contain the right words and still not be a disclosure.

| ☐ | Manual check |
| --- | --- |
| ☐ | The partner-sheet body names the **actual** source, specifically enough that the recipient could recognise it. "I came across your details" is not a disclosure; naming the list, event, or publication is. |
| ☐ | The disclosure appears in the message body, not only in `rationale` — `rationale` is never sent. |
| ☐ | The waitlist body instead references the signup plainly, with when and where (the existing prompt rule). |
| ☐ | Neither body invents a source. If the notes do not record where a contact came from, that is a `sourceDetail` gap to fix in the data (REQ-08), **not** something the model may fill in. |
| ☐ | Re-run step 3 twice. The disclosure must be present both times — a rule the model follows only sometimes is not a control. |

**Expected:** the partner-sheet draft discloses its source in the body; the waitlist draft does
not need to and does not fabricate one.

**On failure:** this is a prompt-compliance failure, not a code failure. Do not weaken the check.
Tighten the system prompt or, if the model will not comply reliably, escalate — a disclosure that
appears 4 times in 5 does not satisfy Art 14, and the fallback is to append the source sentence
deterministically in `buildRawMessage` alongside the footer (CRM-104), where the model cannot
drop it.

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-18 — Every control has an owner and a review date

**Proves:** REQ-18 · **Credentials:** none · **Priority:** P1

1. Read doc 04 §4 and check for empty cells:
   ```bash
   grep -n '^|' docs/requirements/04-COMPLIANCE-REGISTER.md | grep -E '\|\s*\|' | head -20
   ```
2. Confirm every `CTL-nn` cites a `REQ` and a `VER`.
3. Confirm every `REQ` in doc 01 is claimed by at least one `CTL`.

**Expected:** no empty owner or review cells; no orphaned identifier in either direction.

**Fail if:** any control has a blank owner, a blank review date, or no verification evidence.
Per doc 00: *if a chain is broken, something is unowned.*

`PASS ☐   FAIL ☐   BLOCKED ☐`

---

### VER-12 — Refresh token encrypted at rest

**Proves:** REQ-12 · **Priority:** P2 · **DEFERRED — do not execute**

REQ-12 is trigger-based. It becomes live on the first non-localhost deployment. Recorded here so
the identifier is reserved and the gap is visible, not so it is run now.

`N/A — DEFERRED ☑`

---

## 4. Regression invariants

Run after every ticket in this set. These are things that were working and must keep working.
None of them are in scope for RS-01, which is exactly why they get broken.

### R1 — Lint count is exactly 3

```bash
npm run lint 2>&1 | grep -c 'set-state-in-effect'
```

**Must be exactly `3`.** Not 2, not 4. Three pre-existing `react-hooks/set-state-in-effect`
errors are the documented baseline (roadmap §4 acceptance). A **4th** means new code copied the
`account-detail` copy-props-into-state pattern — use the keyed-remount idiom from
`project-settings-dialog.tsx` instead. A drop to **2** is equally a finding: someone refactored an
unrelated component inside a compliance ticket.

### R2 — Project account counts still render

`CLAUDE.md` documents that `_count.accounts` is maintained **by hand in four separate places**,
because neither the POST nor the PATCH response includes it. Do not "fix" the sidebar to trust
the API shape.

| ☐ | Check |
| --- | --- |
| ☐ | Create a project → sidebar shows `0 accounts`, not blank. |
| ☐ | Create a contact → the project's count increments. |
| ☐ | Move a contact between projects → one decrements, one increments. |
| ☐ | **Edit a project via the settings dialog → the count does not drop to `0 accounts`.** This is the one that breaks. |

### R3 — Gmail draft deep link still resolves

```bash
sqlite3 prisma/dev.db "SELECT draftLink FROM Account WHERE draftLink IS NOT NULL LIMIT 3;"
```

The link is built from the **nested `message.id`**, not `draft.data.id`. This is deliberate and
correct — Gmail's UI resolves `#drafts?compose=<message id>`. `draft.data.id` produces a dead
link. If a compliance ticket touched the draft route, confirm nobody "fixed" it.

| ☐ | Link opens the correct draft in Gmail. |
| ☐ | Mailbox path is the URL-encoded signed-in address, not `u/0`. |

### R4 — `draftLink` is still written on success

```bash
source /tmp/rs01-fixtures.env
sqlite3 prisma/dev.db "SELECT COALESCE(draftLink,'<null>') FROM Account WHERE id='$F_CLEAN';"
# create a draft from the UI, then re-run
```

Must move from `<null>` to a URL. Adding a guard clause ahead of the write-back is the likely way
this regresses.

### R5 — Queue ordering unchanged for non-suppressed rows

```bash
curl -s http://localhost:3000/api/queue | python3 -c "
import json,sys
rows = json.load(sys.stdin)
print(f'{len(rows)} rows')
for r in rows[:8]:
    print(f\"  {r['nextActionDue'] or '(no due date)':28} {r['name']}\")
"
```

| ☐ | Rows with a due date come first, most overdue at the top. |
| ☐ | Rows with no due date follow, oldest `lastContact`-or-`createdAt` first. |
| ☐ | Row count dropped by exactly the number of suppressed contacts — no more. |
| ☐ | **Contacts with no email address are still present.** SQL `NOT IN` against a `NULL` column excludes the row, so a suppression filter written as `email NOT IN (…)` silently drops every one of them. Eleven of the 34 real contacts have no address, and they are exactly the rows the queue is most likely to hold. See TRD §5.1 and risk R10. |

```bash
# The null-email check, explicitly. Compare the two numbers.
sqlite3 prisma/dev.db "SELECT COUNT(*) AS no_email_total FROM Account WHERE email IS NULL OR email = '';"
curl -s http://localhost:3000/api/queue | python3 -c "
import json,sys
rows = json.load(sys.stdin)
print('no_email_in_queue', sum(1 for r in rows if not r.get('email')))
"
# The queue figure will be lower (some are excluded by status or due date) but it must
# not be zero unless it was zero before the change.
```

### R7 — Project settings dialog still saves every field

Nothing in RS-01 edits this dialog, which is exactly why it is worth a look: it deliberately does
not follow the create-dialog idiom — it mounts a keyed inner form while open rather than copying
props into state — and it is the component most likely to acquire a field the wrong way.

| ☐ | Open settings on a project with values set → all four fields show their current values. |
| ☐ | Change one → save → reopen → the change persisted and nothing else was cleared. |
| ☐ | Clear `fromEmail` → save → the column is `NULL`, not `''`. Check it: `sqlite3 prisma/dev.db "SELECT typeof(fromEmail), fromEmail FROM Project;"` |
| ☐ | The project's account count still renders after saving (this is R2's failing case). |

### R6 — App still works with no Google and no LLM keys

| ☐ | With `AUTH_GOOGLE_ID` unset: app loads, projects and contacts render, editing works. |
| ☐ | With `OPENROUTER_API_KEY` unset: `/api/compose` returns **501** with instructions, and the composer still works by hand. |

Signing in is optional overall. A compliance guard that hard-fails the app when Google is absent
is a regression.

---

## 5. Pre-send human checklist

**Run once per campaign, before the first real outreach email leaves.** Not automated, by design
(PRD non-goal N1). This is the last gate between the code and a real person's inbox.

| ☐ | Item | How to check |
| --- | --- | --- |
| ☐ | Legal entity name and physical postal address configured, spelled correctly, and a real deliverable address. | Read the footer in a real Gmail draft. Do not read the env var. |
| ☐ | Footer read end-to-end in an actual Gmail draft — identity, address, opt-out instruction all present and coherent, and the entity named is the one actually sending this campaign. | VER-06 Path A. |
| ☐ | Subject line renders correctly in Gmail, including any non-ASCII character. The default composed subject contains an em dash. | VER-06 step 7. |
| ☐ | Every contact in the batch has a non-null `jurisdiction`. | VER-10b hard gate query. |
| ☐ | Consent-first recipients (EU / UK / CA / JP) either have `consentedAt` set, or a decision to proceed is recorded against the contact. | Query below. |
| ☐ | **No suppressed contact is in the batch.** Note the check is by address against the `Suppression` table, which spans campaigns — a person who opted out of a *different* campaign must not be in this one either. | Query below. |
| ☐ | SPF, DKIM, and DMARC all passing for the sending domain. Each TLD has its own sender reputation and needs its own pass — a green result for one product's domain says nothing about another's. | Send a test to mail-tester.com; roadmap 0.c. 6 of 9 waitlist recipients are on Gmail. |
| ☐ | `Project.fromEmail` is either **null** or a **verified** `sendAs` alias on the signed-in mailbox. | See warning below. |
| ☐ | One draft read start to finish as the recipient would see it — subject, opening line, ask, footer. | Human read. |

```bash
# No suppressed contact in the batch. Joined against the Suppression table by address,
# so an opt-out recorded while working ANY campaign is caught here.
sqlite3 -header -column prisma/dev.db \
  "SELECT a.name, a.email, DATE(s.optedOutAt/1000,'unixepoch') AS opted_out, s.source
   FROM Account a
   JOIN Project p ON p.id = a.projectId
   JOIN Suppression s ON s.email = a.email
   WHERE p.name = 'REPLACE_WITH_CAMPAIGN';"
# Must return zero rows.
```

```bash
# The address this campaign will send from. The footer identity is the CRM_SENDER_* pair
# in .env and is the same for every campaign — read it in a real draft, not here.
sqlite3 -header -column prisma/dev.db \
  "SELECT name, COALESCE(fromEmail,'<mailbox default>') AS from_addr
   FROM Project WHERE name = 'REPLACE_WITH_CAMPAIGN';"
```

```bash
# Consent-first recipients without consent on file.
sqlite3 -header -column prisma/dev.db \
  "SELECT name, email, jurisdiction FROM Account
   WHERE jurisdiction IN ('EU','UK','CA','JP') AND consentedAt IS NULL;"
# Every row here needs a recorded decision before it is emailed.
```

> **`fromEmail` warning — roadmap defect E5.** Setting `Project.fromEmail` to an address that is
> not a verified `sendAs` alias converts a working draft into an opaque **502**. The
> `gmail.compose` scope cannot enumerate aliases, so the app *cannot* preflight this for you.
> `mangood.app` and `michikanji` are Resend domains, not Workspace ones — each needs inbound
> forwarding to receive Gmail's confirmation code before `sendAs` will verify.
> **Leave `fromEmail` null until the alias verifies.** Null degrades cleanly to the mailbox
> default. A wrong value fails loudly and confusingly, mid-campaign.

**Campaign:** ______________________ **Gate run by:** ______________ **Date:** ____________

---

## 6. Sign-off

| VER ID | Requirement | Executed by | Date | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| VER-01 | REQ-01 suppression is a person-scoped record | | | | |
| VER-01b | REQ-01 one opt-out covers every campaign | | | | |
| VER-02 | REQ-02 queue excludes suppressed | | | | |
| VER-03 | REQ-03 draft route refuses | | | | |
| VER-04 | REQ-04 survives re-import | | | | |
| VER-05 | REQ-05 one-action opt-out | | | | |
| VER-06 | REQ-06 / REQ-06c compliant footer + subject encoding | | | | |
| VER-06b | REQ-06b preview matches sent | | | | |
| VER-07 | REQ-07 composer instructions | | | | |
| VER-08 | REQ-08 provenance fields | | | | |
| VER-09 | REQ-09 backfill complete | | | | |
| VER-10 | REQ-10 jurisdiction gate | | | | |
| VER-10b | REQ-10b jurisdiction on all 23 emailable contacts | | | | |
| VER-11 | REQ-11 no token in payload | | | | |
| VER-12 | REQ-12 token encryption | — | — | DEFERRED | Trigger: first non-localhost deploy |
| VER-13 | REQ-13 Limited Use boundary | | | | |
| VER-14 | REQ-14 LLM routing | | | | |
| VER-15 | REQ-15 DSR runbook | | | | |
| VER-16 | REQ-16 repo data protection | | | | |
| VER-17 | REQ-17 source disclosure at first contact | | | | |
| VER-18 | REQ-18 register complete | | | | |

**Regression sweep**

| Check | Executed by | Date | Result |
| --- | --- | --- | --- |
| R1 lint count is exactly 3 | | | |
| R2 project account counts | | | |
| R3 draft deep link | | | |
| R4 draftLink written | | | |
| R5 queue ordering + null-email rows present | | | |
| R6 works with no keys | | | |
| R7 project settings dialog saves every field | | | |

**Milestone gate sign-off**

| Gate | Requires | Signed | Date |
| --- | --- | --- | --- |
| **M0 — first send is lawful** | **All P0:** VER-01, **01b**, 02, 03, 04, 05, 06, 07, 10, 10b, 17 — plus the full regression sweep. VER-17 needs `OPENROUTER_API_KEY`; BLOCKED is not PASS and does not clear this gate. | | |
| M1 — evidence is durable | VER-08, VER-09, **VER-11**, VER-15, **VER-16**, VER-18 | | |
| M2 — store is safe to build | VER-13, VER-14 | | |


---

## 7. Escalation

**When a procedure fails:**

1. **Do not mark the ticket done.** A ticket whose verification failed is in progress, whatever
   the diff looks like.
2. **Record it in §6** with the observed result, not a summary. Paste the actual command output.
3. **Log it against the ticket** in doc 03, and add a row to the change log in doc 00 if the
   requirement itself turns out to be wrong.
4. **If it is a P0, stop.** Do not run the remaining P0 procedures hoping the picture improves —
   fix and re-run from the failing procedure.

**The M0 gate is hard.** Every P0 verification — VER-01, 01b, 02, 03, 04, 05, 06, 07, 10, 10b,
**and 17** — must read PASS before the first real outreach email is sent. Not "PASS with a note", not "PASS, will
fix in a follow-up ticket". A **BLOCKED** P0 blocks the gate exactly as a **FAIL** does; missing
credentials are a reason the gate is not open yet, not a reason to pass through it.

This is a one-way door. Suppression, footers, and consent evidence are cheap to build against 26
contacts who have never been emailed, and expensive to retrofit against 26 people who have — at
which point the opt-outs are already arriving as replies into a mailbox with nowhere to put them.

**If a requirement turns out to be wrong rather than unmet**, that is a legitimate outcome — take
it to Product for a change-control entry per doc 00. Silently relaxing an acceptance criterion to
make a procedure pass is not.
