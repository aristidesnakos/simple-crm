# RS-01 — Outreach Compliance & Data Protection

**Requirements set for simple-crm.** Opened 2026-08-21. Revised 2026-08-22 after engineering
review. Status: **Draft for engineering review — three material amendments pending Product
sign-off (see the change log below).**

This folder is the handoff package. It exists because the app is about to send email to real
people for the first time, and the compliance surface that has to exist before that happens
does not exist yet.

---

## Read in this order

| # | Document | Author | Primary reader | Answers |
| --- | --- | --- | --- | --- |
| 01 | [PRD — Outreach Compliance](01-PRD-outreach-compliance.md) | Product | Everyone | What are we building, and why is it required rather than nice? |
| 02 | [TRD — Technical Specification](02-TRD-technical-spec.md) | Product + Tech Lead | Engineers | Exactly what changes, in which file, with what contract? |
| 03 | [Delivery Plan](03-DELIVERY-PLAN.md) | Project Management | Engineers, stakeholders | What ships in what order, who owns it, when is it done? |
| 04 | [Compliance Register](04-COMPLIANCE-REGISTER.md) | Product (with legal review) | Auditors, future maintainers | Which obligation does each control satisfy, and where is the evidence? |
| 05 | [QA & Verification Plan](05-QA-VERIFICATION.md) | QA / Tech Lead | Engineers, reviewer | How do we prove each requirement is actually met? |

**Engineers who read only one document should read 02.** It is written to be sufficient on its
own for implementation. Read 01 when a requirement seems arbitrary — the rationale is there and
it is usually a statute.

**One amendment needs Product sign-off before `CRM-101` starts** — `REQ-01`'s re-modelling, marked
**Yes** in the change log below, because it changes the shape of the migration every other branch
rebases onto. It hangs on the new **Q6**. Everything else in the 2026-08-22 revision is a
correction.

---

## Identifier scheme

Every statement in this set is addressable. Do not renumber; retire instead.

| Prefix | Meaning | Lives in | Example |
| --- | --- | --- | --- |
| `REQ-nn` | A product requirement with acceptance criteria | 01 | `REQ-06` compliant footer |
| `EPIC-x` | A grouping of tickets under one outcome | 03 | `EPIC-B` message compliance |
| `CRM-nnn` | An implementable ticket | 03 | `CRM-104` footer builder |
| `CTL-nn` | A compliance control | 04 | `CTL-03` suppression durability |
| `VER-nn` | A verification procedure | 05 | `VER-06` footer present in draft |
| `D-nn` | A recorded decision | `docs/ROADMAP.md` §2 | `D20` Limited Use boundary |
| `F-nn` | A verified finding about the current state | 01 §3 | `F13` a contact is a row, not a person |

A ticket cites its `REQ`. A `REQ` cites its `CTL`. A `CTL` cites its evidence in `VER`. If a
chain is broken, something is unowned.

---

## Relationship to existing documents

This set **does not replace** the roadmap. It sits beside it.

- `docs/ROADMAP.md` — revision 3. Owns product direction, the defect table (E1–E9), and the
  decision log (D1–D19). Requirements here that resolve a known defect say so explicitly.
- `docs/ROADMAP-v2-archive.md` — research from revision 2. Load-bearing for deliverability and
  Gmail scope analysis. Do not redo it.
- `CLAUDE.md` / `AGENTS.md` — codebase conventions. **Non-negotiable prerequisite for engineers.**
  Several apparent bugs in this repo are deliberate and documented there.
- `docs/HANDOFF.md` — session context. Contains at least one stale claim; verify before relying.

The roadmap carries a standing rule: *if the next revision is longer than the last, planning has
outrun delivery.* This set is deliberately scoped to one outcome — a lawful first send — and
should be closed out, not extended.

The 2026-08-22 revision adds one ticket, one table, two columns, and one procedure — corrections
and one re-modelling, no new outcome. If a later revision adds requirements rather than
corrections, that rule has been broken.

---

## Scope boundary

**In scope:** consent evidence, suppression, message-level compliance, data provenance,
jurisdiction handling, third-party processor controls, and the credential-exposure defects
adjacent to them.

**Out of scope, explicitly:** multi-tenancy and per-user authorization (roadmap D18/E1), bulk
send or mail merge (D6), any third-party ESP in the send path (D2), the Gmail message index
(D14), reply-rate analytics (D12), and adopt-vs-build (D17). Nothing in this set is a reason to
reopen those.

