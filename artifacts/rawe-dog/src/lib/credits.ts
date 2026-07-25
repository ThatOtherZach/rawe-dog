/**
 * Client side of the credit system. The bearer token (an HMAC-signed opaque
 * string minted by the server) lives in localStorage — no accounts, no
 * cookies.
 *
 * Two product lanes, two localStorage keys:
 *   - "rawe.credit.token" / "rawe.credit.quote" — legacy kit-credit key
 *     (now unused for kit generation since kits are free; kept for backwards
 *     compatibility with any outstanding tokens).
 *   - "rawe.search.token" / "rawe.search.quote" — search credit (sent as
 *     X-Credit-Token on POST /api/postings/refresh).
 */

const TOKEN_KEY = "rawe.credit.token";
const QUOTE_KEY = "rawe.credit.quote";

/* ── Search credit helpers (separate localStorage keys) ─────────────────── */

const SEARCH_TOKEN_KEY = "rawe.search.token";
const SEARCH_QUOTE_KEY = "rawe.search.quote";

export function getSearchCreditToken(): string | null {
  try {
    return localStorage.getItem(SEARCH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSearchCreditToken(token: string): void {
  try {
    localStorage.setItem(SEARCH_TOKEN_KEY, token);
  } catch {
    /* private mode */
  }
}

export function clearSearchCreditToken(): void {
  try {
    localStorage.removeItem(SEARCH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Header fragment for postings-refresh calls. */
export function searchCreditHeader(): Record<string, string> {
  const token = getSearchCreditToken();
  return token ? { "X-Credit-Token": token } : {};
}

export function getSavedSearchQuote(): CreditQuote | null {
  try {
    const raw = localStorage.getItem(SEARCH_QUOTE_KEY);
    if (!raw) return null;
    const quote = JSON.parse(raw) as CreditQuote;
    if (!quote.quoteId || quote.expiresAt < Date.now()) {
      localStorage.removeItem(SEARCH_QUOTE_KEY);
      return null;
    }
    return quote;
  } catch {
    return null;
  }
}

export function saveSearchQuote(quote: CreditQuote): void {
  try {
    localStorage.setItem(SEARCH_QUOTE_KEY, JSON.stringify(quote));
  } catch {
    /* ignore */
  }
}

export function clearSavedSearchQuote(): void {
  try {
    localStorage.removeItem(SEARCH_QUOTE_KEY);
  } catch {
    /* ignore */
  }
}

export async function requestSearchQuote(asset: "eth" | "usdc"): Promise<CreditQuote> {
  const res = await fetch("/api/credits/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `Quote failed (${res.status})`);
  const quote = data as CreditQuote;
  saveSearchQuote(quote);
  return quote;
}

export async function verifySearchPayment(quoteId: string, txHash: string): Promise<VerifyResult> {
  const res = await fetch("/api/credits/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteId, txHash }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `Verification failed (${res.status})`);
  if (data.status === "granted") {
    setSearchCreditToken(data.token);
    clearSavedSearchQuote();
    return { status: "granted", token: data.token, credits: data.credits };
  }
  return { status: "pending", confirmations: data.confirmations ?? 0, needed: data.needed ?? 2 };
}

export async function redeemSearchCode(code: string): Promise<{ token: string; credits: number }> {
  const res = await fetch("/api/credits/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `Redeem failed (${res.status})`);
  setSearchCreditToken(data.token);
  return { token: data.token, credits: data.credits };
}

export async function fetchSearchCreditStatus(): Promise<CreditStatus> {
  const res = await fetch("/api/credits/status", { headers: { ...searchCreditHeader() } });
  return (await res.json()) as CreditStatus;
}

export function getCreditToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setCreditToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode — token lives for the session via memory fallback below */
  }
}

export function clearCreditToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Header fragment for generate calls. */
export function creditHeader(): Record<string, string> {
  const token = getCreditToken();
  return token ? { "X-Credit-Token": token } : {};
}

export type CreditStatus = {
  ok: boolean;
  enforced: boolean;
  /** True when a TheirStack API key is configured server-side. */
  providerConfigured?: boolean;
  priceUsdCents: number;
  crypto: { available: boolean; network?: string; receivingAddress?: string };
  token: { valid: boolean; remaining: number; reason?: string } | null;
};

export async function fetchCreditStatus(): Promise<CreditStatus> {
  const res = await fetch("/api/credits/status", { headers: { ...creditHeader() } });
  return (await res.json()) as CreditStatus;
}

export type CreditQuote = {
  quoteId: string;
  asset: "eth" | "usdc";
  network: string;
  receivingAddress: string;
  amountAtomic: string;
  amountDisplay: string;
  priceUsdCents: number;
  expiresAt: number;
};

/** A pending quote survives page reloads so a sent payment is never stranded. */
export function getSavedQuote(): CreditQuote | null {
  try {
    const raw = localStorage.getItem(QUOTE_KEY);
    if (!raw) return null;
    const quote = JSON.parse(raw) as CreditQuote;
    if (!quote.quoteId || quote.expiresAt < Date.now()) {
      localStorage.removeItem(QUOTE_KEY);
      return null;
    }
    return quote;
  } catch {
    return null;
  }
}

export function saveQuote(quote: CreditQuote): void {
  try {
    localStorage.setItem(QUOTE_KEY, JSON.stringify(quote));
  } catch {
    /* ignore */
  }
}

export function clearSavedQuote(): void {
  try {
    localStorage.removeItem(QUOTE_KEY);
  } catch {
    /* ignore */
  }
}

export async function requestQuote(asset: "eth" | "usdc"): Promise<CreditQuote> {
  const res = await fetch("/api/credits/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `Quote failed (${res.status})`);
  const quote = data as CreditQuote;
  saveQuote(quote);
  return quote;
}

export type VerifyResult =
  | { status: "granted"; token: string; credits: number }
  | { status: "pending"; confirmations: number; needed: number };

export async function verifyPayment(quoteId: string, txHash: string): Promise<VerifyResult> {
  const res = await fetch("/api/credits/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteId, txHash }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `Verification failed (${res.status})`);
  if (data.status === "granted") {
    setCreditToken(data.token);
    clearSavedQuote();
    return { status: "granted", token: data.token, credits: data.credits };
  }
  return { status: "pending", confirmations: data.confirmations ?? 0, needed: data.needed ?? 2 };
}

export async function redeemCode(code: string): Promise<{ token: string; credits: number }> {
  const res = await fetch("/api/credits/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `Redeem failed (${res.status})`);
  setCreditToken(data.token);
  return { token: data.token, credits: data.credits };
}
