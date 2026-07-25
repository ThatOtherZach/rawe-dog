import OpenAI from "openai";
import { loadSettings } from "./settings.js";
import { tryParseJsonLoose } from "./parse-kit.js";
import type { JsonSchemaObject } from "./schemas.js";

export type LlmStage = "selection" | "drafting" | "verification";

/**
 * Hard cap per model call so a hung request fails loudly instead of stalling
 * a run forever. XAI_TIMEOUT_MS is a dev/test hook.
 */
const CALL_TIMEOUT_MS =
  Number(process.env["XAI_TIMEOUT_MS"]) > 0
    ? Number(process.env["XAI_TIMEOUT_MS"])
    : 300_000;

export function getXaiClient(): OpenAI {
  const { apiKey } = loadSettings();
  if (!apiKey) {
    throw new Error(
      "No xAI API key configured. Add one on the Settings page or set XAI_API_KEY."
    );
  }
  return new OpenAI({
    apiKey,
    // XAI_BASE_URL is a dev/test hook (e.g. point at a local mock); defaults to the real API.
    baseURL: process.env["XAI_BASE_URL"]?.trim() || "https://api.x.ai/v1",
    timeout: CALL_TIMEOUT_MS,
    // One transient retry; schema/truncation retries are handled above this.
    maxRetries: 1,
  });
}

/** Per-stage model resolution: selection/verification may use a fast model. */
export function getModelForStage(stage: LlmStage): string {
  const s = loadSettings();
  const main = s.model || "grok-4.5";
  if (stage === "selection") return s.selectionModel || main;
  if (stage === "verification") return s.verificationModel || main;
  return main;
}

/** Drafting/premium model (kept for connection tests and display). */
export function getModel(): string {
  return getModelForStage("drafting");
}

export type StructuredCallMeta = {
  model: string;
  /** True if we had to re-call the model (schema fallback or truncation). */
  retried: boolean;
  /** True if the cheap JSON-repair path fixed malformed output. */
  jsonRepaired: boolean;
};

/** Models observed to reject json_schema response_format in this process. */
const schemaUnsupportedModels = new Set<string>();

function isSchemaFormatError(err: unknown): boolean {
  if (!(err instanceof OpenAI.APIError)) return false;
  const status = err.status ?? 0;
  if (status !== 400 && status !== 404 && status !== 422) return false;
  const msg = (err.message || "").toLowerCase();
  return (
    msg.includes("response_format") ||
    msg.includes("json_schema") ||
    msg.includes("schema") ||
    msg.includes("structured") ||
    msg.includes("no body") // model rejected the request with an empty 400 — likely unsupported response_format
  );
}

