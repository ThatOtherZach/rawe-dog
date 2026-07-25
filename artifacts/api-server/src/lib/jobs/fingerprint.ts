/**
 * Content fingerprint for job descriptions — 64-bit SimHash over 3-token shingles.
 *
 * Ported from career-ops fingerprint-core.mjs (MIT licence,
 * Santiago Fernández de Valderrama, github.com/santifer/career-ops).
 * Algorithm constants, thresholds, and guard rationale comments preserved
 * verbatim from the source.
 *
 * Source: https://github.com/santifer/career-ops/blob/main/fingerprint-core.mjs
 */

const HASH_BITS = 64;
const SHINGLE_SIZE = 3;
/** Minimum normalized-char count below which fingerprinting is skipped. */
const MIN_CHARS = 200;
/** Minimum token count below which fingerprinting is skipped. */
const MIN_TOKENS = 3;
/**
 * Similarity threshold for flagging a cross-listing.
 * ≥ 0.92 means at most 5 of 64 bits differ.
 */
export const SIMILARITY_THRESHOLD = 0.92;

/**
 * Normalize JD text: strip HTML tags/entities/URLs, lowercase, collapse
 * non-alphanumeric sequences to a single space (unicode-aware).
 */
export function normalizeJdText(text: string): string {
  return (
    text
      // Strip HTML tags
      .replace(/<[^>]*>/g, " ")
      // Strip HTML entities (named, numeric decimal, numeric hex)
      .replace(/&[#a-zA-Z0-9]+;/g, " ")
      // Strip URLs
      .replace(/https?:\/\/[^\s]+/g, " ")
      // Lowercase
      .toLowerCase()
      // Collapse runs of non-alphanumeric characters (unicode word chars kept)
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
  );
}

/**
 * FNV-1a 64-bit hash of a string, returned as a BigInt.
 * Used to produce per-shingle bit vectors for SimHash.
 */
function fnv1a64(s: string): bigint {
  // FNV-64 constants (unsigned)
  let h = 14695981039346656037n; // FNV offset basis
  const prime = 1099511628211n; // FNV prime
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = BigInt.asUintN(64, h * prime);
  }
  return h;
}

/**
 * Compute a 64-bit SimHash fingerprint of a job description, returned as a
 * 16-char lowercase hex string.
 *
 * Returns '' when the input is too short to fingerprint reliably. Empty
 * fingerprints never match — this ensures no false positives on boilerplate
 * or stub descriptions.
 *
 * Guard rationale (from career-ops):
 * - CJK single-token bodies: single-character CJK tokens produce degenerate
 *   single-shingle sets that SimHash collapses into pure-boilerplate clusters,
 *   generating large false-positive groups.
 * - Min-length: very short descriptions (e.g. "contact us for details") are
 *   content-indistinguishable — matching them would produce spurious clusters.
 */
export function fingerprintText(text: string): string {
  const norm = normalizeJdText(text);

  if (norm.length < MIN_CHARS) return "";

  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length < MIN_TOKENS) return "";

  // SimHash: maintain a 64-element counter; +1 per set bit, -1 per clear bit.
  const v = new Array<number>(HASH_BITS).fill(0);

  let shingleCount = 0;
  for (let i = 0; i <= tokens.length - SHINGLE_SIZE; i++) {
    const shingle = tokens[i] + " " + tokens[i + 1] + " " + tokens[i + 2];
    const hash = fnv1a64(shingle);
    for (let b = 0; b < HASH_BITS; b++) {
      v[b] += (hash >> BigInt(b)) & 1n ? 1 : -1;
    }
    shingleCount++;
  }

  if (shingleCount === 0) return "";

  // Build final fingerprint: bit b = 1 if v[b] > 0, else 0.
  let result = 0n;
  for (let b = 0; b < HASH_BITS; b++) {
    if (v[b] > 0) result |= 1n << BigInt(b);
  }

  return result.toString(16).padStart(16, "0");
}

/**
 * Hamming-distance-based similarity between two 64-bit fingerprints
 * (16-char hex strings). Returns a value in [0, 1] where 1.0 means identical
 * and 0.0 means all 64 bits differ.
 *
 * Two empty strings always return 0 — empty fingerprints never match,
 * preventing false positives on boilerplate or stub descriptions.
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ha = BigInt("0x" + a);
  const hb = BigInt("0x" + b);
  let diff = ha ^ hb;
  // Kernighan bit count (popcount)
  let bitsDiffering = 0;
  while (diff > 0n) {
    diff &= diff - 1n;
    bitsDiffering++;
  }
  return (HASH_BITS - bitsDiffering) / HASH_BITS;
}

/**
 * Returns true when two fingerprints are similar enough to flag a cross-listing.
 * Threshold ≥ 0.92 (at most 5 of 64 bits differ).
 */
export function isCrossListing(a: string, b: string): boolean {
  return similarity(a, b) >= SIMILARITY_THRESHOLD;
}