---

## Change control

Material changes to a `REQ` after engineering sign-off require a line in the change log below, a
note to the ticket owner, and Product sign-off before the affected ticket starts. Typo, clarity,
and correction changes do not — they are simply logged.

| Date | Doc | Change | Material? | By |
| --- | --- | --- | --- | --- |
| 2026-08-21 | all | Initial draft opened | — | Product |
| 2026-08-21 | 04 | Ticket and evidence citations corrected against doc 03's backlog and doc 05's procedures — the register's `CRM`/`VER` columns had drifted. `REQ`/`CTL` mappings unchanged. | No | Product |
| 2026-08-21 | 05 | Added `VER-17` (source disclosure at first contact). It was referenced but never defined, leaving P0 `REQ-17` with no verification. M0 gate now names its P0 set explicitly. | No | Product |
| 2026-08-22 | 01–05 | **`REQ-01` — suppression becomes a person-scoped `Suppression` table**, keyed on the normalized email, replacing three `Account` columns. `Account` is scoped to a `Project` and cascade-deletes, so a column could neither span campaigns nor survive an erasure — which left doc 04 §6.3's erasure-plus-objection resolution unimplementable. Adds `CRM-121` and `VER-01b`. **New Q6** decides whether opt-outs span campaigns and gates `CRM-101`. | **Yes** | Engineering, pending Product |
| 2026-08-22 | 01, 03, 05 | `REQ-10b` — scope corrected to "every contact with an email address" (23 today), from "17 collaborator rows". There are 25 collaborator rows across two projects, and the two Japanese-reading domains at `F8` are in `MichiKanji — Shodo Schools`, which the set did not mention — so the old scope excluded the sharpest case the requirement exists for. A factual correction about the data, not a change of intent. | No | Engineering |
| 2026-08-22 | 01–05 | `REQ-06` **considered and left as-is.** A per-campaign footer identity (`Project.senderLegalName` / `senderPostalAddress`) was proposed and rejected: the footer names a *legal entity*, which sits above a campaign — `Mangood — Waitlist` and `Mangood — Partners` share one sender, so a column on `Project` would store the same value twice with nowhere single to change it. The tier that would own it correctly is the Product tier, which roadmap **D16** parks. Q1 is sharpened to confirm there is one entity; doc 01 §10 carries the trigger for the day there are two. | No | Engineering |
| 2026-08-22 | 01, 02, 03, 05 | Added `REQ-06c` (RFC 2047 subject encoding). `buildRawMessage` writes `Subject:` as raw UTF-8 and the composer seeds every subject with an em dash, so every draft corrupts its own subject line. Folded into `CRM-104` — same function — or `VER-06` discovers it at the M0 gate looking like a footer defect. | No | Engineering |
| 2026-08-22 | 02, 04, 05 | `CRM-111` corrected: strip `accessToken` and nothing else. Doc 02 §8 also proposed stripping `session.error`; `top-bar.tsx:34-36` now reads it for the expired-session button, so the spec as written would revert a shipped fix while `VER-11` still passed. | No | Engineering |
| 2026-08-22 | 01, 03, 04 | `REQ-12`'s trigger re-stated as **Phase 0 task 0.d, or first non-localhost deployment**. `GoogleCredential` landed after this set was drafted and persists a plaintext refresh token; 0.d removes its expiry and is in flight, so expect the trigger during M0. | No | Engineering |
| 2026-08-22 | 03, 04 | Recorded three accepted gaps: the footer advertises a reply-based opt-out into a mailbox `gmail.compose` cannot read (`CTL-04` covers recording, not detection); contacts with no address cannot be suppressed; footer identity is unvalidated free text. Added risk **R9** (Q6 answered late) and **R10** (`NOT IN` against `NULL` drops every contact with no email from the queue). | No | Engineering |
| 2026-08-22 | 04, 05 | Citation and gate fixes: `CRM-116`→`CRM-114`, `CRM-114`→`CRM-112`, `CRM-117`→`CRM-113`; `VER-11` and `VER-16` move from the M2 gate to M1, matching their tickets; §7's P0 list gains `VER-17`. | No | Engineering |
| 2026-08-22 | 01 | Count corrections: 23 emailable contacts (not 22); 34 pre-existing rows across three projects (not 26). Added findings `F13`–`F16`. | No | Engineering |
