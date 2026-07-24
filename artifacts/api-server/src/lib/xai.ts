import OpenAI from "openai";
import { loadSettings } from "./settings.js";
import { tryParseJsonLoose } from "./parse-kit.js";

export function getXaiClient(): OpenAI {
  const { apiKey } = loadSettings();
  if (!apiKey) {
    throw new Error(
      "No xAI API key configured. Add one on the Settings page or set XAI_API_KEY."
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1",
  });
}

export function getModel(): string {
  return loadSettings().model || "grok-4.5";
}

export async function chatJson(args: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ content: string; usage?: OpenAI.Completions.CompletionUsage }> {
  const client = getXaiClient();
  const model = getModel();

  const response = await client.chat.completions.create({
    model,
    temperature: args.temperature ?? 0.3,
    max_tokens: args.maxTokens ?? 8192,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  });

  const content = response.choices[0]?.message?.content || "";
  return { content, usage: response.usage };
}

/**
 * Call model and parse JSON; on parse failure, one repair retry.
 */
export async function chatJsonParsed<T>(args: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ data: T; content: string; retried: boolean }> {
  const first = await chatJson(args);
  const parsed = tryParseJsonLoose<T>(first.content);
  if (parsed.ok) {
    return { data: parsed.data, content: first.content, retried: false };
  }

  // One repair attempt
  const repair = await chatJson({
    system: args.system,
    user: `${args.user}\n\nYour previous response was not valid JSON. Return ONLY valid JSON, no commentary.`,
    maxTokens: args.maxTokens,
    temperature: 0.1,
  });
  const reparsed = tryParseJsonLoose<T>(repair.content);
  if (reparsed.ok) {
    return { data: reparsed.data, content: repair.content, retried: true };
  }

  throw new Error(
    `Model returned invalid JSON after retry. Last response: ${repair.content.slice(0, 200)}`
  );
}

export async function testConnection(): Promise<{ ok: boolean; model?: string; error?: string }> {
  try {
    const client = getXaiClient();
    const model = getModel();
    await client.chat.completions.create({
      model,
      max_tokens: 5,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true, model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
