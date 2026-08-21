import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Dev-only capture endpoint for components/dev/dev-feedback.tsx — writes to
// .claude/dev-feedback.json so an AI assistant can read and act on it later (see
// .claude/skills/feedback/SKILL.md). Hard-gated below so this can never run — and
// never write to a production filesystem — if it somehow shipped. proxy.ts also
// 403s it off localhost, but that is a tripwire; this gate is the real one.
const ENABLED = process.env.NODE_ENV !== "production";

const REPO_ROOT = process.cwd();
const CLAUDE_DIR = path.join(REPO_ROOT, ".claude");
const SCREENSHOT_DIR = path.join(CLAUDE_DIR, "dev-feedback");
const ENTRIES_FILE = path.join(CLAUDE_DIR, "dev-feedback.json");

type DevFeedbackEntry = {
  comment: string;
  id: string;
  resolved: boolean;
  screenshotFile?: string;
  timestamp: string;
  viewName: string;
};

async function loadEntries(): Promise<DevFeedbackEntry[]> {
  try {
    const raw = await readFile(ENTRIES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveEntries(entries: DevFeedbackEntry[]) {
  const tmpFile = `${ENTRIES_FILE}.tmp`;
  await writeFile(tmpFile, JSON.stringify(entries, null, 2) + "\n", "utf8");
  await rename(tmpFile, ENTRIES_FILE);
}

// The dev server is a single Node process, but two feedback submissions in quick
// succession (e.g. a fast double-save) would otherwise both read the file before
// either writes, and the second write clobbers the first entry. Chain each request
// onto the previous one so appends are strictly ordered.
let writeQueue: Promise<unknown> = Promise.resolve();

function appendEntry(entry: DevFeedbackEntry): Promise<void> {
  const task = writeQueue.then(async () => {
    const entries = await loadEntries();
    entries.push(entry);
    await saveEntries(entries);
  });
  // Swallow so one failed append doesn't wedge the queue for later requests.
  writeQueue = task.catch(() => {});
  return task;
}

export async function POST(request: Request) {
  if (!ENABLED) {
    return NextResponse.json({ error: "disabled_in_production" }, { status: 404 });
  }

  let body: { name?: unknown; comment?: unknown; screenshot?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const viewName = typeof body.name === "string" ? body.name.trim() : "";
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  const screenshotDataUrl =
    typeof body.screenshot === "string" ? body.screenshot : undefined;

  if (!viewName || !comment) {
    return NextResponse.json({ error: "missing_name_or_comment" }, { status: 400 });
  }

  await mkdir(SCREENSHOT_DIR, { recursive: true });

  let screenshotFile: string | undefined;
  const match = screenshotDataUrl?.match(/^data:image\/png;base64,(.+)$/);
  if (match) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `shot-${stamp}-${randomUUID().slice(0, 8)}.png`;
    const tmpPath = path.join(SCREENSHOT_DIR, `${filename}.tmp`);
    const finalPath = path.join(SCREENSHOT_DIR, filename);
    await writeFile(tmpPath, Buffer.from(match[1], "base64"));
    await rename(tmpPath, finalPath);
    screenshotFile = `.claude/dev-feedback/${filename}`;
  }

  await appendEntry({
    comment,
    id: randomUUID(),
    resolved: false,
    ...(screenshotFile ? { screenshotFile } : {}),
    timestamp: new Date().toISOString(),
    viewName,
  });

  return NextResponse.json({ ok: true });
}
