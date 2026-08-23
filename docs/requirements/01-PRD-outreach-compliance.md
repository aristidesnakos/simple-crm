# 01 — PRD: Outreach Compliance & Data Protection

**Set:** RS-01 · **Status:** Draft for engineering review · **Opened:** 2026-08-21
**Product owner:** Ari Nakos · **Reviewers:** Tech Lead, external counsel (spot review of §7)

---

## 1. Summary

simple-crm can compose an email and create a Gmail draft. It cannot record that someone asked
not to be contacted, cannot prove why we were allowed to contact them in the first place, and
cannot produce a message that satisfies the disclosure rules that apply the moment we send one.

This PRD specifies the minimum surface required before the first outreach email leaves the app,
plus the data-protection controls that become obligations the moment we turn on the LLM composer
or store message content.

**It is a compliance-completion effort, not a feature.** No new user-facing capability is
proposed. The product gets slightly more friction and materially less legal exposure.

---

## 2. Why now

The trigger is not a date, it is a state change. Three facts, verified against the database and
the code on 2026-08-21:

1. **Nothing has ever been sent.** 34 contacts, 3 projects, 0 draft links, 0 recorded
   interactions, 0 status events. The Gmail draft path has never executed in production use.
2. **The list is ready and decaying.** 9 warm waitlist signups (median age ~103 days), 17
   partner-list contacts, and 8 shodo-school contacts are imported and queued across three
   campaigns on two product domains.
3. **The blockers are being cleared.** Google credentials are populated; the Workspace tenant and
   verified sending aliases are in flight as roadmap Phase 0.

The first send converts every gap below from theoretical to live. **Retrofitting suppression
after you have emailed 23 people is materially harder than building it before**, because the
opt-outs arrive as replies into a mailbox with nowhere to put them — and, per F16, into a mailbox
this application cannot read.

---

## 3. Current state — verified findings

Each of these was confirmed against the code, not inferred.

| # | Finding | Evidence |
| --- | --- | --- |
| F1 | No opt-out mechanism exists anywhere in the product. | Zero occurrences of "unsubscribe" or equivalent in any route, component, or schema field. |
| F2 | The LLM composer is instructed **not** to produce a footer. | `app/api/compose/route.ts:40` — *"Do not invent a title or company footer."* |
| F3 | The message builder emits four headers and a body. No footer, no address, no opt-out. | `app/api/gmail/draft/route.ts:8` `buildRawMessage` emits To/From/Subject/Content-Type only. |
| F4 | No status value means "do not contact." | `lib/types.ts` `STATUS_OPTIONS_BY_KIND` — 5 customer + 7 collaborator values, none of them suppression. `Rejected` means the deal was declined. |
| F5 | Status is unvalidated free text, overwritten in place. Suppression expressed as status is reversible by a single edit. | Accounts PATCH whitelist writes `status` with no validation; roadmap defect E7. |
| F6 | Consent evidence for the 9 waitlist rows lives in `Account.notes`, a mutable blob the detail form overwrites on blur. | Roadmap task 1.5; `components/crm/account-detail.tsx` auto-save on blur. |
| F7 | No field records where a contact came from, when, or on what basis. | `prisma/schema.prisma` `model Account` — no source, basis, or consent column. |
| F8 | Recipient jurisdiction is unrecorded. Of **23** emailable contacts, most domains read US; at least one reads UK/EU and two read Japanese — and **both Japanese-reading domains are in `MichiKanji — Shodo Schools`**, not in either Mangood list. | Domain survey of `prisma/dev.db`, re-run 2026-08-22. |
| F9 | A live Gmail access token is serialized into the RSC payload of every page. | `app/layout.tsx:31` passes the whole session to `<SessionProvider>`. Confirmed no client component reads it. |
| F10 | The default LLM is a preview endpoint, and provider data-collection is unconstrained. | `lib/llm.ts` `DEFAULT_MODEL = "google/gemini-3-flash-preview"`; no provider routing preference on the completion call. |
| F11 | The repository is public. Protection of 34 real contacts rests entirely on `.gitignore`. | `aristidesnakos/simple-crm`, visibility `PUBLIC`. |
| F12 | Unmanaged copies of the contact database exist outside any retention process. | `dev.db.bak` (90KB) and `contacts.backup.json` (28KB) in session scratch directories. |
| F13 | A contact's identity is a row, not a person. `Account` is scoped to a `Project`, `email` carries no unique constraint, and the same address may legitimately exist in several campaigns. Zero duplicates exist **today** (23 addresses, 23 distinct) — that is a property of the current data, not of the schema. | `prisma/schema.prisma` `model Account`; aggregate query 2026-08-22. |
| F14 | Sending identity is per campaign (`Project.fromEmail`), but the **legal** identity a statutory footer must carry has no home at all — no column, no config, nothing. All 3 projects have `fromEmail` null, so defect E5 is still dormant. | `prisma/schema.prisma` `model Project`; aggregate query 2026-08-22. |
| F15 | `buildRawMessage` writes `Subject: ${subject}` as raw UTF-8. `charset=utf-8` at `draft/route.ts:27` declares the **body's** encoding; RFC 2822 headers must be ASCII. `account-detail.tsx:51` seeds every composed subject with an em dash, so every draft the app can currently produce corrupts its own subject line. | `docs/HANDOFF.md`, verified against the code 2026-08-22. |
| F16 | The opt-out mechanism the footer will advertise is a reply into a mailbox **the application cannot read**. The scope is `gmail.compose`; there is no inbound path, and the statutory clock starts on receipt. | `lib/auth.ts` `GMAIL_SCOPES`. |

