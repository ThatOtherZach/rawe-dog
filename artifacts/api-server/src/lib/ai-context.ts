/**
 * Request-scoped AI credentials.
 *
 * The AI API key is per user/session: it lives in the visitor's browser and
 * travels on each request as headers — it is NEVER persisted server-side.
 *   - X-AI-Key:      the session's own API key (BYOK)
 *   - X-AI-Endpoint: optional OpenAI-compatible base URL (their own compute)
 *
 * AsyncLocalStorage carries the values through the whole request (including
 * SSE pipelines) without threading parameters through every function. When
 * no session credentials are supplied, calls fall back to the operator's
 * env XAI_API_KEY — that fallback is exactly what the free-tier gates protect.
 */

import { AsyncLocalStorage } from "async_hooks";
import type { Request, Response, NextFunction } from "express";

export type SessionAi = { apiKey: string; apiEndpoint: string };

const als = new AsyncLocalStorage<SessionAi>();

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function headerValue(req: Request, name: string): string {
  const raw = req.headers[name];
  const flat = Array.isArray(raw) ? raw[0] : raw;
  return (flat || "").trim();
}

/** Express middleware: capture session AI headers for the rest of the request. */
export function aiContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = headerValue(req, "x-ai-key");
  const endpoint = headerValue(req, "x-ai-endpoint");
  if (endpoint && !isValidHttpUrl(endpoint)) {
    res.status(400).json({ error: "X-AI-Endpoint must be a valid http or https URL." });
    return;
  }
  als.run({ apiKey, apiEndpoint: endpoint }, next);
}

/** Session credentials for the current request ("" when not supplied). */
export function getSessionAi(): SessionAi {
  return als.getStore() ?? { apiKey: "", apiEndpoint: "" };
}

/** True when the current request supplied its own key or endpoint (BYOK). */
export function hasSessionAi(): boolean {
  const s = getSessionAi();
  return Boolean(s.apiKey || s.apiEndpoint);
}

/** Operator fallback key from the environment ("" when not configured). */
export function operatorKey(): string {
  return process.env["XAI_API_KEY"]?.trim() || "";
}

/**
 * Effective API key for the current request: session key, else operator env
 * key. SECURITY: when a session supplied a custom endpoint WITHOUT its own
 * key, there is no fallback — pairing the operator's key with an arbitrary
 * user-supplied endpoint would exfiltrate the operator key (and bypass the
 * free-tier gates while still spending the operator's account).
 */
export function resolveAiKey(): string {
  const s = getSessionAi();
  if (s.apiKey) return s.apiKey;
  if (s.apiEndpoint) return ""; // custom endpoint requires the session's own key
  return operatorKey();
}

/**
 * Effective base URL: session endpoint (BYOM, highest priority), then the
 * XAI_BASE_URL env hook (dev/test mock harness), then the xAI default.
 */
export function resolveAiEndpoint(): string {
  return (
    getSessionAi().apiEndpoint ||
    process.env["XAI_BASE_URL"]?.trim() ||
    "https://api.x.ai/v1"
  );
}

/** True when ANY key is available for this request (session or operator). */
export function aiKeyAvailable(): boolean {
  return Boolean(resolveAiKey());
}
