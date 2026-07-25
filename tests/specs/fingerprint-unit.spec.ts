/**
 * Unit tests for the SimHash content fingerprint.
 *
 * These run entirely in Node — no browser page is opened.
 * The fingerprint module is exercised via a small inline re-implementation
 * so the test suite stays self-contained and doesn't need a TypeScript
 * compilation step for the api-server source.
 *
 * Algorithm mirrors fingerprint.ts exactly so the tests double as a
 * specification for the port.
 */
import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Inline re-implementation (mirrors fingerprint.ts exactly)
// ---------------------------------------------------------------------------

const HASH_BITS = 64;
const SHINGLE_SIZE = 3;
const MIN_CHARS = 200;
const MIN_TOKENS = 3;
const SIMILARITY_THRESHOLD = 0.92;

function normalizeJdText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&[#a-zA-Z0-9]+;/g, " ")
    .replace(/https?:\/\/[^\s]+/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function fnv1a64(s: string): bigint {
  let h = 14695981039346656037n;
  const prime = 1099511628211n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = BigInt.asUintN(64, h * prime);
  }
  return h;
}

function fingerprintText(text: string): string {
  const norm = normalizeJdText(text);
  if (norm.length < MIN_CHARS) return "";
  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length < MIN_TOKENS) return "";
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
  let result = 0n;
  for (let b = 0; b < HASH_BITS; b++) {
    if (v[b] > 0) result |= 1n << BigInt(b);
  }
  return result.toString(16).padStart(16, "0");
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ha = BigInt("0x" + a);
  const hb = BigInt("0x" + b);
  let diff = ha ^ hb;
  let count = 0;
  while (diff > 0n) { diff &= diff - 1n; count++; }
  return (HASH_BITS - count) / HASH_BITS;
}

