/**
 * Bearer credit tokens — the "no accounts" identity layer. A token is an
 * HMAC-signed reference to a ledger row in data/credits/credits.json:
 *
 *     rdc1.<base64url payload>.<base64url hmac-sha256>
 *
 * The payload carries only { id, iat }; balances live in the ledger, so a
 * copied token can't mint value — the ledger row is the source of truth and
 * spending is atomic there. HMAC (SESSION_SECRET) stops forged/guessed ids.
 * The client keeps its token in localStorage and sends it as X-Credit-Token.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getToken, type CreditToken } from "./store.js";

const PREFIX = "rdc1";

function secret(): string {
  const s = process.env["SESSION_SECRET"]?.trim();
  if (!s) throw new Error("SESSION_SECRET is required for credit tokens");
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", secret()).update(payload).digest());
}

export function encodeToken(id: string): string {
  const payload = b64url(Buffer.from(JSON.stringify({ id, iat: Date.now() }), "utf8"));
  return `${PREFIX}.${payload}.${sign(payload)}`;
}

export type TokenCheck =
  | { ok: true; token: CreditToken }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "unknown" | "empty" | "wrong_kind" };

/**
 * Verify signature + resolve the ledger row. Does NOT spend.
 *
 * Pass `requiredKind: "search"` to enforce that the token is a search credit.
 * Tokens with no kind field (legacy kit tokens) fail the kind check.
 */
export async function checkToken(
  raw: string | undefined,
  requiredKind?: "search",
): Promise<TokenCheck> {
  if (!raw || !raw.trim()) return { ok: false, reason: "missing" };
  const parts = raw.trim().split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: "malformed" };
  const [, payload, mac] = parts;
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };
  let id = "";
  try {
    id = String((JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { id?: unknown }).id ?? "");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!id) return { ok: false, reason: "malformed" };
  const token = await getToken(id);
  if (!token) return { ok: false, reason: "unknown" };
  if (token.remaining < 1) return { ok: false, reason: "empty" };
  if (requiredKind && token.kind !== requiredKind) return { ok: false, reason: "wrong_kind" };
  return { ok: true, token };
}

/** Is the credit gate armed? Off by default so dev/self-hosted use stays free. */
export function creditsEnforced(): boolean {
  return process.env["RAWEDOG_CREDITS_ENFORCED"]?.trim().toLowerCase() === "true";
}

/*
 * In-flight reservations — one credit can only fund one CONSUMING run at a
 * time. Validation happens at run start but spending happens on success, so
 * without this, N parallel runs on a 1-credit token would all deliver kits.
 * In-memory is correct here: the server is single-process (like the JSON
 * store), and a restart kills the runs the reservations belonged to.
 */
const inflight = new Map<string, number>();

/** Reserve a credit for a consuming run. False = balance already committed. */
export function reserveCredit(tokenId: string, remaining: number): boolean {
  const current = inflight.get(tokenId) ?? 0;
  if (remaining - current < 1) return false;
  inflight.set(tokenId, current + 1);
  return true;
}

export function releaseCredit(tokenId: string): void {
  const current = inflight.get(tokenId) ?? 0;
  if (current <= 1) inflight.delete(tokenId);
  else inflight.set(tokenId, current - 1);
}