function wrapApiError(err: unknown, stage: LlmStage, model: string): Error {
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return new Error(
      `xAI ${stage} call (${model}) timed out after ${Math.round(
        CALL_TIMEOUT_MS / 60_000
      )} min. The service may be slow or unreachable — retry the run.`
    );
  }
  if (err instanceof OpenAI.APIError) {
    if (err.status === 401 || err.status === 403) {
      return new Error("xAI rejected the API key. Check it on the Settings page.");
    }
    return new Error(`xAI ${stage} call failed (${model}): ${err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

type RawResult = { content: string; finishReason: string | null };

async function rawStructuredCall(
  client: OpenAI,
  model: string,
  args: {
    system: string;
    user: string;
    schemaName: string;
    schema: JsonSchemaObject;
    temperature: number;
  },
  maxTokens: number,
  useJsonSchema: boolean,
  signal?: AbortSignal
): Promise<RawResult> {
  const response = await client.chat.completions.create(
    {
      model,
      temperature: args.temperature,
      max_tokens: maxTokens,
      response_format: useJsonSchema
        ? {
            type: "json_schema",
            json_schema: {
              name: args.schemaName,
              strict: true,
              schema: args.schema,
            },
          }
        : { type: "json_object" },
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    },
    { signal }
  );
  const choice = response.choices[0];
  return {
    content: choice?.message?.content || "",
    finishReason: choice?.finish_reason ?? null,
  };
}

/**
 * Cheap JSON repair: send ONLY the malformed output + target schema to a
 * (fast, when configured) model — never re-sends the original full prompt.
 */
async function repairMalformedJson(
  client: OpenAI,
  schemaName: string,
  schema: JsonSchemaObject,
  malformed: string,
  maxTokens: number,
  signal?: AbortSignal
): Promise<string> {
  const model = getModelForStage("verification");
  const response = await client.chat.completions.create(
    {
      model,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You repair malformed JSON. Output ONLY the corrected JSON object conforming to the provided JSON schema. Preserve the original content; fix structure only. No commentary.",
        },
        {
          role: "user",
          content: `JSON schema "${schemaName}":\n${JSON.stringify(
            schema
          )}\n\nMalformed output to fix:\n${malformed}`,
        },
      ],
    },
    { signal }
  );
  return response.choices[0]?.message?.content || "";
}

/**
 * Call the model with an API-enforced JSON schema (structured outputs).
 * - Falls back to json_object mode if the model rejects json_schema.
 * - Retries once with a doubled token budget if the output was truncated.
 * - On parse failure, runs the cheap JSON-repair path (malformed output only).
 */
export async function chatStructured<T>(args: {
  stage: LlmStage;
  system: string;
  user: string;
  schemaName: string;
  schema: JsonSchemaObject;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<{ data: T; content: string; meta: StructuredCallMeta }> {
  const client = getXaiClient();
  const model = getModelForStage(args.stage);
  const temperature = args.temperature ?? 0.3;
  let maxTokens = args.maxTokens ?? 8192;
  let useJsonSchema = !schemaUnsupportedModels.has(model);
  let retried = false;
  const signal = args.signal;

  const callArgs = {
    system: args.system,
    user: args.user,
    schemaName: args.schemaName,
    schema: args.schema,
    temperature,
  };

  let result: RawResult;
  try {
    result = await rawStructuredCall(client, model, callArgs, maxTokens, useJsonSchema, signal);
  } catch (err) {
    if (useJsonSchema && isSchemaFormatError(err)) {
      schemaUnsupportedModels.add(model);
      useJsonSchema = false;
      retried = true;
      try {
        result = await rawStructuredCall(client, model, callArgs, maxTokens, false, signal);
      } catch (err2) {
        throw wrapApiError(err2, args.stage, model);
      }
    } else {
      throw wrapApiError(err, args.stage, model);
    }
  }

  // Truncated output → one retry with a doubled budget.
  if (result.finishReason === "length") {
    retried = true;
    maxTokens = Math.min(maxTokens * 2, 16384);
    try {
      result = await rawStructuredCall(client, model, callArgs, maxTokens, useJsonSchema, signal);
    } catch (err) {
      throw wrapApiError(err, args.stage, model);
    }
  }

  const parsed = tryParseJsonLoose<T>(result.content);
  if (parsed.ok) {
    return {
      data: parsed.data,
      content: result.content,
      meta: { model, retried, jsonRepaired: false },
    };
  }

  // Malformed JSON → cheap repair of the output only.
  let fixed = "";
  try {
    fixed = await repairMalformedJson(
      client,
      args.schemaName,
      args.schema,
      result.content,
      maxTokens,
      signal
    );
  } catch {
    // fall through to the error below
  }
  const reparsed = tryParseJsonLoose<T>(fixed);
  if (reparsed.ok) {
    return {
      data: reparsed.data,
      content: fixed,
      meta: { model, retried, jsonRepaired: true },
    };
  }

  throw new Error(
    `Model returned invalid JSON for "${args.schemaName}"${
      result.finishReason === "length" ? " (output truncated)" : ""
    } even after repair. Try again or switch models in Settings.`
  );
}

export async function testConnection(): Promise<{ ok: boolean; model?: string; error?: string }> {
  try {
    const client = getXaiClient();
    const model = getModel();
    // A connectivity probe should answer in seconds, not wait out the
    // long generation timeout.
    await client.chat.completions.create(
      {
        model,
        max_tokens: 5,
        messages: [{ role: "user", content: "ping" }],
      },
      { timeout: 15_000, maxRetries: 0 }
    );
    return { ok: true, model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
