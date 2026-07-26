/**
 * High-fit kit verification skip tests
 *
 * Verifies that the score-gated skip logic in app-generate.ts correctly:
 *   - Skips verification (verifierRan=false, skipped=true) for postings
 *     with score >= 70 and emits the expected QA summary.
 *   - Runs the full verifier (verifierRan=true) for postings with score < 70.
 *   - Runs the full verifier (verifierRan=true) for postings with no score
 *     (fit=null / posting not yet scored).
 *
 * API-level tests: start a local mock LLM HTTP server, temporarily seed a
 * test posting + settings pointing at the mock, call the real API server, and
 * assert on the `qa` SSE event and on the mock's call counters.
 *
 * UI-level tests: intercept the generate endpoint via page.route() and assert
 * that the Quality tab renders the skip / run states correctly.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";

// ---------------------------------------------------------------------------
// Paths — API server cwd is artifacts/api-server; data lives under that.
// ---------------------------------------------------------------------------

// Playwright runs with cwd = the tests/ directory; walk up one level to reach the repo root.
const API_SERVER_DATA = path.join(process.cwd(), "..", "artifacts/api-server/data");
const SETTINGS_PATH = path.join(API_SERVER_DATA, "settings.json");
const POSTINGS_DIR = path.join(API_SERVER_DATA, "postings");
const POSTINGS_PATH = path.join(POSTINGS_DIR, "postings.json");

// ---------------------------------------------------------------------------
// Mock LLM server
// ---------------------------------------------------------------------------

const MOCK_SELECTION_RESPONSE = {
  targetTitle: "Software Engineer",
  company: "Test Corp",
  leadExperienceIds: ["E1"],
  supportingExperienceIds: [],
  leadExperiences: [],
  supportingExperiences: [],
  keywordsToHit: ["typescript", "engineering"],
  rationale: "Strong alignment with the role requirements.",
};

const MOCK_DRAFT_RESPONSE = {
  markdown: "# Document\n\nThis is placeholder test content for the document.",
  sourcesUsed: ["E1"],
};

const MOCK_VERIFICATION_RESPONSE = {
  findings: [],
  summary: "All checks passed — no grounding or consistency issues.",
};

function mockLlmPayload(schemaName: string): object {
  if (schemaName === "experience_selection") return MOCK_SELECTION_RESPONSE;
  if (schemaName.startsWith("draft_")) return MOCK_DRAFT_RESPONSE;
  if (schemaName === "kit_verification") return MOCK_VERIFICATION_RESPONSE;
  // Repair / json_object fallback
  return MOCK_DRAFT_RESPONSE;
}

type MockLlm = {
  server: Server;
  port: number;
  /** How many times each schema name was requested. */
  callsBySchema: Map<string, number>;
};

function startMockLlm(): Promise<MockLlm> {
  const callsBySchema = new Map<string, number>();

  return new Promise((resolve, reject) => {
    const server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        if (!req.url?.includes("/chat/completions")) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }

        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body) as {
              response_format?: {
                json_schema?: { name?: string };
                type?: string;
              };
            };
            // schema name from structured-output format, else "json_object" for repair
            const schemaName =
              parsed.response_format?.json_schema?.name ??
              parsed.response_format?.type ??
              "unknown";

            callsBySchema.set(
              schemaName,
              (callsBySchema.get(schemaName) ?? 0) + 1
            );

            const responseContent = mockLlmPayload(schemaName);
            const responseBody = {
              id: "mock-completion",
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: "mock-model",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: JSON.stringify(responseContent),
                  },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 50,
                completion_tokens: 200,
                total_tokens: 250,
              },
            };

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(responseBody));
          } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "bad request" }));
          }
        });
      }
    );

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Could not bind mock LLM server"));
        return;
      }
      resolve({ server, port: addr.port, callsBySchema });
    });
    server.on("error", reject);
  });
}

