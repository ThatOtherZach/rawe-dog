import { useEffect, useState } from "react";
import {
  fetchCreditStatus,
  requestQuote,
  verifyPayment,
  redeemCode,
  getSavedQuote,
  clearSavedQuote,
  type CreditStatus,
  type CreditQuote,
} from "../lib/credits";

/**
 * The pay-per-run panel — only rendered when the server has the credit gate
 * armed (RAWEDOG_CREDITS_ENFORCED). No accounts: buy a credit by sending the
 * exact quoted amount on Base and pasting the tx hash, or redeem a code. The
 * resulting bearer token lives in localStorage.
 */
export function CreditsPanel({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<CreditStatus | null>(null);
  const [quote, setQuote] = useState<CreditQuote | null>(() => getSavedQuote());
  const [quoting, setQuoting] = useState<"eth" | "usdc" | null>(null);
  const [txHash, setTxHash] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"addr" | "amt" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCreditStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        /* status is advisory — the server still enforces */
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!status?.enforced) return null;

  const hasCredit = Boolean(status.token?.valid);
  const remaining = status.token?.remaining ?? 0;
  const priceUsd = (status.priceUsdCents / 100).toFixed(2);

  async function startQuote(asset: "eth" | "usdc") {
    setError(null);
    setPendingNote(null);
    setQuoting(asset);
    try {
      setQuote(await requestQuote(asset));
      setTxHash("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuoting(null);
    }
  }

  async function submitVerify() {
    if (!quote) return;
    setError(null);
    setPendingNote(null);
    setVerifying(true);
    try {
      const result = await verifyPayment(quote.quoteId, txHash.trim());
      if (result.status === "granted") {
        setQuote(null);
        setTxHash("");
        onChanged();
      } else {
        setPendingNote(
          `Payment seen — ${result.confirmations}/${result.needed} confirmations. Wait a few seconds and verify again.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }

  async function submitRedeem() {
    setError(null);
    setRedeeming(true);
    try {
      await redeemCode(code);
      setCode("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRedeeming(false);
    }
  }

  async function copy(text: string, which: "addr" | "amt") {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[#0c0e13] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Generation credits</span>
        <span className={`badge ${hasCredit ? "badge-ok" : "badge-bad"}`}>
          {hasCredit ? `${remaining} ready` : "none"}
        </span>
        <span className="ml-auto text-xs text-[var(--muted)]">
          ${priceUsd} per kit · consumed only when a kit completes
        </span>
      </div>

      {!hasCredit && (
        <div className="mt-3 flex flex-wrap gap-4">
          {/* Buy with crypto */}
          <div className="min-w-[16rem] flex-1">
            <p className="label">Buy with crypto (Base)</p>
            {status.crypto.available ? (
              <>
                {!quote ? (
                  <div className="flex gap-2">
                    <button
                      className="btn"
                      disabled={quoting !== null}
                      onClick={() => void startQuote("usdc")}
                    >
                      {quoting === "usdc" ? "Quoting…" : "Pay USDC"}
                    </button>
                    <button
                      className="btn"
                      disabled={quoting !== null}
                      onClick={() => void startQuote("eth")}
                    >
                      {quoting === "eth" ? "Quoting…" : "Pay ETH"}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start gap-3">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(quote.receivingAddress)}&bgcolor=0c0e13&color=ffffff&margin=6`}
                      alt="Receiving address QR"
                      width={110}
                      height={110}
                      className="rounded border border-[var(--border)]"
                    />
                    <div className="min-w-[14rem] flex-1 space-y-2 text-sm">
                      <p className="text-xs text-[var(--muted)]">
                        Send <strong className="text-[var(--text)]">exactly</strong>{" "}
                        this amount on{" "}
                        <span className="text-[var(--accent)]">{quote.network}</span>{" "}
                        — the exact amount is how your payment finds this quote.
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="break-all rounded bg-[#12151c] px-2 py-1 text-xs">
                          {quote.amountDisplay}
                        </code>
                        <button
                          className="btn shrink-0"
                          onClick={() => void copy(quote.amountAtomic, "amt")}
                          title="Copy the atomic amount (wei / USDC units)"
                        >
                          {copied === "amt" ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="break-all rounded bg-[#12151c] px-2 py-1 text-xs">
                          {quote.receivingAddress}
                        </code>
                        <button
                          className="btn shrink-0"
                          onClick={() => void copy(quote.receivingAddress, "addr")}
                        >
                          {copied === "addr" ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          className="input flex-1"
                          placeholder="Paste your tx hash (0x…)"
                          value={txHash}
                          onChange={(e) => setTxHash(e.target.value)}
                        />
                        <button
                          className="btn btn-primary shrink-0"
                          disabled={verifying || !/^0x[0-9a-fA-F]{64}$/.test(txHash.trim())}
                          onClick={() => void submitVerify()}
                        >
                          {verifying ? "Checking…" : "Verify"}
                        </button>
                      </div>
                      <button
                        className="text-xs text-[var(--muted)] underline"
                        onClick={() => {
                          clearSavedQuote();
                          setQuote(null);
                          setPendingNote(null);
                        }}
                      >
                        Cancel this quote
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-[var(--muted)]">
                Crypto checkout isn't open on this server yet.
              </p>
            )}
          </div>

          {/* Redeem a code */}
          <div className="min-w-[14rem] flex-1">
            <p className="label">Redeem a code</p>
            <div className="flex items-center gap-2">
              <input
                className="input flex-1"
                placeholder="RAWE-XXXXXXXXXX"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                className="btn shrink-0"
                disabled={redeeming || code.trim().length < 6}
                onClick={() => void submitRedeem()}
              >
                {redeeming ? "Redeeming…" : "Redeem"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingNote && (
        <div className="mt-3 rounded-lg border border-[#7a5c2e] bg-[#2a2214] px-3 py-2 text-xs text-[#ffd28f]">
          {pendingNote}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[#2a1414] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </div>
      )}
    </div>
  );
}
