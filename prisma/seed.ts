import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.project.count();
  if (existing > 0) {
    console.log("Database already has data — skipping seed.");
    return;
  }

  const project = await prisma.project.create({
    data: {
      name: "Example: Michi Manga Pilot",
      description: "N5 pilot outreach for graded manga readers via michikanji.com",
      status: "Active",
      approach:
        "Short personal note referencing their JLPT level plus a link to a sample page",
    },
  });

  await prisma.account.createMany({
    data: [
      {
        projectId: project.id,
        name: "Jamie Lee",
        email: "jamie@example.com",
        status: "Prospect",
        labels: "warm, referral",
        lastContact: new Date("2026-08-01"),
        nextAction: "Send intro email",
        notes: "Found via r/LearnJapanese, N5 level",
      },
      {
        projectId: project.id,
        name: "Alex Chen",
        email: "alex@example.com",
        status: "Contacted",
        labels: "cold outreach",
        lastContact: new Date("2026-07-28"),
        nextAction: "Follow up in 3 days",
        notes: "Replied once, asked about pricing",
      },
    ],
  });

  console.log("Seeded 1 project and 2 accounts. Delete these once you add real data.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