function stopMockLlm(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeTestPosting(id: string, score: number | null): object {
  const hasFit = score !== null;
  return {
    posting: {
      id,
      title: "Software Engineer",
      company: "Test Corp",
      location: "Remote",
      remote: true,
      hybrid: false,
      seniority: "senior",
      salary: "$120k",
      url: `https://example.com/jobs/${id}`,
      datePosted: "2026-07-01",
      description:
        "We are looking for a talented Software Engineer with TypeScript experience to join our team.",
    },
    fit: hasFit
      ? {
          score,
          rationale: `Test rationale for score ${score}`,
          matchedExperienceIds: ["E1"],
          // Must match the JobBrief type exactly — briefIsUsable() accesses
          // mustHaves.length and atsKeywords.length directly; undefined throws.
          brief: {
            targetTitle: "Software Engineer",
            company: "Test Corp",
            seniority: "senior",
            mustHaves: ["TypeScript experience"],
            niceToHaves: ["Node.js"],
            responsibilities: ["Write production TypeScript code"],
            atsKeywords: ["typescript", "software engineer"],
            compensation: "",
          },
          legitimacy: "high_confidence",
          legitimacySignals: [],
          scoredAt: new Date().toISOString(),
          model: "mock-model",
        }
      : null,
    addedAt: new Date().toISOString(),
    status: "new",
  };
}

// ---------------------------------------------------------------------------
// SSE stream collector (direct Node.js HTTP — Playwright request fixture
// does not expose a readable streaming interface for SSE)
// ---------------------------------------------------------------------------

interface SseQaEvent {
  type: "qa";
  report: {
    verifierRan: boolean;
    skipped?: boolean;
    summary: string;
    verdict: string;
    findings: unknown[];
    counts: { major: number; minor: number; info: number };
  };
}

interface SseGenericEvent {
  type: string;
  [key: string]: unknown;
}

async function collectSseEvents(
  postingId: string,
  timeoutMs = 30_000
): Promise<SseGenericEvent[]> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      mode: "stream",
      postingId,
    });

    const deadline = setTimeout(
      () => reject(new Error(`SSE collection timed out after ${timeoutMs}ms`)),
      timeoutMs
    );

    const req = http.request(
      {
        hostname: "localhost",
        port: 80,
        path: "/api/generate",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const events: SseGenericEvent[] = [];
        let buf = "";

        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const dataLine = frame
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const ev = JSON.parse(
                dataLine.slice(6)
              ) as SseGenericEvent;
              events.push(ev);
              // Stop collecting once we've seen the terminal "close" event.
              if (ev.type === "close" || ev.type === "error") {
                res.destroy();
                clearTimeout(deadline);
                resolve(events);
              }
            } catch {
              /* skip malformed frame */
            }
          }
        });

        res.on("end", () => {
          clearTimeout(deadline);
          resolve(events);
        });

        res.on("error", (err) => {
          clearTimeout(deadline);
          reject(err);
        });
      }
    );

    req.on("error", (err) => {
      clearTimeout(deadline);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// API-level tests: real server + mock LLM
// ---------------------------------------------------------------------------

test.describe("High-fit skip — API-level (real server + mock LLM)", () => {
  let savedSettings: string | null = null;
  let savedPostings: string | null = null;
  let mockLlm: MockLlm | null = null;

  test.beforeEach(() => {
    savedSettings = existsSync(SETTINGS_PATH)
      ? readFileSync(SETTINGS_PATH, "utf8")
      : null;
    savedPostings = existsSync(POSTINGS_PATH)
      ? readFileSync(POSTINGS_PATH, "utf8")
      : null;
  });

  test.afterEach(async () => {
    // Restore settings first so the server is usable again
    if (savedSettings !== null) {
      writeFileSync(SETTINGS_PATH, savedSettings, "utf8");
    }
    if (savedPostings !== null) {
      writeFileSync(POSTINGS_PATH, savedPostings, "utf8");
    }

    if (mockLlm) {
      await stopMockLlm(mockLlm.server);
      mockLlm = null;
    }
  });

  /** Wire up mock LLM and write temp settings pointing at it. */
  async function setupApiTest(): Promise<Map<string, number>> {
    mockLlm = await startMockLlm();

    // Overlay test settings onto the existing ones so we keep valid
    // library/theirstackApiKey values and only override the LLM endpoint.
    const base = savedSettings ? (JSON.parse(savedSettings) as Record<string, unknown>) : {};
    writeFileSync(
      SETTINGS_PATH,
      JSON.stringify({
        ...base,
        apiKey: "test-key-for-skip-verification-spec",
        apiEndpoint: `http://127.0.0.1:${mockLlm.port}/v1`,
        runVerification: true,
      }),
      "utf8"
    );

    return mockLlm.callsBySchema;
  }

  /** Add a test posting to the store without disturbing existing ones. */
  function seedPosting(posting: object): void {
    mkdirSync(POSTINGS_DIR, { recursive: true });
    const existing = savedPostings
      ? (JSON.parse(savedPostings) as { postings?: object[] })
      : {};
    writeFileSync(
      POSTINGS_PATH,
      JSON.stringify({
        ...existing,
        postings: [...(existing.postings ?? []), posting],
      }),
      "utf8"
    );
  }

  // ── Test 1: score = 82 (≥ 70 → skip) ─────────────────────────────────────

  test("score=82 → verifierRan=false, summary contains 'strong fit score (82/100)', verifier LLM not called", async () => {
    test.setTimeout(60_000);

    const callsBySchema = await setupApiTest();
    seedPosting(makeTestPosting("skip-spec-high-82", 82));

    const events = await collectSseEvents("skip-spec-high-82");

    const qaEvent = events.find((e) => e.type === "qa") as
      | SseQaEvent
      | undefined;

    expect(qaEvent, "SSE stream must emit a qa event").toBeDefined();
    expect(qaEvent!.report.verifierRan).toBe(false);
    expect(qaEvent!.report.skipped).toBe(true);
    expect(qaEvent!.report.summary).toContain("strong fit score (82/100)");

    // The verifier LLM stage must not have been invoked.
    expect(callsBySchema.get("kit_verification") ?? 0).toBe(0);
  });

  // ── Test 2: score = 55 (< 70 → run verifier) ─────────────────────────────

  test("score=55 → verifierRan=true, verifier LLM called at least once", async () => {
    test.setTimeout(60_000);

    const callsBySchema = await setupApiTest();
    seedPosting(makeTestPosting("skip-spec-low-55", 55));

    const events = await collectSseEvents("skip-spec-low-55");

    const qaEvent = events.find((e) => e.type === "qa") as
      | SseQaEvent
      | undefined;

    expect(qaEvent, "SSE stream must emit a qa event").toBeDefined();
    expect(qaEvent!.report.verifierRan).toBe(true);
    expect(qaEvent!.report.skipped).toBeFalsy();

    // Verifier LLM stage must have run.
    expect(callsBySchema.get("kit_verification") ?? 0).toBeGreaterThanOrEqual(1);
  });

  // ── Test 3: no score (fit=null → run verifier) ────────────────────────────

  test("no score (fit=null) → verifierRan=true, verifier LLM called at least once", async () => {
    test.setTimeout(60_000);

    const callsBySchema = await setupApiTest();
    seedPosting(makeTestPosting("skip-spec-no-score", null));

    const events = await collectSseEvents("skip-spec-no-score");

    const qaEvent = events.find((e) => e.type === "qa") as
      | SseQaEvent
      | undefined;

    expect(qaEvent, "SSE stream must emit a qa event").toBeDefined();
    expect(qaEvent!.report.verifierRan).toBe(true);
    expect(qaEvent!.report.skipped).toBeFalsy();

    // Verifier LLM stage must have run.
    expect(callsBySchema.get("kit_verification") ?? 0).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// UI-level tests: mock API endpoints, verify Quality tab rendering
// ---------------------------------------------------------------------------

type QaReport = {
  verdict: "pass" | "issues_found" | "repaired";
  summary: string;
  findings: unknown[];
  keywordCoverage: unknown[];
  repairedDocuments: unknown[];
  counts: { major: number; minor: number; info: number };
  verifierRan: boolean;
  skipped?: boolean;
};

function makeQaReport(opts: {
  verifierRan: boolean;
  skipped: boolean;
  summary: string;
  verdict?: QaReport["verdict"];
}): QaReport {
  return {
    verdict: opts.verdict ?? "pass",
    summary: opts.summary,
    findings: [],
    keywordCoverage: [],
    repairedDocuments: [],
    counts: { major: 0, minor: 0, info: 0 },
    verifierRan: opts.verifierRan,
    skipped: opts.skipped,
  };
}

const MOCK_KIT = {
  meta: {
    targetTitle: "Software Engineer",
    company: "Test Corp",
    leadExperiences: ["E1 — Software Engineer"],
    rationale: "Strong fit for the role.",
  },
  resumeMarkdown: "# Resume\n\nPlaceholder resume content.",
  coverLetterMarkdown: "# Cover Letter\n\nPlaceholder cover letter content.",
  alignmentNotesMarkdown: "# Alignment\n\nPlaceholder alignment notes.",
  starPrepMarkdown: "# STAR Prep\n\nPlaceholder STAR prep content.",
};

const MOCK_SELECTION_SSE = {
  targetTitle: "Software Engineer",
  company: "Test Corp",
  leadExperienceIds: ["E1"],
  supportingExperienceIds: [],
  leadExperiences: ["E1 — Software Engineer"],
  supportingExperiences: [],
  keywordsToHit: ["typescript"],
  rationale: "Strong alignment with role requirements.",
};

/** Build a minimal but complete SSE payload for one full pipeline run. */
function buildSseStream(qaReport: QaReport): string {
  const events: object[] = [
    { type: "status", stage: "pass1", message: "Selecting experiences (Pass 1)…" },
    {
      type: "pass1",
      selection: MOCK_SELECTION_SSE,
      experienceOptions: [
        { id: "exp-1", catalogId: "E1", title: "Software Engineer", fileName: "experience.md" },
      ],
      stats: {},
    },
    { type: "status", stage: "drafting", message: "Drafting documents…" },
    { type: "draft", doc: "resume", markdown: MOCK_KIT.resumeMarkdown, sourcesUsed: ["E1"] },
    { type: "draft", doc: "coverLetter", markdown: MOCK_KIT.coverLetterMarkdown, sourcesUsed: ["E1"] },
    { type: "draft", doc: "alignmentNotes", markdown: MOCK_KIT.alignmentNotesMarkdown, sourcesUsed: ["E1"] },
    { type: "draft", doc: "starPrep", markdown: MOCK_KIT.starPrepMarkdown, sourcesUsed: ["E1"] },
    { type: "qa", report: qaReport },
    {
      type: "done",
      kit: MOCK_KIT,
      selection: MOCK_SELECTION_SSE,
      experienceOptions: [],
      qaReport,
      stats: { durationMs: 1000 },
    },
    { type: "close" },
  ];
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

async function setupUiMocks(page: Page, qaReport: QaReport, postingScore: number | null) {
  // Catch-all: block unmocked API calls
  await page.route("**/api/**", (route) => {
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "not mocked" }),
    });
  });

  // Health — return a fully ready state so the Generate button is enabled
  await page.route("**/api/health**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        settings: { hasApiKey: true, model: "grok-4.5" },
        library: {
          ready: true,
          masterProfile: true,
          experienceCount: 2,
          resumeTemplate: true,
          coverTemplate: true,
          systemInstructions: false,
        },
      }),
    });
  });

  // GET /api/postings/:id — return a linked posting with the requested score
  await page.route("**/api/postings/ui-test-posting*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "ui-test-posting",
        title: "Software Engineer",
        company: "Test Corp",
        location: "Remote",
        salary: "$120k",
        url: "https://example.com/jobs/ui-test",
        score: postingScore,
        rationale: "Strong fit for the role.",
        matchedExperienceIds: ["E1"],
        hasBrief: postingScore !== null,
        legitimacy: null,
        legitimacySignals: [],
      }),
    });
  });

  // POST /api/generate (stream mode) — return a crafted SSE body
  await page.route("**/api/generate", (route) => {
    if (route.request().method() !== "POST") {
      route.fallback();
      return;
    }
    route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: buildSseStream(qaReport),
    });
  });
}

