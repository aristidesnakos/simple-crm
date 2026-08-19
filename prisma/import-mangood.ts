// Imports contacts from a local, untracked data file. Run with:
//
//   npx tsx prisma/import-mangood.ts
//
// The data lives in `prisma/contacts.local.json`, which is gitignored, because this
// repository is public and the real file holds waitlist members' email addresses plus
// candid notes about named people. Keep it that way: the loader is the shareable half,
// the contacts are not.
//
// Guarded per project name, like prisma/seed.ts — re-running is a no-op for any project
// that already exists, so it can't duplicate rows or overwrite edits made in the app.
//
// Expected shape (see prisma/contacts.local.example.json):
//
//   { "projects": [ { "name", "description", "approach", "kind",
//                     "contacts": [ { "name", "email", "status", "labels", "notesLink",
//                                     "nextAction", "nextActionDue", "createdAt",
//                                     "notes" } ] } ] }
//
// `createdAt` is honoured rather than defaulted so that imported contacts carry their
// real age — a waitlist signup that has been waiting 124 days must not look new, since
// /api/queue orders the no-due-date bucket by exactly that.

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { normalizeEmail } from "../lib/contacts";

const prisma = new PrismaClient();

const DATA_FILE = path.join(__dirname, "contacts.local.json");

// Validated rather than trusted: this file is hand-editable, and a typo'd field name
// would otherwise import silently as null across every row.
const ContactSchema = z.object({
  name: z.string().min(1),
  email: z.string().nullable().optional(),
  status: z.string().min(1),
  labels: z.string().nullable().optional(),
  notesLink: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  nextActionDue: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const DataSchema = z.object({
  projects: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().nullable().optional(),
        approach: z.string().nullable().optional(),
        kind: z.string().min(1),
        contacts: z.array(ContactSchema),
      })
    )
    .min(1),
});

type Data = z.infer<typeof DataSchema>;

function readData(): Data {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(
      [
        `No data file at ${DATA_FILE}.`,
        "",
        "This file is gitignored on purpose — it holds real contact details and never",
        "belongs in a public repository. Copy prisma/contacts.local.example.json to",
        "prisma/contacts.local.json and fill it in, then re-run.",
      ].join("\n")
    );
    process.exit(1);
  }

  const parsed = DataSchema.safeParse(
    JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
  );
  if (!parsed.success) {
    console.error(`${DATA_FILE} doesn't match the expected shape:`);
    console.error(z.prettifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}

async function importProject(project: Data["projects"][number]) {
  const existing = await prisma.project.findFirst({
    where: { name: project.name },
  });
  if (existing) {
    console.log(`· ${project.name} — already exists, skipping`);
    return;
  }

  const created = await prisma.project.create({
    data: {
      name: project.name,
      description: project.description ?? null,
      status: "Active",
      approach: project.approach ?? null,
      // Left null on purpose. Setting it before the Workspace alias is verified would
      // make every draft fail at Gmail rather than fall back. Set it in the UI once
      // Phase 0 lands (docs/ROADMAP.md 0.b).
      fromEmail: null,
    },
  });

  for (const c of project.contacts) {
    await prisma.account.create({
      data: {
        projectId: created.id,
        name: c.name,
        email: normalizeEmail(c.email),
        kind: project.kind,
        status: c.status,
        labels: c.labels ?? null,
        notes: c.notes ?? null,
        notesLink: c.notesLink ?? null,
        nextAction: c.nextAction ?? null,
        nextActionDue: c.nextActionDue ? new Date(c.nextActionDue) : null,
        ...(c.createdAt ? { createdAt: new Date(c.createdAt) } : {}),
      },
    });
  }

  console.log(`✓ ${project.name} — ${project.contacts.length} contacts`);
}

async function main() {
  const data = readData();
  for (const project of data.projects) {
    await importProject(project);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
