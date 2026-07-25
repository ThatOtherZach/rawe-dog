/**
 * Credit checkout + redemption — the toasteth pattern with the generate
 * pipeline standing in for the toaster relay. No accounts anywhere:
 *
 *   quote  → we hand out our receiving address + a unique exact amount
 *   (user pays on Base from any wallet, no connect, no signature)
 *   verify → we read the tx on-chain; exact-amount match claims the quote and
 *            issues a signed bearer token (localStorage on the client)
 *   redeem → promo codes mint the same tokens (owner mints via admin key)
 *
 * The generate route consumes 1 credit per SUCCESSFUL kit run.
 */

import { Router, type Request, type Response } from "express";
import {
  getNetworkConfig,
  getReceivingAddress,
  getCreditPriceCents,
  getQuoteTtlMs,
  readEthUsd,
  usdcAtomicAmount,
  ethWeiAmount,
  verifyPayment,
  formatAtomic,
  type CryptoAsset,
} from "../lib/credits/chain.js";
import {
  createQuoteWithUniqueAmount,
  claimQuoteAndIssueToken,
  issueToken,
  txHashUsed,
  mintCodes,
  redeemCode,
  readStore,
  recordSale,
} from "../lib/credits/store.js";
import { encodeToken, checkToken, creditsEnforced } from "../lib/credits/tokens.js";
import { cadBreakdownForUsdCents } from "../lib/credits/fxtax.js";
import { logger } from "../lib/logger.js";

const router = Router();
const log = logger.child({ route: "credits" });

function parseAsset(raw: unknown): CryptoAsset | null {
  return raw === "eth" || raw === "usdc" ? raw : null;
}