test.describe("High-fit skip — Quality tab UI rendering", () => {
  // ── Test 1: high-fit skip shows "skipped" label + summary ─────────────────

  test("score=82 → Quality tab shows 'skipped' label and skip summary", async ({ page }) => {
    const qaReport = makeQaReport({
      verifierRan: false,
      skipped: true,
      summary:
        "Verification skipped — strong fit score (82/100); grounding risk is low.",
    });

    await setupUiMocks(page, qaReport, 82);
    await page.goto("/?posting=ui-test-posting");

    // Wait for the linked posting panel to appear
    await expect(page.getByText("Software Engineer")).toBeVisible();
    await expect(page.getByText("Test Corp")).toBeVisible();

    // Run the full pipeline via "Generate (Auto)"
    const generateBtn = page.getByRole("button", { name: "Generate (Auto)" });
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // Wait for kit to complete
    await expect(page.getByText("Kit ready.")).toBeVisible({ timeout: 15_000 });

    // Switch to the Quality tab
    const qualityTab = page.getByRole("button", { name: /Quality/ });
    await qualityTab.click();

    // Tab label must include "skipped" indicator
    await expect(qualityTab.getByText("skipped")).toBeVisible();

    // Panel must show "Verification not run" heading (skipped=true path)
    await expect(page.getByText("Verification not run")).toBeVisible();

    // Summary text must mention the score
    await expect(page.getByText(/strong fit score \(82\/100\)/)).toBeVisible();

    // "Passed" verdict badge must NOT appear (skipped=true uses the Skipped path)
    await expect(page.getByText("Passed")).not.toBeVisible();
  });

  // ── Test 2: low-fit run shows "Passed" verdict, no skip label ─────────────

  test("score=55 → Quality tab shows 'Passed' badge, no 'Verification not run'", async ({ page }) => {
    const qaReport = makeQaReport({
      verifierRan: true,
      skipped: false,
      summary: "All checks passed — no grounding or consistency issues found.",
      verdict: "pass",
    });

    await setupUiMocks(page, qaReport, 55);
    await page.goto("/?posting=ui-test-posting");

    await expect(page.getByText("Software Engineer")).toBeVisible();

    const generateBtn = page.getByRole("button", { name: "Generate (Auto)" });
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    await expect(page.getByText("Kit ready.")).toBeVisible({ timeout: 15_000 });

    const qualityTab = page.getByRole("button", { name: /Quality/ });
    await qualityTab.click();

    // "Passed" verdict badge must be visible (verifierRan=true, verdict=pass).
    // Use { exact: true } to target the badge span only, not summary sentences
    // containing "passed" as a substring (strict-mode guard against 3 matches).
    await expect(page.getByText("Passed", { exact: true })).toBeVisible();

    // "Verification not run" must NOT appear
    await expect(page.getByText("Verification not run")).not.toBeVisible();

    // Tab label must NOT include "skipped"
    await expect(qualityTab.getByText("skipped")).not.toBeVisible();
  });

  // ── Test 3: no score also runs verifier ───────────────────────────────────

  test("no score → Quality tab shows 'Passed' badge, verification ran normally", async ({ page }) => {
    const qaReport = makeQaReport({
      verifierRan: true,
      skipped: false,
      summary: "All checks passed — no issues found.",
      verdict: "pass",
    });

    await setupUiMocks(page, qaReport, null);
    await page.goto("/?posting=ui-test-posting");

    await expect(page.getByText("Software Engineer")).toBeVisible();

    const generateBtn = page.getByRole("button", { name: "Generate (Auto)" });
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    await expect(page.getByText("Kit ready.")).toBeVisible({ timeout: 15_000 });

    const qualityTab = page.getByRole("button", { name: /Quality/ });
    await qualityTab.click();

    await expect(page.getByText("Passed", { exact: true })).toBeVisible();
    await expect(page.getByText("Verification not run")).not.toBeVisible();
  });
});