---

## 4. Goals

- **G1** — The first outreach email the app produces is lawful in the recipient's jurisdiction
  without the operator having to remember anything.
- **G2** — An opt-out, however it arrives, can be recorded once **against the person** and is then
  honored permanently by every path in the system — every campaign they appear in, every re-import,
  and after their contact row is deleted.
- **G3** — For any contact, we can answer "why were we allowed to email this person, and who told
  us that" from structured data rather than prose.
- **G4** — Turning on the LLM composer or building the message store does not silently create a
  new third-party data transfer.

## 5. Non-goals

Stated so nobody builds them.

- **N1** — A jurisdiction rules engine. At n=34 a human reviews the exceptions. We record the
  flag; we do not encode the statutes.
- **N2** — A preference centre, hosted unsubscribe page, or double opt-in flow. Reply-based
  opt-out is a valid mechanism and suits 1:1 outreach.
- **N3** — Per-user authorization or multi-tenancy. Roadmap D18/E1 stands; `proxy.ts` remains the
  tripwire.
- **N4** — Automated DSR fulfilment. At this volume the runbook is a human with Prisma Studio.
- **N5** — Bulk send, mail merge, or any ESP in the send path. Roadmap D2/D6 stand.
- **N6** — Retro-fixing every unvalidated field. Only the fields that carry legal meaning get
  validation in this effort.
- **N7** — A `Contact` tier above `Account`, or any general de-duplication of people across
  campaigns. REQ-01's suppression record is keyed on the email address because suppression is the
  one thing that must be person-scoped; nothing else in this effort is, and the roadmap's
  `Account`→`Contact` rename (D18) stays parked with its existing trigger.

---

## 6. Users

One. The operator (solo founder) who works the queue, edits a draft, and presses send in Gmail.
Every requirement below is designed so that **the compliant path is the default path** — there is
no second user to enforce process, so process must be structural.

Secondary reader: whoever inherits this repo. The compliance register (doc 04) is written for
them, not for us.

---

## 7. Requirements

Priority key — **P0**: blocks the first send. **P1**: blocks a specific named capability.
**P2**: hardening, trigger-based.

