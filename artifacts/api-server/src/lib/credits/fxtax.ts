/**
 * CAD accounting helpers, ported (condensed) from BreakBPM's fx.ts + tax.ts.
 * Sales are valued in CAD with BC rates backed OUT of the gross
 * (tax-inclusive pricing): gross = net + 5% GST + 7% PST on the net.
 * FX comes from the Bank of Canada Valet API (FXUSDCAD), with an env fallback
 * (RAWEDOG_USD_CAD_FALLBACK_RATE). FX failure is non-fatal — the sale row is
 * recorded with fxRateMicros: null and can be backfilled.
 */

import { logger } from "../logger.js";

const GST_BP = 500; // 5.00% in basis points
const PST_BP = 700; // 7.00%

export interface CadBreakdown {
  fxRateMicros: number | null;
  fxSource: string | null;
  cadGrossCents: number | null;
  gstCents: number | null;
  pstCents: number | null;
  netCents: number | null;
}

const BOC_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1";

async function fetchUsdCadMicros(): Promise<{ micros: number; source: string } | null> {
  try {
    const res = await fetch(BOC_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`BoC responded ${res.status}`);
    const body = (await res.json()) as {
      observations?: Array<{ FXUSDCAD?: { v?: string } }>;
    };
    const v = body.observations?.at(-1)?.FXUSDCAD?.v;
    const rate = v ? Number(v) : NaN;
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("BoC returned no usable rate");
    return { micros: Math.round(rate * 1_000_000), source: "boc" };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "BoC FX fetch failed");
    const fallback = Number(process.env["RAWEDOG_USD_CAD_FALLBACK_RATE"]?.trim());
    if (Number.isFinite(fallback) && fallback > 0) {
      return { micros: Math.round(fallback * 1_000_000), source: "env_fallback" };
    }
    return null;
  }
}

/** Value a USD-cent sale in CAD with BC taxes backed out of the gross. */
export async function cadBreakdownForUsdCents(usdCents: number): Promise<CadBreakdown> {
  const fx = await fetchUsdCadMicros();
  if (!fx) {
    return { fxRateMicros: null, fxSource: null, cadGrossCents: null, gstCents: null, pstCents: null, netCents: null };
  }
  const gross = Math.round((usdCents * fx.micros) / 1_000_000);
  // gross = net * (1 + gst + pst)  →  net = gross / 1.12
  const net = Math.round((gross * 10_000) / (10_000 + GST_BP + PST_BP));
  const gst = Math.round((net * GST_BP) / 10_000);
  const pst = gross - net - gst; // remainder → PST so the row always sums exactly
  return {
    fxRateMicros: fx.micros,
    fxSource: fx.source,
    cadGrossCents: gross,
    gstCents: gst,
    pstCents: pst,
    netCents: net,
  };
}
