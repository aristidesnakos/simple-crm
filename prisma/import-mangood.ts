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
    return null;
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

  let imported = 0;
  const skipped: string[] = [];

  for (const c of project.contacts) {
    const email = normalizeEmail(c.email);

    // Suppression check, per contact, BEFORE the insert. This script bypasses the API
    // entirely (docs/ROADMAP.md E8), so none of the application-layer controls apply here
    // — which is exactly why the one control with legal consequence has to be repeated.
    //
    // A sheet is a snapshot. Re-importing one that still lists somebody who has opted out
    // since it was exported is the normal way a suppressed person gets resurrected, and
    // the row would come back looking clean.
    //
    // Keyed on the address, so this holds even when the opt-out was recorded while working
    // a different campaign — or when the contact row it was recorded against has since
    // been deleted. Suppression outlives both.
    if (email) {
      const suppressed = await prisma.suppression.findUnique({
        where: { email },
        select: { optedOutAt: true },
      });
      if (suppressed) {
        // Loud and per-address, deliberately not a silent filter: a skipped row is
        // information the operator needs, because it means the sheet is stale.
        console.log(
          `· skipping ${email} — opted out ${suppressed.optedOutAt
            .toISOString()
            .slice(0, 10)}`
        );
        skipped.push(email);
        continue;
      }
    }

    await prisma.account.create({
      data: {
        projectId: created.id,
        name: c.name,
        email,
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
    imported += 1;
  }

  console.log(`✓ ${project.name} — ${imported} contacts`);
  return { imported, skipped };
}

async function main() {
  const data = readData();
  let imported = 0;
  const skipped: string[] = [];

  for (const project of data.projects) {
    const result = await importProject(project);
    if (result) {
      imported += result.imported;
      skipped.push(...result.skipped);
    }
  }

  // Printed even when zero, so "nothing was skipped" is a statement rather than an
  // absence. A skip that scrolls past unread is a skip that did not happen, as far as
  // the operator's understanding goes.
  console.log(`\n${imported} imported, ${skipped.length} skipped as opted out.`);
  if (skipped.length) {
    console.log(
      "These addresses are on the suppression list and were NOT re-added:\n" +
        skipped.map((e) => `  ${e}`).join("\n") +
        "\nThe source sheet is stale. Remove them from it before the next export."
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