### EPIC-A — Consent & suppression

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| **REQ-01** | Do-not-contact state is stored **against the person**, in a dedicated timestamped record keyed on the email address — never as a status value, and never as a column on a campaign row. | P0 | A `Suppression` record (`email` primary key, `optedOutAt`, `source`, `note`) exists and is writable through a dedicated API. Setting a status does not affect it. Suppressing a person suppresses them in **every** project, and the record survives deletion of the `Account`. Resolves the durability half of E7; see F13 for why the record is not a column. |
| **REQ-02** | The queue never surfaces a suppressed contact, regardless of status or project. | P0 | `GET /api/queue` excludes suppressed addresses in the query itself, independent of `QUEUE_EXCLUDED_STATUSES`. Verified with a suppressed row whose status is `Prospect`, and with a second row for the same address in a different project. |
| **REQ-03** | The draft route refuses to build a message for a suppressed contact, whichever project the request names. | P0 | `POST /api/gmail/draft` looks the recipient's address up against the suppression record and returns `409` with a specific error naming the opt-out date. No Gmail API call is made. There is no override parameter. |
| **REQ-04** | Suppression survives re-import. | P0 | `prisma/import-mangood.ts` skips any row whose normalized email has a suppression record, and logs each skip by address. Addresses roadmap E8 for the one case where bypass has legal consequence. |
| **REQ-05** | The operator can record an opt-out in one action from the contact detail view, including a free-text note about how it arrived. | P0 | A control in `account-detail` writes the suppression record in one request and the row visibly leaves the queue on next load. Not a blur-fired field — see doc 02 §12.2. |
| **REQ-08** | Every contact carries structured provenance: how we obtained them, the specific source, and — where applicable — when they consented. | P1 | `Account.sourceType`, `sourceDetail`, `consentedAt` exist, are set on create, and are editable. `sourceType` is drawn from a named vocabulary in `lib/types.ts`. |
| **REQ-09** | All 34 pre-existing contacts — the 9 waitlist rows, the 17 partner rows, **and the 8 `MichiKanji — Shodo Schools` rows** — are backfilled with accurate provenance, and the waitlist signup dates are promoted out of `notes` into `consentedAt`. | P1 | A one-shot script sets provenance for all pre-existing rows. Zero rows left with `sourceType = null`. Original `notes` text is preserved, not moved. |

### EPIC-B — Message compliance

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| **REQ-06** | Every message the app builds carries a compliant footer: sender legal identity, a valid physical postal address, and a plain opt-out instruction. | P0 | Footer is appended by `buildRawMessage` server-side, not by the model or the operator, from `CRM_SENDER_LEGAL_NAME` and `CRM_SENDER_POSTAL_ADDRESS`. Draft creation fails closed with a clear error naming the missing variable. **One value each, not one per campaign:** the footer names the legal entity, and a legal entity sits above a campaign — `Mangood — Waitlist` and `Mangood — Partners` share one sender. See Q1, and doc 02 §6.1 for why this is not a column on `Project`. |
| **REQ-06c** | A non-ASCII character in a subject line does not corrupt the message header. | P0 | `buildRawMessage` emits the `Subject:` header as RFC 2047 encoded-words. Adjacent to REQ-06 rather than part of it — same function, same commit, but it is a correctness fix, not a disclosure control. Fires on **every** draft today (F15), and would otherwise be discovered at the M0 smoke test presenting as a footer bug. |
| **REQ-07** | The composer's instructions no longer work against REQ-06, and no longer instruct concealment. | P0 | `app/api/compose/route.ts:40` no longer forbids a footer. Line 45 ("never state or imply this was written by AI") is replaced with a voice instruction that produces the same copy without the concealment framing. |
| **REQ-17** | For contacts whose data we did not obtain from them directly, the first message discloses where we got their details. | P0 | `sourceType` is included in the compose brief, and the system prompt requires a source-disclosure sentence when the source is not a direct signup. Verified on a `partner_sheet` contact. |
| **REQ-06b** | The operator sees the exact message that will be sent, footer included, before creating the draft. | P1 | The composer preview in `account-detail` renders the same footer the route will append. No divergence between preview and draft. |

