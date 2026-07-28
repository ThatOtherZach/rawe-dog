/**
 * Free-kit quota with a privacy-preserving fingerprint.
 *
 * Design (data minimization by construction):
 *  - Fingerprint = HMAC-SHA256(window pepper, normalized identifiers).
 *    Identifiers: profile name/phone/city (extracted from the Master Profile
 *    text) + truncated client IP (/24 for IPv4, /48 for IPv6).
 *  - The pepper is derived from SESSION_SECRET + the current window bucket,
 *    so fingerprints from different windows are cryptographically unlinkable:
 *    once the window rolls over, stored hashes are permanently anonymous.
 *  - Store holds only { hash → { count, ts } } and prunes entries older than
 *    2× the window. No raw IP, name, phone, or city is ever written to disk.
 *
 * Gate is opt-in via FREE_DAILY_KIT_ENFORCED=true (hosted deployments);
 * self-hosted/dev installs are unaffected by default.
 */

import crypto from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { getDataRoot } from "./paths.js";
import { logger } from "./logger.js";
import { hasSessionAi, operatorKey } from "./ai-context.js";

export const FREE_KIT_LIMIT = 1;

/* ------------------------------- config -------------------------------- */

/**
 * Master kill switch for the free tier. Default ON — anything other than an
 * explicit "false" keeps free runs enabled. When off, kit generation on the
 * operator's key is refused entirely (BYOK/custom endpoints unaffected).
 */
export function freeTierEnabled(): boolean {
  return process.env["FREE_TIER_ENABLED"]?.trim().toLowerCase() !== "false";
}

export function freeKitEnforced(): boolean {
  return process.env["FREE_DAILY_KIT_ENFORCED"]?.trim().toLowerCase() === "true";
}

let warnedBadWindow = false;

/** Quota + pepper-rotation window in hours. Default 24; bad values fall back. */
export function freeKitWindowHours(): number {
  const raw = process.env["FREE_KIT_WINDOW_HOURS"]?.trim();
  if (!raw) return 24;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 24 * 365) {
    if (!warnedBadWindow) {
      warnedBadWindow = true;
      logger.warn(
        { value: raw },
        "FREE_KIT_WINDOW_HOURS is set but is not a valid hour count — falling back to 24"
      );
    }
    return 24;
  }
  return n;
}

function windowMs(): number {
  return freeKitWindowHours() * 3_600_000;
}

/** Current window bucket index (UTC-based, epoch-aligned). */
function windowBucket(now = Date.now()): number {
  return Math.floor(now / windowMs());
}

/** Milliseconds until the current window rolls over (fingerprints unlink). */
export function freeKitResetMs(now = Date.now()): number {
  return (windowBucket(now) + 1) * windowMs() - now;
}

/* ---------------------------- fingerprint ------------------------------ */

function secret(): string {
  // Same secret the credit-token HMAC uses; fall back to a fixed string in
  // dev so the module never throws when the gate is off anyway.
  return process.env["SESSION_SECRET"]?.trim() || "rawe-dog-dev-pepper";
}

