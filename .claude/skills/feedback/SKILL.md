---
name: feedback
description: Read open dev feedback from .claude/dev-feedback.json, fix each item in code, mark entries resolved. Use when the user says "address my feedback", "check the feedback log", or after a local testing session.
argument-hint: [optional filter, e.g. a section name]
---

# Address Dev Feedback

Close the human-test → AI-fix loop. Running `npm run dev`, the user right-clicks any
section wrapped in `<DevFeedback name="...">` and types a note; a screenshot of that
exact element is captured automatically. Notes land in `.claude/dev-feedback.json`.
This skill turns them into code changes.

## Process

### 1. Read the log

Read `.claude/dev-feedback.json` at the repo root. Each entry:

```json
{
  "comment": "Status dot is too small to see at a glance",
  "id": "…",
  "resolved": false,
  "screenshotFile": ".claude/dev-feedback/shot-…png",
  "timestamp": "2026-08-21T14:32:00.000Z",
  "viewName": "Crm.AccountList"
}
```

When `screenshotFile` is present, **Read the image** — it's a capture of that exact
element at the moment of feedback (not the whole page). Use it to see precisely what
the comment refers to before editing code, then delete the screenshot file after
resolving its entry.

Only act on entries with `"resolved": false`. If the file is missing or has no open
entries, tell the user there's no open feedback and remind them the feature only runs
under `npm run dev` — it's a no-op in production builds.

If an argument was passed, only address entries whose `viewName` or `comment` matches it.

### 2. Locate each section

`viewName` values are the `name` prop passed to `<DevFeedback>` at its call site:

```bash
grep -rn 'DevFeedback name="<viewName>"' app/ components/
```

Names mirror the component hierarchy, and the current ones map straight to files:

| viewName             | file                                  |
| -------------------- | ------------------------------------- |
| `Crm.TopBar`         | `components/crm/top-bar.tsx`          |
| `Crm.ProjectSidebar` | `components/crm/project-sidebar.tsx`  |
| `Crm.AccountList`    | `components/crm/account-list.tsx`     |
| `Crm.AccountDetail`  | `components/crm/account-detail.tsx`   |
| `Queue.List`         | `components/crm/queue-view.tsx`       |

Feedback about layout *between* panes (widths, ordering, the resizable split) belongs
in `components/crm/crm-app.tsx` even when it arrives under a pane's name.

### 3. Fix, grouped by file

Group open entries by file so each file is edited once. Interpret comments as design
intent, not literal instructions. Check `CLAUDE.md` before changing anything with a
documented reason behind it — several things that look like bugs (hand-maintained
sidebar counts, the Gmail `draftLink` using the nested message id, dead dark mode) are
deliberate. If a comment is ambiguous or implies a large behavioral change, note it for
the user instead of guessing.

### 4. Mark entries resolved

Edit `.claude/dev-feedback.json` directly: set `"resolved": true` on each entry you
addressed. Leave entries you skipped as unresolved and say why.

### 5. Summarize

Report per entry: the comment, the file(s) changed, what was done. List skipped entries
with reasons.

## Adding feedback capture to more sections

Wrap any component with `<DevFeedback name="...">` — see `components/dev/dev-feedback.tsx`.
It renders children with zero wrapper and zero JS outside development, so it's always
safe to leave in place. Right-click is left alone over inputs and textareas, so
right-click-to-paste keeps working inside the account form.
