/**
 * File-backed persistence for the credit system — quotes, issued tokens, promo
 * codes, and the sales ledger. Same storage philosophy as the rest of the app
 * (flat JSON under data/, no database, no accounts). All writes go through an
 * in-process mutex + atomic temp-file rename, which is safe for the
 * single-process server this app runs as.
 *
 * Amounts are stored as strings (atomic bigints don't survive JSON).
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID, randomInt } from "node:crypto";
import { getDataRoot } from "../paths.js";
import { manualAmountTail, type CryptoAsset } from "./chain.js";

export interface CreditQuote {
  id: string;
  asset: CryptoAsset;
  /** Atomic amount as a decimal string (wei / USDC base units). */
  amountAtomic: string;
  priceCents: number;
  network: string;
  receivingAddress: string;
  status: "pending" | "paid";
  createdAt: number;
  expiresAt: number;
  txHash?: string;
}

export interface CreditToken {
  id: string;
  source: "crypto" | "code";
  /**
   * Product kind. Only "search" exists now that kits are free. Absent on
   * legacy tokens minted before this field was added — those are not
   * accepted by the search gate (kind-check is strict on the refresh route).
   */
  kind?: "search";
  credits: number;
  remaining: number;
  issuedAt: number;
  lastSpentAt?: number;
  txHash?: string;
  code?: string;
}

export interface PromoCode {
  code: string;
  credits: number;
  maxRedemptions: number;
  redeemedCount: number;
  note?: string;
  createdAt: number;
  expiresAt?: number;
}

export interface SaleRow {
  at: number;
  source: "crypto" | "code";
  isComp: boolean;
  asset?: CryptoAsset;
  txHash?: string;
  payer?: string;
  code?: string;
  credits: number;
  priceUsdCents: number;
  /** CAD accounting (tax-inclusive back-out, BC rates). Null FX = pending. */
  fxRateMicros: number | null;
  fxSource: string | null;
  cadGrossCents: number | null;
  gstCents: number | null;
  pstCents: number | null;
  netCents: number | null;
}

interface CreditsFile {
  quotes: CreditQuote[];
  tokens: CreditToken[];
  codes: PromoCode[];
  sales: SaleRow[];
}

const EMPTY: CreditsFile = { quotes: [], tokens: [], codes: [], sales: [] };

function creditsPath(): string {
  const dir = path.join(getDataRoot(), "credits");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path.join(dir, "credits.json");
}

function load(): CreditsFile {
  const p = creditsPath();
  if (!existsSync(p)) return structuredClone(EMPTY);
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<CreditsFile>;
    return {
      quotes: Array.isArray(raw.quotes) ? raw.quotes : [],
      tokens: Array.isArray(raw.tokens) ? raw.tokens : [],
      codes: Array.isArray(raw.codes) ? raw.codes : [],
      sales: Array.isArray(raw.sales) ? raw.sales : [],
    };
  } catch {
    // Corrupt file: refuse to guess — better to fail closed than silently
    // wipe the ledger. Callers surface this as a 500.
    throw new Error("credits.json is unreadable — refusing to overwrite the ledger");
  }
}

function save(data: CreditsFile): void {
  const p = creditsPath();
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, p);
}

/** Serialize all read-modify-write cycles (single process, async handlers). */
let chain: Promise<unknown> = Promise.resolve();

export function withStore<T>(fn: (data: CreditsFile) => T): Promise<T> {
  const next = chain.then(() => {
    const data = load();
    const result = fn(data);
    save(data);
    return result;
  });
  // Keep the chain alive even after a failure.
  chain = next.catch(() => undefined);
  return next;
}

/** Read-only view (no lock needed beyond the write chain settling). */
export function readStore(): Promise<CreditsFile> {
  const next = chain.then(() => load());
  chain = next.catch(() => undefined);
  return next;
}

/* ------------------------------ quotes ------------------------------ */

/**
 * Allocate a quote with a guaranteed-unique tailed amount. The tail search and
 * the insert happen inside ONE store transaction so two concurrent quotes can
 * never share an amount (the unique amount is what maps a payment to a quote).
 * Returns null if no unique amount could be found (practically impossible).
 */
export function createQuoteWithUniqueAmount(opts: {
  asset: CryptoAsset;
  baseAmount: bigint;
  priceCents: number;
  network: string;
  receivingAddress: string;
  ttlMs: number;
}): Promise<CreditQuote | null> {
  return withStore((data) => {
    pruneExpiredQuotes(data);
    const now = Date.now();
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = (opts.baseAmount + manualAmountTail(opts.asset)).toString();
      const clash = data.quotes.some(
        (q) => q.status === "pending" && q.asset === opts.asset && q.amountAtomic === candidate && q.expiresAt > now,
      );
      if (clash) continue;
      const quote: CreditQuote = {
        id: randomUUID(),
        asset: opts.asset,
        amountAtomic: candidate,
        priceCents: opts.priceCents,
        network: opts.network,
        receivingAddress: opts.receivingAddress,
        status: "pending",
        createdAt: now,
        expiresAt: now + opts.ttlMs,
      };
      data.quotes.push(quote);
      return quote;
    }
    return null;
  });
}