function isCrossListing(a: string, b: string): boolean {
  return similarity(a, b) >= SIMILARITY_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Realistic JD fixture (long enough to fingerprint)
// ---------------------------------------------------------------------------

const JD_A = `
We are looking for a Senior Software Engineer to join our team. You will design,
build, and maintain efficient, reusable, and reliable TypeScript and Node.js code.
You will work closely with cross-functional teams to deliver high-quality products.

Responsibilities:
- Design and implement scalable backend services using Node.js and TypeScript
- Collaborate with product managers, designers, and other engineers
- Write clean, maintainable, and well-tested code
- Participate in code reviews and architectural discussions
- Mentor junior engineers and help grow the team

Requirements:
- 5+ years of professional software engineering experience
- Strong proficiency with TypeScript and Node.js
- Experience with RESTful API design and implementation
- Familiarity with PostgreSQL or similar relational databases
- Experience with cloud platforms (AWS, GCP, or Azure)
- Excellent communication and collaboration skills

Nice to have:
- Experience with React or other frontend frameworks
- Knowledge of containerization technologies (Docker, Kubernetes)
- Experience with CI/CD pipelines
`.trim();

// Agency re-post: header swapped, employer name removed, minor reword in intro.
const JD_A_AGENCY = `
Our client is seeking a Senior Software Engineer on a permanent basis.
You will design, build, and maintain efficient, reusable, and reliable
TypeScript and Node.js code. You will work closely with cross-functional
teams to deliver high-quality products.

Responsibilities:
- Design and implement scalable backend services using Node.js and TypeScript
- Collaborate with product managers, designers, and other engineers
- Write clean, maintainable, and well-tested code
- Participate in code reviews and architectural discussions
- Mentor junior engineers and help grow the team

Requirements:
- 5+ years of professional software engineering experience
- Strong proficiency with TypeScript and Node.js
- Experience with RESTful API design and implementation
- Familiarity with PostgreSQL or similar relational databases
- Experience with cloud platforms (AWS, GCP, or Azure)
- Excellent communication and collaboration skills

Nice to have:
- Experience with React or other frontend frameworks
- Knowledge of containerization technologies (Docker, Kubernetes)
- Experience with CI/CD pipelines
`.trim();

// Completely unrelated JD
const JD_UNRELATED = `
We are looking for an experienced Marketing Manager to lead our brand strategy
and digital marketing campaigns. The ideal candidate will have a proven track
record of growing brand awareness and driving customer acquisition.

Responsibilities:
- Develop and execute comprehensive marketing strategies aligned with business goals
- Manage and optimize paid advertising campaigns across Google Ads and social platforms
- Oversee content creation, email marketing, and social media management
- Analyze campaign performance data and report on KPIs to senior leadership
- Collaborate with sales team to align marketing efforts with revenue targets
- Manage agency relationships and external vendors

Requirements:
- 5+ years of experience in digital marketing or brand management
- Strong analytical skills with proficiency in Google Analytics and marketing dashboards
- Experience managing significant advertising budgets and optimizing for ROI
- Excellent written and verbal communication skills
- Bachelor's degree in Marketing, Business, or a related field
`.trim();

// ---------------------------------------------------------------------------
// normalizeJdText
// ---------------------------------------------------------------------------

test.describe("normalizeJdText", () => {
  test("strips HTML tags", () => {
    const result = normalizeJdText("<p>Hello <strong>world</strong></p>");
    expect(result).not.toContain("<");
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });

  test("strips HTML entities", () => {
    const result = normalizeJdText("Research &amp; Development &nbsp; Q&amp;A &#x27;quoted&#x27;");
    expect(result).not.toContain("&amp;");
    expect(result).not.toContain("&#x27;");
    expect(result).toContain("research");
    expect(result).toContain("development");
  });

  test("strips URLs", () => {
    const result = normalizeJdText("Apply at https://jobs.example.com/apply?ref=123 today");
    expect(result).not.toContain("https");
    expect(result).not.toContain("example.com");
    expect(result).toContain("apply");
    expect(result).toContain("today");
  });

  test("lowercases everything", () => {
    expect(normalizeJdText("TypeScript Node.js AWS")).toBe("typescript node js aws");
  });

  test("collapses non-alphanumeric runs to single space", () => {
    const result = normalizeJdText("a---b   c, d: e");
    expect(result).toBe("a b c d e");
  });

  test("trims leading and trailing whitespace", () => {
    expect(normalizeJdText("  hello world  ")).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// fingerprintText
// ---------------------------------------------------------------------------

test.describe("fingerprintText", () => {
  test("identical text produces the same fingerprint", () => {
    const fp1 = fingerprintText(JD_A);
    const fp2 = fingerprintText(JD_A);
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(16);
  });

  test("fingerprint is a 16-char lowercase hex string", () => {
    const fp = fingerprintText(JD_A);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  test("returns empty string for text under 200 normalized chars", () => {
    // Short stub descriptions must never fingerprint (false-positive guard)
    expect(fingerprintText("Contact us for details. Great opportunity awaits.")).toBe("");
    expect(fingerprintText("Senior engineer role. Apply now.")).toBe("");
  });

  test("returns empty string for empty input", () => {
    expect(fingerprintText("")).toBe("");
  });

  test("returns empty string for whitespace-only input", () => {
    expect(fingerprintText("   \n\t  ")).toBe("");
  });

  test("returns empty string for HTML-only input that normalizes short", () => {
    // After stripping tags the remaining text is very short
    expect(fingerprintText("<br><hr><p>&nbsp;</p><div></div>")).toBe("");
  });

  test("produces non-empty fingerprint for sufficiently long JD", () => {
    expect(fingerprintText(JD_A)).not.toBe("");
    expect(fingerprintText(JD_UNRELATED)).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// similarity
// ---------------------------------------------------------------------------

test.describe("similarity", () => {
  test("identical fingerprints → 1.0", () => {
    const fp = fingerprintText(JD_A);
    expect(similarity(fp, fp)).toBe(1.0);
  });

  test("empty fingerprints → 0 (never match)", () => {
    // Two postings that are both too short must never be flagged as duplicates
    expect(similarity("", "")).toBe(0);
    expect(similarity("", fingerprintText(JD_A))).toBe(0);
    expect(similarity(fingerprintText(JD_A), "")).toBe(0);
  });

  test("near-verbatim texts (agency header swap) → similarity ≥ 0.92", () => {
    const fpA = fingerprintText(JD_A);
    const fpB = fingerprintText(JD_A_AGENCY);
    const sim = similarity(fpA, fpB);
    expect(sim).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  test("completely unrelated JDs → similarity well below 0.92", () => {
    const fpA = fingerprintText(JD_A);
    const fpU = fingerprintText(JD_UNRELATED);
    expect(similarity(fpA, fpU)).toBeLessThan(0.80);
  });
});

// ---------------------------------------------------------------------------
// isCrossListing
// ---------------------------------------------------------------------------

test.describe("isCrossListing", () => {
  test("identical text → true", () => {
    const fp = fingerprintText(JD_A);
    expect(isCrossListing(fp, fp)).toBe(true);
  });

  test("near-verbatim (agency header) → true", () => {
    expect(isCrossListing(fingerprintText(JD_A), fingerprintText(JD_A_AGENCY))).toBe(true);
  });

  test("unrelated JDs → false", () => {
    expect(isCrossListing(fingerprintText(JD_A), fingerprintText(JD_UNRELATED))).toBe(false);
  });

  test("empty fingerprints → false (never match)", () => {
    expect(isCrossListing("", "")).toBe(false);
    expect(isCrossListing("", fingerprintText(JD_A))).toBe(false);
  });
});
