# 04 — Compliance Register

**Set:** RS-01 · **Status:** Draft, unreviewed by counsel · **Opened:** 2026-08-21
**Maintainer:** Ari Nakos (operator) · **Next full review:** 2026-11-21

---

## Honesty note

Read this before you rely on anything below.

This register is maintained by **one person**, who is also the operator, the engineer, and the
data controller. It has **not been reviewed by external counsel**, except where an individual row
says otherwise. It describes controls in a **single-tenant application running on one laptop**,
with a SQLite database, no access logging, and no separation of duties.

Nothing here should be read as a legal opinion or as an assertion that this system is compliant.
It is a record of which obligations we believe apply, what we have actually built against them,
and — more importantly — what we have not.

**Overclaiming in a compliance document is worse than a gap.** A gap that is written down gets
fixed. A control that is described as "Implemented" when it is aspirational becomes the thing an
auditor finds, and it destroys the credibility of every other row. If you are editing this file
and unsure whether something is really done, mark it `Gap` and move on.

---

## 1. How to use this register

A control is **real** only when it has all four of:

1. A named **owner** — a person, not a team or a role that nobody fills.
2. An **implementing ticket** in `docs/requirements/03-DELIVERY-PLAN.md`.
3. An **evidence procedure** in `docs/requirements/05-QA-VERIFICATION.md` that someone can run.
4. A **review date** that has not passed.

State values mean exactly this and nothing softer:

| State | Meaning |
| --- | --- |
| **Implemented** | The control exists in code or process today, and its evidence procedure has been run and passed at least once. |
| **Planned** | **This is a gap.** The control does not exist. A ticket is written. Do not read a planned row as protection. |
| **Gap** | No control, no ticket. Either accepted with a trigger (§7) or genuinely unowned — which is a bug in this document. |
| **N/A** | The obligation does not apply, with the reason stated. |

Cross-references: `REQ-nn` → doc 01, `CRM-nnn` → doc 03, `VER-nn` → doc 05, `D-nn` → `docs/ROADMAP.md` §2,
`E-n` → `docs/ROADMAP.md` §7 defect table. Where a `VER` number drifts, **doc 05 is authoritative**.

---

## 2. Jurisdiction matrix

Recipient jurisdiction determines the rules, and it is currently unrecorded for every contact
(finding F8). `REQ-10` adds the field; `REQ-10b` populates it for the partner list before send.