function pruneExpiredQuotes(data: CreditsFile): void {
  const now = Date.now();
  data.quotes = data.quotes.filter((q) => q.status === "paid" || q.expiresAt > now);
  // Paid quotes older than 90 days can go too — the sale row is the record.
  data.quotes = data.quotes.filter((q) => q.status === "pending" || now - q.createdAt < 90 * 24 * 3600 * 1000);
}

export type ClaimResult =
  | { ok: true; token: CreditToken }
  | { ok: false; reason: "unknown_quote" | "already_claimed" | "tx_used" };

/**
 * Claim a verified payment: re-check quote state + tx replay, mark the quote
 * paid, and mint the 1-credit token — all in ONE store transaction, so two
 * concurrent verify calls for the same quote/tx can never both mint.
 * (The on-chain read happens before this, outside the lock; this is the
 * authoritative settle step.)
 */
export function claimQuoteAndIssueToken(
  quoteId: string,
  txHashRaw: string,
  kind: "search" = "search",
): Promise<ClaimResult> {
  const txHash = txHashRaw.toLowerCase();
  return withStore((data): ClaimResult => {
    const quote = data.quotes.find((q) => q.id === quoteId);
    if (!quote) return { ok: false, reason: "unknown_quote" };
    if (quote.status !== "pending") return { ok: false, reason: "already_claimed" };
    if (data.tokens.some((t) => t.txHash?.toLowerCase() === txHash)) return { ok: false, reason: "tx_used" };
    quote.status = "paid";
    quote.txHash = txHash;
    const token: CreditToken = {
      id: randomUUID(),
      source: "crypto",
      kind,
      credits: 1,
      remaining: 1,
      issuedAt: Date.now(),
      txHash,
    };
    data.tokens.push(token);
    return { ok: true, token: { ...token } };
  });
}

/* ------------------------------ tokens ------------------------------ */

export function issueToken(t: Omit<CreditToken, "id" | "remaining" | "issuedAt">): Promise<CreditToken> {
  return withStore((data) => {
    const token: CreditToken = { ...t, id: randomUUID(), remaining: t.credits, issuedAt: Date.now() };
    data.tokens.push(token);
    return token;
  });
}

export function getToken(id: string): Promise<CreditToken | null> {
  return readStore().then((data) => data.tokens.find((t) => t.id === id) ?? null);
}

/** Atomically consume one credit. Returns the updated token or null if empty/unknown. */
export function spendCredit(id: string): Promise<CreditToken | null> {
  return withStore((data) => {
    const token = data.tokens.find((t) => t.id === id);
    if (!token || token.remaining < 1) return null;
    token.remaining -= 1;
    token.lastSpentAt = Date.now();
    return { ...token };
  });
}

export function txHashUsed(txHash: string): Promise<boolean> {
  const needle = txHash.toLowerCase();
  return readStore().then((data) => data.tokens.some((t) => t.txHash?.toLowerCase() === needle));
}

/* ------------------------------ codes ------------------------------ */

/** Unambiguous alphabet (no 0/O, 1/I/L). */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function mintCodes(opts: {
  count: number;
  credits: number;
  maxRedemptions: number;
  note?: string;
  expiresAt?: number;
}): Promise<PromoCode[]> {
  return withStore((data) => {
    const minted: PromoCode[] = [];
    for (let i = 0; i < opts.count; i++) {
      let code = "";
      do {
        let body = "";
        for (let j = 0; j < 10; j++) body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
        code = `RAWE-${body}`;
      } while (data.codes.some((c) => c.code === code));
      const row: PromoCode = {
        code,
        credits: opts.credits,
        maxRedemptions: opts.maxRedemptions,
        redeemedCount: 0,
        note: opts.note,
        createdAt: Date.now(),
        expiresAt: opts.expiresAt,
      };
      data.codes.push(row);
      minted.push(row);
    }
    return minted;
  });
}

export type RedeemResult =
  | { ok: true; code: PromoCode }
  | { ok: false; reason: "unknown" | "exhausted" | "expired" };

/** Validate + count a redemption in one atomic step. */
export function redeemCode(codeRaw: string): Promise<RedeemResult> {
  const code = codeRaw.trim().toUpperCase();
  return withStore((data) => {
    const row = data.codes.find((c) => c.code === code);
    if (!row) return { ok: false, reason: "unknown" } as const;
    if (row.expiresAt && row.expiresAt < Date.now()) return { ok: false, reason: "expired" } as const;
    if (row.redeemedCount >= row.maxRedemptions) return { ok: false, reason: "exhausted" } as const;
    row.redeemedCount += 1;
    return { ok: true, code: { ...row } } as const;
  });
}

/* ------------------------------ sales ------------------------------ */

export function recordSale(row: SaleRow): Promise<void> {
  return withStore((data) => {
    data.sales.push(row);
  });
}
