/**
 * On-chain layer for the credit checkout — a stripped port of BreakBPM's
 * cryptoChain.ts (same owner). Manual pay-to-address flow ONLY:
 *   - No wallet connect, no payer signatures, no accounts. The buyer sends the
 *     EXACT quoted amount to our receiving address from any wallet, then pastes
 *     the tx hash. A tiny random "amount tail" makes every pending quote's
 *     amount unique, so one on-chain payment maps to exactly one quote.
 *   - Amounts are ATOMIC bigints (wei for ETH, 6-dec base units for USDC),
 *     serialized as strings at the API/storage boundary.
 *   - Runs on Base mainnet or Base Sepolia via RAWEDOG_CRYPTO_NETWORK.
 */

import { createPublicClient, http, getAddress, parseAbiItem, decodeEventLog, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { randomInt } from "node:crypto";

export type CryptoNetwork = "base" | "base-sepolia";
export type CryptoAsset = "eth" | "usdc";

export interface NetworkConfig {
  network: CryptoNetwork;
  chainId: number;
  usdcAddress: `0x${string}`;
  usdcDecimals: number;
  ethUsdFeed: `0x${string}`;
  rpcUrl: string;
}

/** Circle-issued USDC on each network. */
const USDC: Record<CryptoNetwork, `0x${string}`> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

/** Chainlink ETH/USD price feeds. Overridable via env if Chainlink moves them. */
const ETH_USD_FEED: Record<CryptoNetwork, `0x${string}`> = {
  base: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
  "base-sepolia": "0x4aDC67696bA383F43DD60A9e78F2C97FbbFc7cb1",
};

const DEFAULT_RPC: Record<CryptoNetwork, string> = {
  base: "https://mainnet.base.org",
  "base-sepolia": "https://sepolia.base.org",
};

const CHAIN_ID: Record<CryptoNetwork, number> = {
  base: base.id,
  "base-sepolia": baseSepolia.id,
};

function readNetwork(): CryptoNetwork {
  const raw = (process.env["RAWEDOG_CRYPTO_NETWORK"] ?? "base").trim();
  return raw === "base-sepolia" ? "base-sepolia" : "base";
}

export function getNetworkConfig(): NetworkConfig {
  const network = readNetwork();
  const feedOverride = process.env["RAWEDOG_CRYPTO_ETH_USD_FEED"]?.trim();
  const rpcOverride = process.env["RAWEDOG_CRYPTO_RPC_URL"]?.trim();
  return {
    network,
    chainId: CHAIN_ID[network],
    usdcAddress: USDC[network],
    usdcDecimals: 6,
    ethUsdFeed: (feedOverride ? getAddress(feedOverride) : ETH_USD_FEED[network]) as `0x${string}`,
    rpcUrl: rpcOverride && rpcOverride.length > 0 ? rpcOverride : DEFAULT_RPC[network],
  };
}

/** Our receiving wallet, checksummed. Null when unset = crypto buying closed. */
export function getReceivingAddress(): `0x${string}` | null {
  const raw = process.env["RAWEDOG_CRYPTO_RECEIVING_ADDRESS"]?.trim();
  if (!raw) return null;
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

/** Confirmations required before a payment is honored (default 2). */
export function getRequiredConfirmations(): number {
  const raw = process.env["RAWEDOG_CRYPTO_CONFIRMATIONS"]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

/** Price of ONE generation credit in USD cents (default $5.00). */
export function getCreditPriceCents(): number {
  const raw = process.env["RAWEDOG_CREDIT_PRICE_USD"]?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.round(n * 100);
  return 500;
}

/** How long a quote stays claimable (default 24h — $5 of ETH drift is ours to eat). */
export function getQuoteTtlMs(): number {
  const raw = process.env["RAWEDOG_QUOTE_TTL_HOURS"]?.trim();
  const n = raw ? Number(raw) : NaN;
  return (Number.isFinite(n) && n >= 1 ? Math.floor(n) : 24) * 3600 * 1000;
}

function makeClient(rpcUrl: string, network: CryptoNetwork) {
  return createPublicClient({
    chain: network === "base-sepolia" ? baseSepolia : base,
    transport: http(rpcUrl),
  });
}

let cachedClient: ReturnType<typeof makeClient> | null = null;
let cachedRpc = "";

export function getPublicClient(): ReturnType<typeof makeClient> {
  const cfg = getNetworkConfig();
  if (cachedClient && cachedRpc === cfg.rpcUrl) return cachedClient;
  cachedClient = makeClient(cfg.rpcUrl, cfg.network);
  cachedRpc = cfg.rpcUrl;
  return cachedClient;
}

const AGGREGATOR_ABI = [
  parseAbiItem(
    "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  ),
  parseAbiItem("function decimals() view returns (uint8)"),
] as const;

export interface EthUsdQuote {
  raw: bigint;
  decimals: number;
}

const ORACLE_MAX_STALENESS_SEC = 3600n;

/** Read the latest ETH/USD price from the Chainlink feed on Base. */
export async function readEthUsd(): Promise<EthUsdQuote> {
  const cfg = getNetworkConfig();
  const client = getPublicClient();
  const [round, decimals] = await Promise.all([
    client.readContract({ address: cfg.ethUsdFeed, abi: AGGREGATOR_ABI, functionName: "latestRoundData" }),
    client.readContract({ address: cfg.ethUsdFeed, abi: AGGREGATOR_ABI, functionName: "decimals" }),
  ]);
  const answer = round[1] as bigint;
  const updatedAt = round[3] as bigint;
  if (answer <= 0n) throw new Error("ETH/USD oracle returned a non-positive price");
  if (updatedAt <= 0n) throw new Error("ETH/USD oracle returned no update timestamp");
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (nowSec > updatedAt && nowSec - updatedAt > ORACLE_MAX_STALENESS_SEC) {
    throw new Error(`ETH/USD oracle price is stale (last updated ${nowSec - updatedAt}s ago)`);
  }
  return { raw: answer, decimals: Number(decimals) };
}

/** USDC atomic units for a USD-cent price. */
export function usdcAtomicAmount(priceCents: number, decimals: number): bigint {
  return BigInt(priceCents) * 10n ** BigInt(decimals - 2);
}

/** Wei for a USD-cent price at the given oracle ETH/USD quote. */
export function ethWeiAmount(priceCents: number, eth: EthUsdQuote): bigint {
  const numerator = BigInt(priceCents) * 10n ** BigInt(eth.decimals) * 10n ** 18n;
  const denominator = 100n * eth.raw;
  return numerator / denominator;
}

/**
 * Tiny random atomic tail so each pending quote's amount is unique.
 * USDC (6dp): 1..9999 units (< $0.01). ETH (18dp): 1..1e12 wei (< $0.01).
 */
export function manualAmountTail(asset: CryptoAsset): bigint {
  if (asset === "usdc") return BigInt(randomInt(1, 10_000));
  return BigInt(randomInt(1, 1_000_000_000_000));
}

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export type VerifyOutcome =
  | { status: "granted"; payer: string; blockTimestamp: number }
  | { status: "pending"; confirmations: number; needed: number }
  | { status: "not_found" }
  | { status: "mismatch"; reason: string }
  | { status: "failed"; reason: string };

export interface VerifyInput {
  txHash: string;
  asset: CryptoAsset;
  receivingAddress: `0x${string}`;
  tokenAddress: `0x${string}` | null;
  expectedAmount: bigint;
}

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Read the transaction on Base and decide whether it settles the quote.
 * Manual flow: any sender, but the amount must EXACTLY equal the unique quoted
 * amount so an unrelated payment can't claim it. Pure read-only chain access.
 */
export async function verifyPayment(input: VerifyInput): Promise<VerifyOutcome> {
  const client = getPublicClient();
  const hash = input.txHash as Hex;

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash });
  } catch {
    return { status: "not_found" };
  }

  if (receipt.status !== "success") {
    return { status: "failed", reason: "The transaction reverted on-chain." };
  }

  const needed = getRequiredConfirmations();
  let confirmations = 0;
  try {
    confirmations = Number(await client.getTransactionConfirmations({ hash }));
  } catch {
    confirmations = 0;
  }
  if (confirmations < needed) {
    return { status: "pending", confirmations, needed };
  }

  let blockTimestamp = 0;
  try {
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    blockTimestamp = Number(block.timestamp);
  } catch {
    blockTimestamp = 0;
  }

  if (input.asset === "eth") {
    const tx = await client.getTransaction({ hash });
    if (!tx.to || !eqAddr(tx.to, input.receivingAddress)) {
      return { status: "mismatch", reason: "Payment was not sent to our address." };
    }
    if (tx.value !== input.expectedAmount) {
      return {
        status: "mismatch",
        reason: "That payment's amount doesn't match this quote — send the exact amount shown.",
      };
    }
    return { status: "granted", payer: tx.from.toLowerCase(), blockTimestamp };
  }

  // USDC: sum Transfer logs from the token contract into our address.
  if (!input.tokenAddress) {
    return { status: "failed", reason: "Missing token address for a USDC quote." };
  }
  let received = 0n;
  let payer = "";
  for (const log of receipt.logs) {
    if (!eqAddr(log.address, input.tokenAddress)) continue;
    let decoded;
    try {
      decoded = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    const { from, to, value } = decoded.args as { from: string; to: string; value: bigint };
    if (!eqAddr(to, input.receivingAddress)) continue;
    received += value;
    payer = from.toLowerCase();
  }
  if (received === 0n) {
    return { status: "mismatch", reason: "No USDC transfer to our address was found in that transaction." };
  }
  if (received !== input.expectedAmount) {
    return {
      status: "mismatch",
      reason: "That payment's amount doesn't match this quote — send the exact amount shown.",
    };
  }
  return { status: "granted", payer, blockTimestamp };
}

/** Human display for an atomic amount ("0.00185 ETH" / "5.0037 USDC"). */
export function formatAtomic(amount: bigint, asset: CryptoAsset): string {
  const decimals = asset === "eth" ? 18 : 6;
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return `${whole}${frac ? "." + frac : ""} ${asset.toUpperCase()}`;
}