/** Window-scoped pepper: HMAC(secret, bucket). Rotates with the window. */
function windowPepper(now = Date.now()): Buffer {
  return crypto
    .createHmac("sha256", secret())
    .update(`rawe-dog-free-kit:${windowBucket(now)}`)
    .digest();
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Truncate IP: /24 (IPv4) or /48 (IPv6) so NAT/household jitter can't dodge. */
export function truncateIp(ip: string): string {
  const clean = ip.replace(/^::ffff:/i, "").trim();
  if (clean.includes(".")) return clean.split(".").slice(0, 3).join(".");
  if (clean.includes(":")) return clean.split(":").slice(0, 3).join(":");
  return clean;
}

export type ProfileIdentifiers = { name: string; phone: string; city: string };

/**
 * Extract coarse identifiers from Master Profile text. Best-effort — any
 * missing field is simply omitted from the hash input.
 */
export function extractProfileIdentifiers(masterText: string): ProfileIdentifiers {
  const lines = masterText.split("\n").map((l) => l.trim()).filter(Boolean);
  // Name: first non-empty line, minus markdown heading markers.
  const name = (lines[0] || "").replace(/^#+\s*/, "");
  // Phone: first phone-looking run of digits.
  const phoneMatch = masterText.match(/\+?\d[\d\s().-]{7,}\d/);
  const phone = phoneMatch ? phoneMatch[0].replace(/\D/g, "") : "";
  // City: an explicit "City:" / "Location:" line if present.
  const cityMatch = masterText.match(/^\s*(?:city|location)\s*[:\-]\s*(.+)$/im);
  const city = cityMatch ? cityMatch[1] : "";
  return { name, phone, city };
}

/**
 * One-way, window-scoped fingerprint. Same inputs within the same window →
 * same hash; different window → unlinkable.
 */
export function computeFingerprint(masterText: string, clientIp: string): string {
  const ids = extractProfileIdentifiers(masterText);
  const material = [
    norm(ids.name),
    ids.phone, // already digits-only
    norm(ids.city),
    truncateIp(clientIp),
  ].join("|");
  return crypto.createHmac("sha256", windowPepper()).update(material).digest("hex");
}

/**
 * Client IP from a request behind exactly one trusted reverse proxy
 * (Replit's). The proxy APPENDS the true peer IP as the LAST entry of
 * x-forwarded-for, so earlier entries are client-controlled and must be
 * ignored — taking the first entry would let callers forge a fresh
 * fingerprint per request and bypass the quota.
 */
export function requestClientIp(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null };
}): string {
  const xf = req.headers["x-forwarded-for"];
  const flat = Array.isArray(xf) ? xf.join(",") : xf;
  const parts = (flat || "").split(",").map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  return (last || req.socket?.remoteAddress || "").trim();
}

/**
 * True when the CURRENT REQUEST would run on the operator's API key (free
 * tier): no session key/endpoint headers were supplied, and the operator
 * fallback exists. BYOK (X-AI-Key) or a custom endpoint (X-AI-Endpoint —
 * their own compute) bypasses the free-tier gates entirely.
 */
export function isOperatorKeyRun(): boolean {
  if (hasSessionAi()) return false; // session brought its own key/compute
  return Boolean(operatorKey()); // no operator key configured → nothing to protect
}

/* ------------------------------- store --------------------------------- */

type QuotaEntry = { count: number; ts: number };
type QuotaFile = Record<string, QuotaEntry>;

function storePath(): string {
  return path.join(getDataRoot(), "free-quota.json");
}

function loadStore(): QuotaFile {
  try {
    if (!existsSync(storePath())) return {};
    const raw = JSON.parse(readFileSync(storePath(), "utf8")) as QuotaFile;
    // Prune anything older than 2× the window — those hashes are from dead
    // peppers and can never match again.
    const horizon = Date.now() - 2 * windowMs();
    const out: QuotaFile = {};
    for (const [hash, entry] of Object.entries(raw)) {
      if (entry && typeof entry.ts === "number" && entry.ts >= horizon) {
        out[hash] = entry;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveStore(store: QuotaFile): void {
  writeFileSync(storePath(), JSON.stringify(store), "utf8");
}

/* -------------------------------- API ---------------------------------- */

export type FreeKitStatus = {
  enforced: boolean;
  used: number;
  limit: number;
  remaining: number;
  windowHours: number;
  resetsInMs: number;
};

export function freeKitStatus(fingerprint: string): FreeKitStatus {
  const enforced = freeKitEnforced();
  const used = enforced ? loadStore()[fingerprint]?.count ?? 0 : 0;
  return {
    enforced,
    used,
    limit: FREE_KIT_LIMIT,
    remaining: Math.max(0, FREE_KIT_LIMIT - used),
    windowHours: freeKitWindowHours(),
    resetsInMs: freeKitResetMs(),
  };
}

/**
 * Atomically reserve one free kit (check + increment in a single synchronous
 * step, so concurrent requests cannot both pass a stale check). Returns false
 * when the quota is exhausted. Callers MUST releaseFreeKit() if the run fails.
 */
export function reserveFreeKit(fingerprint: string): boolean {
  const store = loadStore();
  const prev = store[fingerprint];
  if ((prev?.count ?? 0) >= FREE_KIT_LIMIT) return false;
  store[fingerprint] = { count: (prev?.count ?? 0) + 1, ts: Date.now() };
  saveStore(store);
  return true;
}

/** Return a reservation after a failed/aborted run — failed runs are free. */
export function releaseFreeKit(fingerprint: string): void {
  const store = loadStore();
  const prev = store[fingerprint];
  if (!prev) return;
  const count = prev.count - 1;
  if (count <= 0) delete store[fingerprint];
  else store[fingerprint] = { count, ts: prev.ts };
  saveStore(store);
}
