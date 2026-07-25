/**
 * Client side of the credit system. The bearer token (an HMAC-signed opaque
 * string minted by the server) lives in localStorage — no accounts, no
 * cookies. Every generate call carries it as X-Credit-Token when present.
 */

const TOKEN_KEY = "rawe.credit.token";
const QUOTE_KEY = "rawe.credit.quote";

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
