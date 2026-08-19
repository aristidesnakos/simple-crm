import OpenAI from "openai";

// OpenRouter, reached through the OpenAI-compatible SDK — the same arrangement as
// ~/Documents/llanai (lib/gpt-server.ts). The point is model portability: one gateway,
// one key, and the model is a string we can change without touching provider code.

// Change this, or set OPENROUTER_MODEL, to switch models. Any OpenRouter slug works.
// Defaulted to llanai's house model so both projects behave the same by default;
// drafting quality is the thing to re-tune here if the emails read flat.
export const DEFAULT_MODEL = "google/gemini-3-flash-preview";

export function llmModel(): string {
  return process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
}

export function hasLlmCredentials(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

// Server-only. The key must never reach a client bundle, and unlike llanai this app
// has no browser-side LLM path at all — every call goes through a route handler.
export function llmClient(): OpenAI {
  if (typeof window !== "undefined") {
    throw new Error("The OpenRouter client is server-only.");
  }
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    // OpenRouter attributes usage by these; they show up on the dashboard and are
    // what separates this app's spend from llanai's.
    defaultHeaders: {
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "simple-crm",
    },
  });
}