### EPIC-C — Jurisdiction

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| **REQ-10** | Recipient jurisdiction is recorded, and the app blocks a first contact into a consent-first jurisdiction unless consent is on file or the operator explicitly acknowledges. | P0 | `Account.jurisdiction` exists. The draft route returns `409` for a consent-first jurisdiction with `consentedAt = null`, unless the request carries an explicit acknowledgement flag. The block is per-request; it is never remembered. |
| **REQ-10b** | Before any batch sends, **every contact with an email address on file** has a non-null jurisdiction. | P0 | 23 rows today — 25 collaborator rows exist across two projects, not 17, and 23 of the 34 contacts are emailable. Scoped to emailable contacts rather than to one campaign so the criterion does not go stale the next time a project is added. Manual pass, recorded in doc 05. Not automated — see N1. |

### EPIC-D — Data protection & third parties

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| **REQ-11** | No Google credential is serialized into any client-reachable payload. | P1 | `app/layout.tsx` passes a session object with `accessToken` — and **only** `accessToken` — removed. Confirmed by inspecting the page payload for the token value. Sign-in state, the avatar, **and the expired-session re-auth button** still work: `components/crm/top-bar.tsx:34-36` reads `session.error`, so stripping that field too would silently revert a shipped fix. |
| **REQ-13** | The boundary between CRM-authored data and Gmail-derived content is recorded as a decision and enforced in code. | P1 | A new decision (`D20`) is added to `docs/ROADMAP.md` §2. The compose brief assembly carries an explicit comment and construction that excludes any Gmail-derived field. Blocks the message-store design question. |
| **REQ-14** | The LLM provider is constrained to non-retaining routing on a GA model, and the arrangement is recorded as a processor. | P1 | Completion requests carry a provider preference denying data collection. `DEFAULT_MODEL` points at a GA endpoint, not a preview one. Processor entry exists in doc 04 §5. Closes the substantive half of roadmap E9. |
| **REQ-12** | The stored Google refresh token is encrypted at rest. | P2 | Trigger: **roadmap Phase 0 task 0.d landing** (the Internal consent screen removes refresh-token expiry), or the day this app runs anywhere other than the operator's laptop — whichever is first. Note the direction of travel: 0.d is in flight now and makes the token *longer-lived*, so the trigger is likely to fire during M0 rather than after M1. `GoogleCredential.refreshToken` is plaintext in `prisma/dev.db` today, by design; the schema carries the warning inline. |
| **REQ-16** | Real contact data cannot reach the public repository by accident, and stray copies are purged. | P1 | The two known scratch copies are deleted. A pre-commit hook refuses staged `*.db`, `contacts.local.json`, `docs/*.csv`, and `.claude/dev-feedback/*`. |

### EPIC-E — Governance

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| **REQ-15** | A data-subject request can be fulfilled without engineering improvisation. | P1 | Doc 04 §6 carries a runbook for access, erasure, and objection. An export script exists for the access case. Cascade behaviour for erasure is verified, not assumed. |
| **REQ-18** | Every control has a named owner and a review date. | P1 | Doc 04 §4 is complete — no row with an empty owner or review column. |

---

## 8. Success criteria

The effort is done when all of the following are true:

1. A draft created for any of the 23 emailable contacts contains a compliant footer, an
   uncorrupted subject line, and — where the source was not a direct signup — a source-disclosure
   sentence.
2. Marking a contact opted-out removes them from the queue **in every project they appear in** and
   makes draft creation fail — and re-running the import does not bring them back.
3. Every contact row has a non-null `sourceType`; every waitlist row has a non-null `consentedAt`;
   every emailable contact has a non-null `jurisdiction`.
4. The page payload contains no Google access token, and the expired-session re-auth button in
   `top-bar` still renders.
5. Doc 04 has no empty owner cells.
6. `npm run lint` still reports exactly **3** pre-existing `set-state-in-effect` errors — no more.

