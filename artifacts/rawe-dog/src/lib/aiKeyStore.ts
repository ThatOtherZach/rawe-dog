/**
 * Per-session AI credentials — stored ONLY in this browser (localStorage),
 * sent to the server as request headers, never persisted server-side.
 */

const KEY = "rawe.ai.key";
const ENDPOINT = "rawe.ai.endpoint";

export function getAiKey(): string {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function getAiEndpoint(): string {
  try {
    return localStorage.getItem(ENDPOINT) || "";
  } catch {
    return "";
  }
}

export function setAiKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(KEY, key.trim());
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode — session-only */
  }
}

export function setAiEndpoint(endpoint: string): void {
  try {
    if (endpoint.trim()) localStorage.setItem(ENDPOINT, endpoint.trim());
    else localStorage.removeItem(ENDPOINT);
  } catch {
    /* private mode — session-only */
  }
}

export function clearAiKey(): void {
  setAiKey("");
}

export function hasAiKey(): boolean {
  return Boolean(getAiKey());
}

/** Mask for display — never render the full key. */
export function maskAiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

/**
 * Headers to attach to any API call that may hit the LLM (generate, test,
 * library compose) or that reports key-dependent state (settings, health,
 * postings). Empty object when nothing is configured locally.
 */
export function aiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = getAiKey();
  const endpoint = getAiEndpoint();
  if (key) headers["X-AI-Key"] = key;
  if (endpoint) headers["X-AI-Endpoint"] = endpoint;
  return headers;
}