| Jurisdiction | Governing regime | Basis for first contact | Mandatory in every commercial message | Opt-out honor window | Notes |
| --- | --- | --- | --- | --- | --- |
| **United States** | CAN-SPAM Act, 15 U.S.C. §§ 7701–7713; FTC rule at 16 C.F.R. Part 316 | **Opt-out regime.** No prior consent required. You may send first. | Functioning opt-out mechanism (return address or internet-based), valid **physical postal address**, notice of the opt-out opportunity, no materially false or misleading header information, no deceptive subject line | **10 business days** (§ 7704(a)(4)); the opt-out mechanism must remain functional for at least 30 days after transmission | Statutory penalties accrue **per message** and are inflation-adjusted annually — do not quote a fixed figure. State-level laws may add requirements. |
| **European Union** | GDPR (Reg. (EU) 2016/679) + ePrivacy Directive 2002/58/EC Art 13 | **Consent-first for individuals.** Art 13(1) requires prior consent for unsolicited direct-marketing email. Art 13(2) "soft opt-in" is narrow: existing customer, similar products/services, opportunity to object at collection and in every message. | Sender identity must not be disguised; a valid address for opt-out requests (Art 13(4)). GDPR Art 13/14 transparency information applies **regardless of the marketing basis**. | Art 21(2) objection is **absolute** — no balancing test, must stop on request. Honor without undue delay; Art 12(3) sets one month as the outer bound for responding. | ePrivacy is a **directive**, implemented differently per member state. Some states extend Art 13 to legal persons, some do not. Assume the stricter reading unless the specific member state has been checked. |
| **United Kingdom** | UK GDPR + PECR 2003 (Privacy and Electronic Communications Regulations), reg. 22 | **Consent-first for "individual subscribers"** (individuals, sole traders, unincorporated partnerships). **Corporate subscribers** (limited companies, LLPs) fall outside reg. 22 — B2B email to a corporate subscriber does not require PECR consent. | Sender identity, a valid address for opt-out | Objection honored promptly; UK GDPR mirrors the one-month response bound | **The corporate-subscriber latitude is narrower than it sounds.** A named individual at a company (`firstname@company.com`) is still **personal data** under UK GDPR — Art 13/14 notice, Art 21 objection, and access/erasure rights all still apply. The PECR carve-out removes the consent requirement, not the data-protection obligations. |
| **Canada** | CASL, S.C. 2010, c. 23 | **Consent required — express or implied. There is no legitimate-interest route.** Implied consent includes an existing business relationship and the "conspicuous publication" route (a business email address published without a statement refusing CEMs, where the message is relevant to that person's role). | Sender identification, contact information that remains valid for **60 days**, and a functioning unsubscribe mechanism | **10 business days** | **Strictest regime we are likely to touch.** Administrative monetary penalties up to **CAD 10M** for a corporation and CAD 1M for an individual. Check for `.ca` domains and Canadian entities before any partner send. |
| **Japan** | Act on Regulation of Transmission of Specified Electronic Mail (Act No. 26 of 2002, as amended 2008) | **Opt-in.** Prior consent generally required, with exemptions — notably where the recipient has provided the address in the course of a business transaction, and for businesses that have publicly disclosed a business email address. | Sender identification and an opt-out mechanism | Honor on request | Pinpoint requirements not independently verified by us. Two contact domains read Japanese (F8). **Treat as consent-first and get the exemption confirmed before sending**, rather than assuming the business-disclosure exemption applies. |

### 2.1 The CAN-SPAM "commercial message" nuance

This matters because it splits our own list in two, and it is a judgment call rather than a
settled fact.

CAN-SPAM applies to a **"commercial electronic mail message"** — one whose *primary purpose* is
the commercial advertisement or promotion of a product or service (§ 7702(2)(A)). A genuinely
one-to-one, individually written relationship message whose primary purpose is not advertisement
may fall outside that definition, and the Act separately excludes "transactional or relationship"
messages (§ 7702(17)).

Applied to our two lists:

Applied to our **three** lists — the third is easy to miss, and it is the one holding both
Japanese-reading domains at F8:

| List | Rows | Emailable | Our reading | Confidence |
| --- | --- | --- | --- | --- |
| `Mangood — Waitlist` | 9 | 9 | Warm inbound signups who asked to hear from us. A message that follows up on their own signup **plausibly qualifies** as a relationship message rather than a commercial one. | Moderate. Not a basis for skipping the footer — see below. |
| `Mangood — Partners` | 17 | 12 | Outbound promotion of a product to businesses that did not ask. **This is commercial email.** The nuance does not help here. | High. |
| `MichiKanji — Shodo Schools` | 8 | 2 | Outbound promotion of a different product, on a different domain, to businesses that did not ask. Commercial email, and the two emailable rows are the two whose domains read Japanese — so §2's Japan row governs, not CAN-SPAM's. | High on the classification; **low** on the jurisdiction, which is exactly what REQ-10b exists to resolve. |

**Two things follow, and both are operational:**

1. The nuance is a *defence*, not a *plan*. It is cheap to add a compliant footer to all messages
   and expensive to argue about primary purpose after a complaint. See doc 01 Q2 — the
   recommendation is to footer everything.
2. **CASL and GDPR have no equivalent escape hatch.** CASL's definition of a commercial electronic
   message is broad and its consent requirement has no purpose-based carve-out of this shape.
   GDPR's Art 21(2) objection right and Art 13/14 transparency duties attach to processing
   personal data, not to whether a message is "commercial." A message that escapes CAN-SPAM
   entirely can still breach both.

---

## 3. Personal data inventory

Everything below is personal data about identifiable living people, held on one laptop.

| Data category | Fields | Source | Where stored | Who can access | Retention | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Contact identity | `Account.name`, `Account.email` | Waitlist form (9), partner sheet (17), manual entry | `prisma/dev.db` (SQLite, unencrypted, gitignored) | Operator; anyone with the laptop; any process on the machine | **Indefinite — no schedule** | 34 rows, 22 with an email address. `.gitignore` is the only thing keeping this out of a public repo (F11). |
| Contact research notes | `Account.notes`, `Account.labels`, `Account.nextAction` | Hand-typed by operator; partner sheet import | Same | Same | **Indefinite — no schedule** | Free text. **May contain third-party observations and opinions about the data subject** — which are themselves personal data and are in scope for an access request. Also currently the only home for waitlist consent evidence (F6), which `REQ-09` moves out. |
| Pipeline state | `Account.status`, `kind`, `lastContact`, `nextActionDue`, `draftLink`, `notesLink` | Operator | Same | Same | **Indefinite — no schedule** | Unvalidated free text (E7). |
| Provenance & consent | `Account.sourceType`, `sourceDetail`, `consentedAt`, `jurisdiction` | Import scripts, operator | Same | Same | **Retain as long as the contact record** — this *is* the consent evidence | **Planned**, not yet present (`REQ-08`). |
| Sender identity | `CRM_SENDER_LEGAL_NAME`, `CRM_SENDER_POSTAL_ADDRESS` (env); `Project.fromEmail` (per campaign) | Operator | `.env`, gitignored; `prisma/dev.db` for `fromEmail` | Same | As long as the deployment | Not personal data about a contact, but the footer pair appears in **every** outbound message as a statutory disclosure, so an error here is an error in 100% of sends. One pair, not one per campaign: the footer names the legal entity, which sits above a campaign. **Planned**, not yet present (`REQ-06`). |
| Suppression state | `Suppression.email`, `optedOutAt`, `source`, `note` — its **own table**, keyed on the normalized address | Operator, recording an inbound request | Same | Same | **Retain indefinitely and deliberately.** See §6.3 — deleting a suppression record is how people get re-emailed. | **Planned**, not yet present (`REQ-01`). Deliberately not a column on `Account`: `Account` is scoped to a `Project` and cascade-deletes, so a column could neither span campaigns nor survive an erasure request. This is the one record in the inventory that is retained *because* of a data-subject request rather than in spite of one. |
| Status history | `StatusEvent` (`fromStatus`, `toStatus`, `changedAt`) | Accounts PATCH route only | Same | Same | **Indefinite — no schedule** | Currently **0 rows**. Append-only. Written only by the API; imports and Prisma Studio bypass it (E8). |
| Interaction log | `Interaction` (`channel`, `direction`, `occurredAt`, `summary`, `threadId`) | Nothing yet | Same | Same | **Indefinite — no schedule** | Migrated, **no API and no UI** as of 2026-08-21. `summary` will hold what was said to a contact. `threadId` is the hook for a future Gmail index — see §5 and `D20` before populating it. |
| Google credentials | `GoogleCredential.accessToken`, `refreshToken`, `expiresAt`, `scope`, `email` | Google OAuth | Same — **plaintext** | Same | Until revoked at `myaccount.google.com/permissions` | The schema carries its own `SECURITY:` comment: *"prisma/dev.db is gitignored and unencrypted on disk. That is fine on localhost and is not fine hosted."* `refreshToken` is a **standing** Gmail credential; the Phase 0 Internal consent screen deliberately removes its 7-day expiry, which raises blast radius rather than lowering it. |
| Credential in client payload | Google `accessToken` inside the session object | `app/layout.tsx:31` | **Serialized into the RSC payload of every page** | Anything running in the browser; browser cache; anyone shoulder-surfing devtools | Per-response | Finding F9. No client component reads it — confirmed — so removal is free (`REQ-11`). Until then, any XSS is a full `gmail.compose` compromise. |
| Dev feedback screenshots | `.claude/dev-feedback/*.png`, `.claude/dev-feedback.json` | Right-click capture in dev mode | Local filesystem, gitignored | Operator | **Indefinite — no schedule** | Rasterizes a live DOM element. **A capture of the account list or detail pane contains real names, emails, and notes.** Gitignored, and the route 404s outside dev. |
| Stray database copies | Full DB and JSON dumps | Ad-hoc backups during development | `/private/tmp/.../scratchpad/dev.db.bak` (90KB), `contacts.backup.json` (28KB) | Anyone with the laptop; survives outside any process | **None — unmanaged** | Finding F12. Purge under `CRM-114`. These are the clearest storage-limitation problem in the inventory. |

**Retention is the honest headline here: there is no schedule for anything.** Every row above is
kept indefinitely by default. That is a real gap against the storage-limitation principle
(GDPR Art 5(1)(e)). It is accepted for now with a trigger — see doc 01 §10 and §7 below — on the
grounds that 34 rows reviewed by one person is a defensible posture and 3,400 would not be.

---

## 4. Control register

Owner is `Operator` for every row, because there is one person. **That concentration is itself a
risk** and is recorded as such in §7. Review dates are the earlier of the calendar date shown and
the event trigger in §8.

| CTL | Obligation | Source | Applies when | State | Control description | Ticket | Satisfies | Evidence | Owner | Next review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **CTL-01** | A functioning opt-out mechanism is present in every commercial message | CAN-SPAM § 7704(a)(3); CASL s. 6(2)(c); ePrivacy Art 13(4) | Every outbound message | **Gap** → Planned | Footer appended server-side in `buildRawMessage`, carrying a plain reply-to-opt-out instruction. Not delegated to the model or the operator. | CRM-104 | REQ-06 | VER-06 | Operator | Before first send |
| **CTL-02** | Sender identification and a valid physical postal address appear in every commercial message | CAN-SPAM § 7704(a)(5); CASL s. 6(2)(b) (contact info valid 60 days) | Every outbound message | **Gap** → Planned | Footer carries legal entity name and postal address from `CRM_SENDER_LEGAL_NAME` / `CRM_SENDER_POSTAL_ADDRESS`. Draft creation **fails closed** if either is unset or blank. One pair for the whole app, because the footer identifies the **legal entity** and one entity sends every campaign here — confirmed at doc 01 Q1, and carrying a trigger at doc 01 §10 for the day that stops being true. | CRM-104 | REQ-06 | VER-06 | Operator | Before first send |
| **CTL-03** | An opt-out, once recorded, is honored permanently by every code path — **every campaign the person appears in**, every re-import, and after their contact row is deleted | CAN-SPAM § 7704(a)(4); GDPR Art 21(3); CASL s. 11 | Continuously, once any message has been sent | **Gap** → Planned | Dedicated `Suppression` table keyed on the normalized email address (never a status value, per F4/F5; never a column on `Account`, per F13), enforced at three independent points: queue query, draft route `409`, and import-script skip — each matching on the **address**, so each holds across projects. Defence in depth because status is unvalidated free text. Known limit: a contact with no address on file cannot be suppressed, and also cannot be emailed by this app. | CRM-101, CRM-103, CRM-105, CRM-109, CRM-121 | REQ-01, REQ-02, REQ-03, REQ-04 | VER-01, **VER-01b**, VER-02, VER-03, VER-04 | Operator | Before first send |
| **CTL-04** | Opt-out requests are actioned inside the statutory window | CAN-SPAM 10 business days; CASL 10 business days; GDPR without undue delay | On receipt of any opt-out | **Gap** → Planned **(recording half only)** | One-action control in the contact detail view so recording an opt-out is faster than ignoring it. **Detection is not covered and is not planned**: the footer advertises a reply-based opt-out into a mailbox the application cannot read (`gmail.compose` grants no read access, PRD F16), and the statutory clock runs from receipt, not from noticing. This control governs what happens *after* the operator sees the reply. See §7 for the residual risk. | CRM-107, CRM-121 | REQ-05 | VER-05 | Operator | Before first send |
| **CTL-05** | No materially false or misleading header information; no deceptive subject line | CAN-SPAM § 7704(a)(1)–(2) | Every outbound message | **Partial** | `From:` is drawn from `Project.fromEmail` and **Gmail itself rejects an address that is not a verified `sendAs` alias** — the platform enforces this, not us. Subject is human-reviewed before send. No app-side check exists, and none is proposed. | — | — | VER-07 | Operator | 2026-11-21 |
| **CTL-06** | Consent, where relied on, is demonstrable | GDPR Art 7(1) | Any EU/UK/CA/JP contact where consent is the basis | **Gap** → Planned | Structured `consentedAt` + `sourceType` + `sourceDetail` columns. Today the waitlist signup dates sit in `Account.notes`, a blob the detail form overwrites wholesale on blur (F6) — that is not demonstrable evidence. | CRM-101, CRM-102, CRM-110 | REQ-08, REQ-09 | VER-08, VER-09 | Operator | Before first EU/UK send |
| **CTL-07** | Where data was not obtained from the data subject, the source is disclosed at first contact | GDPR Art 14, in particular Art 14(2)(f) (source) and Art 14(3)(b) (at latest at first communication) | Partner-sheet and researched contacts | **Gap** → Planned | `sourceType` enters the compose brief; the system prompt requires a source-disclosure sentence when the source is not a direct signup. Verified against a `partner_sheet` row. | CRM-108 | REQ-17 | VER-17 | Operator | Before first partner send |
| **CTL-08** | The right to object to direct marketing is honored absolutely | GDPR Art 21(2)–(3) | Any EU/UK contact | **Gap** → Planned | Same `Suppression` table as CTL-03. Art 21(2) admits no balancing test, so the control must be unconditional — hence no override parameter on the draft-route refusal, and hence person-scope rather than campaign-scope: an objection is to processing by the controller, and there is one controller here whatever the campaign is called. | CRM-101, CRM-105, CRM-121 | REQ-01, REQ-03 | VER-01b, VER-03 | Operator | Before first EU/UK send |
| **CTL-09** | Right of access | GDPR Art 15; response bound Art 12(3) | On request | **Gap** → Planned | Runbook §6.1 plus an export script that emits the contact row with its `StatusEvent` and `Interaction` history. Manual fulfilment is proportionate at n=34 (doc 01 N4). | CRM-115 | REQ-15 | VER-15 | Operator | 2026-11-21 |
| **CTL-10** | Right to erasure | GDPR Art 17 | On request | **Partial** | `DELETE /api/accounts/[id]` exists (no UI caller). `StatusEvent` and `Interaction` carry `onDelete: Cascade`, so erasure *should* be complete — **this must be verified, not assumed** (VER-15). `Suppression` deliberately has **no** relation and therefore no cascade: it survives, which is the §6.3 resolution and not a leak. Runbook at §6.2. | CRM-115 | REQ-15 | VER-15 | Operator | 2026-11-21 |
| **CTL-11** | Recipient jurisdiction is determined before first contact | Determines which of §2 applies | Before any first send | **Gap** → Planned | `Account.jurisdiction` column plus a draft-route `409` for a consent-first jurisdiction with no `consentedAt`, overridable only by an explicit per-request acknowledgement that is never remembered. Deliberately **not** a rules engine (doc 01 N1). | CRM-101, CRM-105, CRM-117 | REQ-10, REQ-10b | VER-10, VER-10b | Operator | Before first send |
| **CTL-12** | Gmail data obtained under restricted scopes is used only within Limited Use bounds | Google API Services User Data Policy — Limited Use requirements | Any use of `gmail.*` restricted scopes | **Implemented (by construction)** | The compose brief is assembled field-by-field from hand-typed CRM data and contains **no Gmail-derived content** — see `app/api/compose/route.ts`, which states this intent explicitly. `D20` records the boundary so it survives the message-store build. See §5. | CRM-113 | REQ-13 | VER-13 | Operator | On any Google scope change |
| **CTL-13** | Third-party processors are constrained and recorded | GDPR Art 28 (processor obligations); Art 32 (security) | Whenever contact data leaves the machine | **Gap** → Planned | Provider routing set to deny data collection; GA model pinned in place of the current preview endpoint (F10); processor entry maintained at §5. Closes the substantive half of roadmap **E9**. DPA question referred to counsel (doc 01 Q4). | CRM-112 | REQ-14 | VER-14 | Operator; **counsel** for the DPA question | Before `OPENROUTER_API_KEY` is set |
| **CTL-14** | Credentials are protected at rest and are never exposed to the client | GDPR Art 32; Google API Services User Data Policy | Continuously | **Gap** → Planned (client) / **Accepted gap** (at rest) | Client half: strip `accessToken` — and **only** `accessToken` — before it reaches `<SessionProvider>` (F9). Free, since nothing client-side reads it; but `session.error` **is** read by `top-bar.tsx` for the expired-session prompt, so stripping more than the token reverts a shipped fix. At-rest half: `GoogleCredential.refreshToken` is plaintext in SQLite, accepted while single-machine, triggered at **Phase 0 task 0.d** or first hosted deployment, whichever is first (`REQ-12`) — note 0.d makes the token longer-lived, so the trigger is likely to fire during M0. | CRM-111 | REQ-11, REQ-12 | VER-11, VER-12 | Operator | Phase 0 task 0.d, or first non-localhost deployment |
| **CTL-15** | Personal data cannot reach the public repository | GDPR Art 32; basic hygiene | Every commit | **Partial** | `.gitignore` covers `*.db`, `/prisma/contacts.local.json`, `/docs/*.csv`, `.claude/dev-feedback/`. That is the **only** barrier and the repo is public (F11). Adding a pre-commit hook that refuses those paths when staged, and purging the two stray copies at F12. | CRM-114 | REQ-16 | VER-16 | Operator | 2026-11-21 |

**REQ-18 check:** 15 rows, 15 owners, 15 review dates. No empty cells.

---

## 5. Third-party processors

| Processor | Purpose | Data shared | Legal mechanism | Safeguard in place | Reviewed |
| --- | --- | --- | --- | --- | --- |
| **Google** (Workspace, Gmail API) | Mailbox hosting; draft creation via `gmail.users.drafts.create`; OAuth identity | Message `To`, `From`, `Subject`, body — i.e. the contact's address and everything we write to them. Google also holds the mailbox itself. | Google Workspace terms; Google API Services User Data Policy. Data-processing terms apply via the Workspace agreement. | Restricted scope limited to `gmail.compose`. Consent screen moving to **Internal** under roadmap Phase 0 task 0.d. `From:` restricted by Google to verified `sendAs` aliases. | 2026-08-21, by operator. **Re-review on any scope change.** |
| **OpenRouter** (LLM gateway) + the upstream model provider it routes to | `POST /api/compose` — drafting outreach copy | Contact **name**, **research notes**, **labels**, **website**, pipeline stage, campaign name/description/approach, and days-since-contact. Assembled explicitly in the route's `brief`. | **None recorded.** No DPA; reliance on the gateway's standard terms. Doc 01 Q4 refers the necessity question to counsel. | **None today.** Default routing may select providers that log and train on prompts. Default model is a **preview** endpoint (`google/gemini-3-flash-preview`), which commonly carries different data-use terms than a GA endpoint. `CRM-112` adds a data-collection-deny routing preference and pins a GA model. | **Not reviewed.** Roadmap **E9** is open, with the correct trigger: *before `OPENROUTER_API_KEY` is ever set.* |

### 5.1 The Google exemption that is not an exemption

This is the single most commonly misread thing in this project's planning, so it is stated here
in full.

Roadmap task **0.d** moves the OAuth client into the Workspace tenant with an **Internal** consent
screen, and correctly notes that this is *"exempt from verification and from the 7-day
refresh-token expiry."* Both are true.

**It is not an exemption from the Google API Services User Data Policy.** The Limited Use
requirements bind any use of restricted `gmail.*` scopes regardless of consent-screen type. What
Internal buys you is exemption from the **verification review** and from the **CASA security
assessment** — process, not obligation.

The Limited Use requirements that actually bite here:

- Use of the data is limited to providing or improving user-facing features that are prominent in
  the app's interface.
- **Transfer of the data to third parties is restricted**, permitted only as necessary to provide
  or improve those features, to comply with applicable law, or in a merger or acquisition.
- The data may not be used for serving advertising.
- Humans may not read the data except with the user's explicit consent for specific messages, where
  necessary for security or to comply with law, or where the data is aggregated and de-identified.
- Per Google's AI/ML terms, Workspace API data may not be used to develop, improve, or train
  **generalized AI/ML models**.

### 5.2 D20 — the CRM/Gmail data boundary

**Recorded as decision D20 in `docs/ROADMAP.md` §2 under `CRM-113`.**

*Today the boundary is clean.* `app/api/compose/route.ts` builds its `brief` field by field from
hand-typed CRM columns, with an explicit comment saying the row is assembled deliberately "so that
adding a column doesn't silently start leaking into prompts." No Gmail content is in it. That is
why CTL-12 reads **Implemented (by construction)** rather than Planned.

**The moment a Gmail-derived message body enters that brief, Gmail content flows to OpenRouter and
onward to an upstream model provider.** That is a Limited Use transfer question, not a design
preference — and it is precisely the open question blocking the message-store build (*"does the
archive hold message bodies?"*).

Practical consequence for whoever builds the interaction store:

| If the store holds… | Then |
| --- | --- |
| Headers only (`threadId`, subject, timestamps, direction) — the current schema comment's stated intent | Boundary holds. Nothing changes. |
| Bodies we composed ourselves, outbound only | Boundary holds — that text originated with us, not with Gmail. |
| Bodies retrieved from Gmail (inbound replies, thread context) | **Boundary crossed.** Those bodies must not enter the compose brief, must not be transferred to the LLM gateway, and are subject to the human-readability restriction above. Resolve before writing the code, not after. |

---

## 6. Data-subject request runbook

Applies to any request from a person in the contact database. **Log every request** — date
received, identity, what was asked, what was done, date closed — as a line in this section's log
table. There is no ticketing system; this file is the record.

**Response deadlines:**

| Regime | Request type | Deadline |
| --- | --- | --- |
| GDPR / UK GDPR | Access, erasure, objection, rectification | **One month** from receipt (Art 12(3)); extendable by two further months for complex requests, but the extension itself must be communicated within the first month |
| CAN-SPAM | Opt-out | **10 business days** |
| CASL | Unsubscribe | **10 business days** |

**If the requester is not in the database:** confirm that in writing, promptly, and do **not**
create a record for them in order to answer. Searching and finding nothing is a complete answer.
Check by email address, case-insensitively — addresses are normalized to lowercase on write, so a
raw case-sensitive query can produce a false negative.

```bash
sqlite3 prisma/dev.db "SELECT id, name, email FROM Account WHERE lower(email) = lower('<address>');"
```

### 6.1 Access request (GDPR Art 15)

Return everything held about the person, not just the contact row. Notes are in scope, including
opinions recorded about them.

1. Locate the contact by email as above.
2. Export the row and all linked history. Until `CRM-115` lands, this is a manual query set:

```bash
ID=<account id>
sqlite3 -json prisma/dev.db "SELECT * FROM Account WHERE id='$ID';"
sqlite3 -json prisma/dev.db "SELECT * FROM StatusEvent WHERE accountId='$ID' ORDER BY changedAt;"
sqlite3 -json prisma/dev.db "SELECT * FROM Interaction WHERE accountId='$ID' ORDER BY occurredAt;"
```

3. Review `notes` before sending. It is free text and may contain third-party personal data (for
   example, a colleague named in a research note). Redact other people's data; do **not** redact
   the requester's own.
4. Include the source of the data (`sourceType`, `sourceDetail`) — Art 15(1)(g) asks for it, and
   Art 14 already obliged us to volunteer it.
5. `CRM-115` replaces steps 2–4 with `npx tsx prisma/export-contact.ts <email>`.

### 6.2 Erasure request (GDPR Art 17)

1. Locate the contact.
2. Delete via the API or Prisma Studio:

```bash
curl -X DELETE http://localhost:3000/api/accounts/<id>     # localhost only — proxy.ts 403s other hosts
# or: npx prisma studio
```

3. **Verify the cascade rather than assuming it.** `StatusEvent` and `Interaction` both declare
   `onDelete: Cascade` on their `Account` relation, so both should be gone. Confirm:

```bash
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM StatusEvent WHERE accountId='<id>';"   -- expect 0
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Interaction WHERE accountId='<id>';"   -- expect 0
```

4. **Erasure does not reach outside the database.** Check and clear, as applicable: any Gmail draft
   or thread (`draftLink`), the stray copies at F12 if they still exist, and any dev-feedback
   screenshot that captured the contact. Note in the log what was and was not reachable.
5. If the person **also** opted out, see §6.3 first — the two requests conflict and the resolution
   is not obvious.

### 6.3 Objection / opt-out (GDPR Art 21(2), CAN-SPAM, CASL)

1. Record it against **the person**, not the contact row — `POST /api/suppressions` with the
   address, `source` (how it arrived: reply, verbal, form, manual), and `note` (the actual words,
   if it was a reply). The UI control in `account-detail` does this in one action.
2. Confirm the row has left the queue (`GET /api/queue`) and that draft creation now returns `409`.
   If the person appears in more than one campaign, **check all of them** — one suppression covers
   every campaign, and confirming that is the point of the design.
3. **Retain the record. Do not delete it.**

> **This is the one instruction in this runbook most likely to be got wrong.** A suppression list
> only works if the row survives. Deleting an opt-out removes the very evidence that stops the
> next import or the next queue pass from re-adding the person — which is exactly how people get
> re-emailed after asking you to stop, and it converts a handled request into a fresh violation.
> Suppression data is retained *because* of the objection, not in spite of it.

**Where erasure and objection collide:** if someone asks to be both erased and never contacted
again, the standard resolution is to erase everything except a minimal suppression record — the
email address plus the opt-out timestamp — retained specifically to honour the objection. Do not
keep the name, notes, or history. If this case ever actually arises, get it reviewed rather than
improvising from this paragraph.

**`REQ-01` makes this directly implementable.** `Suppression` is its own table with no relation to
`Account`, so deleting the contact leaves the record standing: delete the `Account` (which cascades
`StatusEvent` and `Interaction`) and the suppression survives carrying nothing but the address and
the timestamp — precisely the minimal record described above. Consider clearing `Suppression.note`
too if it quotes them at length; the timestamp does the work, and the note is evidence we no longer
need once the contact row is gone.

**Verify it, do not assume it:** after any erasure of a suppressed contact, confirm the record is
still there.

```bash
sqlite3 prisma/dev.db "SELECT email, DATE(optedOutAt/1000,'unixepoch') FROM Suppression WHERE email = lower('<address>');"
# Expect exactly one row. Zero rows means the objection is no longer honoured.
```

### 6.4 Request log

| Date received | Requester | Type | Jurisdiction | Action taken | Date closed |
| --- | --- | --- | --- | --- | --- |
| *(none to date)* | | | | | |

---

## 7. Known gaps, accepted with triggers

Following the roadmap convention: *later* is a condition, not a mood. Each of these is a real
exposure that we are choosing to carry, not an oversight.

| Gap | Why accepted now | Trigger to fix |
| --- | --- | --- |
| **No per-user authorization; no owner column.** Every `/api` route except NextAuth's is unauthenticated. `DELETE /api/projects/[id]` cascade-deletes a project and every contact under it with no confirmation. | Single-tenant by design (roadmap D18). `proxy.ts` fails closed on any non-localhost hostname, so the exposure cannot go live silently — **but it is a tripwire, not access control, and the file says so itself.** | Any non-localhost deployment (roadmap E1). The `CRM_I_KNOW_THE_API_IS_UNAUTHENTICATED` escape hatch is deliberately worded as a dare; setting it is the moment real auth becomes required. |
| **Google refresh token stored in plaintext.** `GoogleCredential.refreshToken` grants ongoing Gmail access until revoked at `myaccount.google.com/permissions`. It is persisted to `prisma/dev.db` on every sign-in by `lib/auth.ts`, deliberately — a JWT cookie structurally cannot hand a token to code with no browser request behind it. | One machine, one operator, gitignored database. The schema carries the warning inline. | **Phase 0 task 0.d landing** (Internal consent removes the 7-day refresh-token expiry), **or** first non-localhost deployment — whichever is first. Note the direction of travel: 0.d makes the token *longer-lived*, so blast radius rises, and 0.d is in flight now. Expect this trigger to fire during M0 rather than after M1. `REQ-12`. |
| **No retention schedule.** Every record is kept indefinitely. | 34 rows reviewed by one person is defensible; 3,400 would not be. Against GDPR Art 5(1)(e), this is a genuine gap, stated plainly rather than dressed up. | The day contact count exceeds what one person can review by hand (doc 01 §10). |
| **No breach-response plan.** No detection, no notification procedure, no 72-hour clock owner. | Proportionate to one machine with no network exposure. GDPR Art 33's 72-hour notification duty applies regardless of size, so this gap is real. | First non-localhost deployment, **or** any incident. Whichever comes first — and if it is the incident, this row is why it went badly. |
| **Prisma Studio and import scripts bypass every application-layer control.** No `StatusEvent` written, no validation, no suppression check. | Same shape as roadmap **E8**. Unavoidable with direct database access; the mitigation is that only the operator has it. | Before writing any second import script. `CRM-109` closes the one case with legal consequence (suppression), not the general problem. |
| **The opt-out mechanism we advertise is a reply into a mailbox the application cannot see.** The footer (CTL-01) asks people to reply with the word "stop". The Gmail scope is `gmail.compose`, which grants no read access, so detection is entirely manual — and the CAN-SPAM and CASL 10-business-day clocks run from **receipt**, not from the operator noticing. The mailbox in question also mixes this work with everything else. | Proportionate at n=23 with one operator working a short list by hand, and a reply-based mechanism is more honest than a tracked link for genuinely 1:1 outreach (doc 01 N2). But the honest statement is that CTL-04 covers the *recording* half only; nothing covers detection. | First opt-out noticed late, **or** the day the contact-scoped message index is built — whichever is first. Note the index needs a wider Gmail scope than we hold, which is itself a §8 event. |
| **A contact with no email address cannot be suppressed.** `Suppression` is keyed on the normalized address; 11 of 34 rows have none. | Bounded: the same rows also cannot be emailed by this app, since `createDraft` refuses without an address. The exposure becomes real only if an address is added to a previously-suppressed person, at which point the suppression must be re-recorded by hand. | The day a contact who opted out by phone or in person is given an email address. |
| **The footer identity is unvalidated free text, and one value covers every campaign.** `CRM_SENDER_*` is checked for non-blank and nothing else (doc 02 §11), so a mistyped address ships in every message the app sends. And if a second legal entity ever starts sending, every campaign silently carries the first one's identity. | There is no vocabulary to validate against; the meaningful control is the fail-closed guard plus a human reading a real draft (VER-06, §5 pre-send checklist). One entity is the confirmed state today (doc 01 Q1). | Any time the footer changes after a campaign has started sending, **or** a second legal entity starts sending — the latter is a REQ-06 change, tracked at doc 01 §10. |
| **One person owns every control in §4.** No separation of duties, no second reviewer, no continuity if that person is unavailable. | Structural at this size; noting it is the only available mitigation. | The day a second person touches production data. At that point §4 owners must be re-assigned individually rather than in bulk. |
| **Register unreviewed by counsel** except where a row names counsel. | Cost-proportionate at this stage. | Before the first send into any consent-first jurisdiction, and before `OPENROUTER_API_KEY` is set (doc 01 Q4). |

---

## 8. Review cadence

A calendar date alone produces a document that is reviewed on schedule and wrong in between. Both
kinds of trigger apply; whichever fires first governs.

### Calendar

| Cadence | Scope | Owner |
| --- | --- | --- |
| **Quarterly** — next **2026-11-21** | Full register: every §4 state value re-checked against the code, every review date advanced or escalated, §6.4 log reconciled | Operator |
| **Annually** | §2 jurisdiction matrix re-checked against current law; §5 processor terms re-read | Operator, with counsel spot-review |

### Events — re-read this document the same day any of these happen

| Event | What to re-check |
| --- | --- |
| **A contact from a new jurisdiction is added** | §2 — is the regime covered? §4 CTL-11. |
| **A new third-party service touches contact data** | §5 — add the processor row *before* the first call, not after. CTL-13. |
| **First deployment to any non-localhost host** | Nearly everything: CTL-14, and four of the seven accepted gaps in §7 have this as their trigger. Treat as a full re-review, not a spot check. |
| **Any change to the Google OAuth scopes** | §5.1 and CTL-12. Note the trap in `lib/auth.ts`: the refresh exchange does not send `scope`, and a refresh grant returns the **original** consent's scopes — so a widened scope constant keeps minting old-scope tokens silently until the user re-consents. `GoogleCredential.scope` exists so a route can detect this; use it rather than surfacing a 403 as a 502. **CTL-12 must be re-stated at the same time:** it reads "Implemented (by construction)" only because inbound message bodies are not reachable today. A read scope makes them reachable in the same process that assembles the compose brief, and the control becomes an enforced boundary rather than an absence of capability. |
| **`CRM_SENDER_LEGAL_NAME` or `CRM_SENDER_POSTAL_ADDRESS` changes after anything has sent** | CTL-02. The messages already delivered carry the old value; decide whether the change is a correction (and whether anything needs saying to recipients) or a genuine change of sender. Re-run VER-06. |
| **A second legal entity starts sending, or a campaign needs a different postal address** | CTL-02 and REQ-06 both change shape — one env pair can no longer be correct. See doc 01 §10; the fix is the parked Product tier (roadmap D16), not columns on `Project`. |
| **A new project is created** | CTL-11 — its contacts need jurisdictions before it sends. Doc 05 §5's pre-send checklist runs per campaign for exactly this reason. |
| **`OPENROUTER_API_KEY` is set for the first time** | §5 OpenRouter row, CTL-13, roadmap E9, doc 01 Q4. |
| **The interaction/message store is built** | §5.2 D20. Decide the body question before writing code. |
| **First real data-subject request** | §6 — does the runbook survive contact with reality? Update it from what actually happened, then log it at §6.4. |
| **First opt-out received** | CTL-03, CTL-04. Confirm all three enforcement points actually fired. |
| **The repository's visibility or `.gitignore` changes** | CTL-15. |

---

## Change log

| Date | Change | By |
| --- | --- | --- |
| 2026-08-21 | Register opened. All controls at Gap or Planned except CTL-12 (Implemented by construction) and CTL-05/CTL-10/CTL-15 (Partial). Unreviewed by counsel. | Operator |
| 2026-08-22 | Three citation slips corrected (`CRM-116`→`CRM-114` on the stray-copies row, `CRM-114`→`CRM-112` on the OpenRouter row, `CRM-117`→`CRM-113` on D20). No control states changed. | Operator |
| 2026-08-22 | CTL-03/CTL-08 restated: suppression is person-scoped in its own table, so it spans campaigns and survives erasure. CTL-04 narrowed to the recording half, with detection recorded as a §7 gap. CTL-10 and §6.3 updated — the erasure-plus-objection resolution is now implementable rather than aspirational. CTL-14 updated for the `session.error` reader and the Phase 0 trigger. | Operator |
| 2026-08-22 | §2.1 extended to three lists — `MichiKanji — Shodo Schools` (8 rows, 2 emailable) was absent, and it holds both Japanese-reading domains at F8. §3 gains a campaign-sender-identity row. §7 gains three accepted gaps: no inbound detection, contacts with no address cannot be suppressed, and unvalidated footer identity. §8 gains three events. | Operator |
