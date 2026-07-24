import OpenAI from "openai";
import { loadSettings } from "./settings";
import { tryParseJsonLoose } from "./parse-kit";

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

  const repair = await chatJson({
    system: args.system,
    user: `Your previous response was not valid JSON (${parsed.error}).

Return ONLY a valid JSON object matching the required schema. No markdown fences, no commentary.

Previous output:
${first.content.slice(0, 6000)}`,
    maxTokens: args.maxTokens,
    temperature: 0.1,
  });

  const parsed2 = tryParseJsonLoose<T>(repair.content);
  if (!parsed2.ok) {
    throw new Error(
      `Model returned unparseable JSON after retry: ${parsed2.error}`
    );
  }
  return { data: parsed2.data, content: repair.content, retried: true };
}

export async function testConnection(): Promise<{
  ok: boolean;
  model: string;
  message: string;
}> {
  try {
    const client = getXaiClient();
    const model = getModel();
    const response = await client.chat.completions.create({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
    });
    const text = response.choices[0]?.message?.content?.trim() || "";
    return {
      ok: true,
      model,
      message: `Connected. Model responded: ${text.slice(0, 80)}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, model: getModel(), message };
  }
}
