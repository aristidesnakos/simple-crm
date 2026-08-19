import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hasLlmCredentials, llmClient, llmModel } from "@/lib/llm";

// POST /api/compose — drafts an email for one contact.
//
// This route writes nothing. It returns a subject and body for the composer, where a
// human edits them and then creates the Gmail draft, which a human still sends. The
// "human sends, app drafts" principle is unchanged; the model replaces the static
// approach template, not the reviewer (docs/ROADMAP.md task 1.14).
//
// The model earns its place here and almost nowhere else in this app: turning a brand's
// freeform research notes into one specific opening line is not something a template
// can do, while "who is overdue" is an ORDER BY.

export const dynamic = "force-dynamic";

// Validated on the way out of the model, not enforced on the way in. OpenRouter's
// portable structured-output mode is `json_object` — valid JSON, but no schema — so
// whether the shape is right is this parse's job. Strict `json_schema` would enforce it
// server-side but only on some models, which would defeat the point of the gateway.
const DraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  rationale: z.string().optional(),
});

const SYSTEM = `You draft short, plain-text outreach emails for a solo founder.

Rules:
- Plain text. No markdown, no HTML, no bullet lists, no em-dashes as separators.
- Under 120 words. Shorter is better.
- One specific detail from the contact's notes must appear in the first two sentences.
  A generic opener wastes the research that was gathered.
- One ask, at the end, phrased so that "no" is easy.
- No "I hope this email finds you well", no "I wanted to reach out", no "circling back",
  no "synergy", no "excited to connect".
- Sign off with the sender's first name alone. Do not invent a title or company footer.
- Never invent facts about the recipient. Everything specific must come from the notes.
  If the notes are thin, write a shorter email rather than a padded one.
- The recipient may not remember signing up. If a signup date is given, say when and
  where plainly, in the first sentence.
- Never state or imply that this message was written by AI.

Reply with a JSON object and nothing else, shaped exactly:
{"subject": string, "body": string, "rationale": string}
where rationale is one sentence naming the detail from the notes the opening is built on.`;

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

export async function POST(request: NextRequest) {
  if (!hasLlmCredentials()) {
    return NextResponse.json(
      {
        error:
          "OPENROUTER_API_KEY isn't set. Add it to .env to draft with an LLM; the composer still works by hand.",
      },
      { status: 501 }
    );
  }

  let body: { accountId?: string; instruction?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  if (!body.accountId) {
    return NextResponse.json(
      { error: "accountId is required" },
      { status: 400 }
    );
  }

  const account = await prisma.account.findUnique({
    where: { id: body.accountId },
    include: { project: true },
  });
  if (!account) {
    return NextResponse.json({ error: "No such contact." }, { status: 404 });
  }

  const age = daysSince(account.createdAt);
  const sinceContact = daysSince(account.lastContact);

  // Everything the model is allowed to use. Assembled explicitly rather than dumping
  // the row so that adding a column doesn't silently start leaking into prompts.
  const brief = [
    `Campaign: ${account.project.name}`,
    account.project.description && `Campaign purpose: ${account.project.description}`,
    account.project.approach && `How to write for this campaign:\n${account.project.approach}`,
    "",
    `Contact: ${account.name}`,
    `Pipeline: ${account.kind}`,
    `Current stage: ${account.status}`,
    account.labels && `Labels: ${account.labels}`,
    account.notesLink && `Website: ${account.notesLink}`,
    age !== null && `On the list for: ${age} days`,
    sinceContact !== null
      ? `Last contacted: ${sinceContact} days ago`
      : "Never contacted before — this is the first message.",
    account.nextAction && `Planned next action: ${account.nextAction}`,
    "",
    account.notes ? `Research notes:\n${account.notes}` : "No research notes on file.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const completion = await llmClient().chat.completions.create({
      model: llmModel(),
      max_tokens: 2000,
      // Low but not zero: outreach copy that reads identically for every brand defeats
      // the purpose, and the specificity constraints live in the system prompt anyway.
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            brief,
            "",
            body.instruction
              ? `Additional instruction for this draft: ${body.instruction}`
              : "Draft the next email to this contact.",
          ].join("\n"),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return NextResponse.json(
        { error: `${llmModel()} returned an empty response. Try again.` },
        { status: 502 }
      );
    }

    // Two ways this fails and both are the model's fault rather than the user's, so
    // they get one message: not JSON at all, or JSON of the wrong shape.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        {
          error: `${llmModel()} didn't return valid JSON. Try again, or switch OPENROUTER_MODEL.`,
        },
        { status: 502 }
      );
    }

    const draft = DraftSchema.safeParse(parsed);
    if (!draft.success) {
      return NextResponse.json(
        {
          error: `${llmModel()} returned an unusable draft. Try again, or switch OPENROUTER_MODEL.`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(draft.data);
  } catch (err) {
    // Typed most-specific-first; the message is what reaches the toast, so it has to
    // say which of these went wrong rather than "something failed".
    if (err instanceof OpenAI.AuthenticationError) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY was rejected." },
        { status: 502 }
      );
    }
    if (err instanceof OpenAI.RateLimitError) {
      return NextResponse.json(
        { error: "Rate limited by OpenRouter. Try again shortly." },
        { status: 429 }
      );
    }
    if (err instanceof OpenAI.APIError) {
      console.error("OpenRouter draft failed", err);
      return NextResponse.json(
        { error: `OpenRouter error (${err.status}) on ${llmModel()}.` },
        { status: 502 }
      );
    }
    console.error("OpenRouter draft failed", err);
    return NextResponse.json(
      { error: "Couldn't draft that email." },
      { status: 500 }
    );
  }
}