---

## 9. Open questions

| # | Question | Blocks | Owner | Needed by |
| --- | --- | --- | --- | --- |
| **Q1** | ~~What legal entity name and physical postal address go in the footer?~~ **ANSWERED 2026-08-23.** One legal entity sends all three campaigns, so the single `CRM_SENDER_*` pair in REQ-06 is the right shape and no per-project column is needed. The values live in `.env` only and are deliberately **not** recorded here — `.gitignore` and the pre-commit hook both keep them out of a public repo, and writing them into a committed document would defeat both. Read them from `.env`, or from a real draft's footer. Residual risk noted at §10. | REQ-06 | Product | ~~Before CRM-104~~ Done |
| **Q2** | Does the footer go on all messages, or only `kind = collaborator`? Recommendation: **all** — three lines, uniformly defensible, and it removes a branch. | REQ-06 | Product | Before CRM-104 starts |
| **Q3** | Which contacts are in consent-first jurisdictions? Requires a human pass over **23 emailable rows** — 25 collaborator rows exist across `Mangood — Partners` (17) and `MichiKanji — Shodo Schools` (8), and the two Japanese-reading domains at F8 are in the latter. | REQ-10b | Product | Before first partner send |
| **Q4** | Is a signed DPA with the LLM gateway required at this volume, or is non-retaining routing sufficient? Spot-review question for counsel. | REQ-14 | Counsel | Before `OPENROUTER_API_KEY` is set |
| **Q5** | Do we publish a privacy notice, or rely on in-message disclosure? At n=34 with no web property collecting data beyond the waitlist form, in-message may suffice. | REQ-17 | Product | Before first partner send |
| **Q6** | If someone opts out of one campaign, are they suppressed for the others? REQ-01 assumes **yes** — one operator, one controller, and both CAN-SPAM's sender test and GDPR Art 21(2)'s controller test read that way. If Mangood and MichiKanji are genuinely separate senders under separate entities (see Q1), that assumption needs re-checking before REQ-01 is built, because the two answers give different schemas. | REQ-01 | Product | Before CRM-101 starts |

---

## 10. Explicitly deferred, with triggers

Following the roadmap's convention: *later* is a condition, not a mood.

| Item | Trigger to revisit |
| --- | --- |
| Refresh-token encryption at rest (REQ-12) | Roadmap Phase 0 task 0.d landing, or first non-localhost deployment — whichever is first. 0.d is in flight, so expect this during M0. |
| The configured footer address is **residential**. It goes into every outbound message and is unretractable once sent — at 0 messages sent it is still free to change, and it will not be after the first batch. | Before the first send, if a registered office or a commercial mail-receiving address is preferred. After that, only on a move — and old messages keep the old address regardless. |
| Per-campaign footer identity. Today it is one `CRM_SENDER_*` pair for the whole app, which is correct while one legal entity sends everything (Q1, answered). | A **second legal entity** starts sending, or a campaign needs a different postal address. Note the fix is then the parked **Product tier** (roadmap D16), not columns on `Project`: two Mangood campaigns share one sender, so a per-project column would store the same entity twice. |
| Inbound reply detection, so an opt-out reply is *seen* rather than relied on being noticed (F16) | The first opt-out noticed late, or the day the message index is built. Recorded as a residual risk in doc 04 §7 rather than engineered around here — an inbound path needs a wider Gmail scope than this effort grants. |
| Hosted preference centre / unsubscribe page | The day a message goes to more than ~50 recipients in a batch. |
| Automated DSR export/erasure endpoints | The second real data-subject request. |
| Jurisdiction rules engine | Never at this scale — see N1. Revisit at ~500 contacts across 3+ regions. |
| Consent re-confirmation cadence for aging waitlist rows | If the waitlist is still unworked at 12 months from signup. |
| Retention schedule and automatic purge | The day the contact count exceeds what one person can review by hand. |