/** Public status — also resolves the caller's token when one is presented. */
router.get("/credits/status", async (req: Request, res: Response) => {
  try {
    const enforced = creditsEnforced();
    const address = getReceivingAddress();
    const cfg = getNetworkConfig();
    const tokenHeader = req.header("x-credit-token") ?? undefined;
    let token: { valid: boolean; remaining: number; reason?: string } | null = null;
    if (tokenHeader) {
      const check = await checkToken(tokenHeader);
      token = check.ok
        ? { valid: true, remaining: check.token.remaining }
        : { valid: false, remaining: 0, reason: check.reason };
    }
    res.json({
      ok: true,
      enforced,
      priceUsdCents: getCreditPriceCents(),
      crypto: address
        ? { available: true, network: cfg.network, receivingAddress: address }
        : { available: false },
      token,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/** Create a payment quote: unique exact amount → our address. */
router.post("/credits/quote", async (req: Request, res: Response) => {
  try {
    const asset = parseAsset((req.body as { asset?: unknown })?.asset);
    if (!asset) {
      res.status(400).json({ ok: false, error: 'asset must be "eth" or "usdc"' });
      return;
    }
    const address = getReceivingAddress();
    if (!address) {
      res.status(503).json({ ok: false, error: "Crypto checkout isn't open — no receiving address is configured." });
      return;
    }
    const cfg = getNetworkConfig();
    const priceCents = getCreditPriceCents();

    const base =
      asset === "usdc"
        ? usdcAtomicAmount(priceCents, cfg.usdcDecimals)
        : ethWeiAmount(priceCents, await readEthUsd());

    // Tail search + insert are one atomic store op — amounts stay unique
    // even under concurrent quote requests.
    const quote = await createQuoteWithUniqueAmount({
      asset,
      baseAmount: base,
      priceCents,
      network: cfg.network,
      receivingAddress: address,
      ttlMs: getQuoteTtlMs(),
    });
    if (!quote) {
      res.status(503).json({ ok: false, error: "Could not allocate a unique payment amount — try again." });
      return;
    }
    log.info({ evt: "quote", asset, quoteId: quote.id }, "credit quote issued");
    res.json({
      ok: true,
      quoteId: quote.id,
      asset,
      network: cfg.network,
      receivingAddress: address,
      amountAtomic: quote.amountAtomic,
      amountDisplay: formatAtomic(BigInt(quote.amountAtomic), asset),
      priceUsdCents: priceCents,
      expiresAt: quote.expiresAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ evt: "quote_error", error: message }, "credit quote failed");
    res.status(502).json({ ok: false, error: message });
  }
});

/** Claim a quote with a tx hash → bearer token on success. */
router.post("/credits/verify", async (req: Request, res: Response) => {
  try {
    const body = req.body as { quoteId?: string; txHash?: string };
    const quoteId = String(body.quoteId ?? "").trim();
    const txHash = String(body.txHash ?? "").trim().toLowerCase();
    if (!quoteId || !/^0x[0-9a-f]{64}$/.test(txHash)) {
      res.status(400).json({ ok: false, error: "quoteId and a valid txHash are required." });
      return;
    }

    const store = await readStore();
    const quote = store.quotes.find((q) => q.id === quoteId);
    if (!quote) {
      res.status(404).json({ ok: false, error: "Unknown or expired quote — request a new one." });
      return;
    }
    if (quote.status === "paid") {
      res.status(409).json({ ok: false, error: "This quote was already claimed." });
      return;
    }
    if (await txHashUsed(txHash)) {
      res.status(409).json({ ok: false, error: "That transaction was already used for a credit." });
      return;
    }

    const cfg = getNetworkConfig();
    const outcome = await verifyPayment({
      txHash,
      asset: quote.asset,
      receivingAddress: quote.receivingAddress as `0x${string}`,
      tokenAddress: quote.asset === "usdc" ? cfg.usdcAddress : null,
      expectedAmount: BigInt(quote.amountAtomic),
    });

    if (outcome.status === "pending") {
      res.json({ ok: true, status: "pending", confirmations: outcome.confirmations, needed: outcome.needed });
      return;
    }
    if (outcome.status === "not_found") {
      res.status(404).json({
        ok: false,
        error: "Transaction not found on-chain yet — wait for it to be mined, then try again.",
      });
      return;
    }
    if (outcome.status !== "granted") {
      res.status(422).json({ ok: false, error: outcome.reason });
      return;
    }

    // Granted on-chain: settle atomically (re-checks quote state + tx replay
    // inside one store transaction, so concurrent verifies can't double-mint).
    const claim = await claimQuoteAndIssueToken(quote.id, txHash);
    if (!claim.ok) {
      const message =
        claim.reason === "tx_used"
          ? "That transaction was already used for a credit."
          : "This quote was already claimed.";
      res.status(409).json({ ok: false, error: message });
      return;
    }
    const record = claim.token;
    const cad = await cadBreakdownForUsdCents(quote.priceCents);
    await recordSale({
      at: Date.now(),
      source: "crypto",
      isComp: false,
      asset: quote.asset,
      txHash,
      payer: outcome.payer,
      credits: 1,
      priceUsdCents: quote.priceCents,
      ...cad,
    });
    log.info({ evt: "granted", quoteId, txHash }, "credit purchased");
    res.json({ ok: true, status: "granted", token: encodeToken(record.id), credits: record.remaining });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ evt: "verify_error", error: message }, "credit verify failed");
    res.status(502).json({ ok: false, error: message });
  }
});

/** Redeem a promo code → bearer token. */
router.post("/credits/redeem", async (req: Request, res: Response) => {
  try {
    const code = String((req.body as { code?: string })?.code ?? "").trim();
    if (!code) {
      res.status(400).json({ ok: false, error: "code is required." });
      return;
    }
    const result = await redeemCode(code);
    if (!result.ok) {
      const message =
        result.reason === "unknown"
          ? "That code doesn't exist."
          : result.reason === "expired"
            ? "That code has expired."
            : "That code has no redemptions left.";
      res.status(422).json({ ok: false, error: message });
      return;
    }
    const record = await issueToken({ source: "code", credits: result.code.credits, code: result.code.code });
    await recordSale({
      at: Date.now(),
      source: "code",
      isComp: true,
      code: result.code.code,
      credits: result.code.credits,
      priceUsdCents: 0,
      fxRateMicros: null,
      fxSource: null,
      cadGrossCents: null,
      gstCents: null,
      pstCents: null,
      netCents: null,
    });
    log.info({ evt: "redeemed", code: result.code.code }, "promo code redeemed");
    res.json({ ok: true, token: encodeToken(record.id), credits: record.remaining });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/* ------------------------------ admin ------------------------------ */

function requireAdmin(req: Request, res: Response): boolean {
  const configured = process.env["RAWEDOG_ADMIN_KEY"]?.trim();
  if (!configured) {
    res.status(503).json({ ok: false, error: "RAWEDOG_ADMIN_KEY is not configured." });
    return false;
  }
  if ((req.header("x-admin-key") ?? "") !== configured) {
    res.status(403).json({ ok: false, error: "Bad admin key." });
    return false;
  }
  return true;
}

/** Mint promo codes: { count?, credits?, maxRedemptions?, note? } */
router.post("/credits/admin/mint", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const body = req.body as { count?: number; credits?: number; maxRedemptions?: number; note?: string };
    const count = Math.min(Math.max(Math.floor(body.count ?? 1), 1), 100);
    const credits = Math.min(Math.max(Math.floor(body.credits ?? 1), 1), 1000);
    const maxRedemptions = Math.min(Math.max(Math.floor(body.maxRedemptions ?? 1), 1), 10_000);
    const minted = await mintCodes({ count, credits, maxRedemptions, note: body.note?.trim() || undefined });
    log.info({ evt: "minted", count, credits, maxRedemptions }, "promo codes minted");
    res.json({ ok: true, codes: minted.map((c) => ({ code: c.code, credits: c.credits, maxRedemptions: c.maxRedemptions })) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/** Sales + token overview for accounting. */
router.get("/credits/admin/ledger", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const store = await readStore();
  res.json({
    ok: true,
    sales: store.sales,
    tokens: store.tokens.map((t) => ({ ...t })),
    codes: store.codes,
    pendingQuotes: store.quotes.filter((q) => q.status === "pending").length,
  });
});

export default router;
