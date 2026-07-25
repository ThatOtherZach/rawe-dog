#!/usr/bin/env node
/**
 * stream.e2e.mjs — End-to-end tests for the generate-stream pipeline.
 *
 * Starts a local OpenAI-compatible mock upstream (keyed off
 * response_format.json_schema.name) and a real API-server subprocess, then
 * drives the /api/generate stream endpoint and asserts:
 *
 *   Happy path  – pass1 → 4 drafts → done → close
 *   Hang path   – ≥2 keepalive SSE comment frames, timed-out error, close
 *
 * Usage (from artifacts/api-server):
 *   pnpm run build && pnpm run test:stream
 *
 * No real API key is needed; no writes to the real data directory are made.
 */

import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "../dist/index.mjs");

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Find a free TCP port by binding to :0 and immediately releasing it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// ─── library seed ─────────────────────────────────────────────────────────────
//
// The generate pipeline requires:
//   master-profile   – one markdown file
//   experience       – at least one markdown file (gets catalogId "E1")
//   resume-template  – one markdown file
//   cover-template   – one markdown file
//
// Paths.getDataRoot() resolves to process.cwd()/data, so we set the server's
// cwd to the temp dir and write data/ beneath it.

function seedLibrary(dataRoot) {
  const lib = join(dataRoot, "data", "library");

  const slots = [
    {
      slot: "master-profile",
      file: "master.md",
      content:
        "# Master Profile\nJane Doe — Software Engineer\n10 years building distributed systems.\n",
      id: "master-001",
    },
    {
      // Sorted by meta.id → "E1" catalog ID
      slot: "experience",
      file: "exp1.md",
      content:
        "# Senior Engineer at Acme Corp\n2020–present\n- Built scalable pipelines.\n- Led a team of 5.\n",
      id: "exp-aaa",
    },
    {
      slot: "resume-template",
      file: "resume-tpl.md",
      content: "# Resume\n{{name}}\n\n## Experience\n{{experiences}}\n",
      id: "rtpl-001",
    },
    {
      slot: "cover-template",
      file: "cover-tpl.md",
      content: "Dear Hiring Manager,\n\nI am excited to apply.\n",
      id: "ctpl-001",
    },
  ];

  for (const { slot, file, content, id } of slots) {
    const dir = join(lib, slot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), content, "utf8");
    writeFileSync(
      join(dir, "_meta.json"),
      JSON.stringify(
        [
          {
            id,
            slot,
            originalName: file,
            storedName: file,
            size: content.length,
            updatedAt: new Date().toISOString(),
            mimeType: "text/markdown",
            kind: "markdown",
          },
        ],
        null,
        2
      ),
      "utf8"
    );
  }
}

// ─── mock upstream (OpenAI-compatible) ───────────────────────────────────────
//
// Responses are keyed off response_format.json_schema.name.
// The "hang" flag makes the mock accept connections but never reply —
// this proves heartbeats fire and the XAI_TIMEOUT_MS error surfaces.

const MOCK_RESPONSES = {
  experience_selection: {
    leadExperienceIds: ["E1"],
    supportingExperienceIds: [],
    targetTitle: "Software Engineer",
    company: "Acme Corp",
    rationale: "Strong technical match.",
  },
  // draft_<docKey.toLowerCase()>
  draft_resume: {
    markdown: "# Resume\n\nJane Doe\n\nExperienced engineer.\n",
    sourcesUsed: ["E1"],
  },
  draft_coverletter: {
    markdown: "Dear Hiring Manager,\n\nI am a great fit.\n",
    sourcesUsed: ["E1"],
  },
  draft_alignmentnotes: {
    markdown: "# Alignment Notes\n\nStrong culture fit.\n",
    sourcesUsed: ["E1"],
  },
  draft_starprep: {
    markdown: "# STAR Prep\n\nSituation: ...\nTask: ...\n",
    sourcesUsed: ["E1"],
  },
  kit_verification: {
    findings: [],
    summary: "All documents look good.",
  },
};

function startMockServer({ hang = false } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (hang) {
        // Accept the connection but never send a response — forces timeout.
        req.resume();
        return;
      }

      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const schemaName =
            parsed.response_format?.json_schema?.name ?? "unknown";
          const payload = MOCK_RESPONSES[schemaName] ?? { ok: true };

          const responseBody = JSON.stringify({
            id: "mock-chatcmpl-1",
            object: "chat.completion",
            model: parsed.model ?? "mock-model",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify(payload),
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
            },
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(responseBody);
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });

    server.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

// ─── API server subprocess ────────────────────────────────────────────────────

function startApiServer({ port, xaiBaseUrl, timeoutMs, heartbeatMs, dataRoot }) {
  const child = spawn("node", ["--enable-source-maps", DIST], {
    // cwd → process.cwd() inside the server → data/ lives here
    cwd: dataRoot,
    env: {
      ...process.env,
      PORT: String(port),
      XAI_BASE_URL: xaiBaseUrl,
      XAI_API_KEY: "test-key-e2e-not-real",
      XAI_TIMEOUT_MS: String(timeoutMs ?? 30_000),
      HEARTBEAT_MS: String(heartbeatMs ?? 15_000),
      NODE_ENV: "test",
      // Disable credit enforcement — no token needed for tests
      RAWEDOG_CREDITS_ENFORCED: "",
      // Silence pino output during tests
      LOG_LEVEL: "error",
    },
  });

  // Only forward stderr so test noise is minimal; fatal errors still surface.
  child.stderr.on("data", (d) => {
    const line = String(d).trim();
    // Filter out the pino startup line to reduce noise
    if (!line.includes('"msg":"Server listening"')) {
      process.stderr.write(`[api-server:${port}] ${line}\n`);
    }
  });

  return child;
}

/** Poll /api/health until it returns 200 or the deadline is hit. */
async function waitForServer(port, maxWaitMs = 20_000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(150);
  }
  throw new Error(
    `Server on port ${port} did not come up within ${maxWaitMs} ms`
  );
}

// ─── SSE collection ───────────────────────────────────────────────────────────

/**
 * POST body to url, collect SSE frames until the connection closes or
 * collectTimeoutMs elapses.
 *
 * Returns an array of { kind: "data"|"comment", raw: string }.
 */
async function collectSseFrames(url, body, collectTimeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), collectTimeoutMs);

  const frames = [];
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(unreadable)");
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE lines: split on \n, keep incomplete tail in buf
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          frames.push({ kind: "data", raw: line.slice(6).trim() });
        } else if (line.startsWith(": ")) {
          frames.push({ kind: "comment", raw: line.slice(2).trim() });
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  return frames;
}

// ─── test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("stream.e2e — generate pipeline streaming tests");
  console.log("=".repeat(52));

  // Shared temp data directory — both test servers use the same library seed.
  const dataRoot = mkdtempSync(join(tmpdir(), "rawedog-e2e-"));
  seedLibrary(dataRoot);

  // ── 1. Happy path ──────────────────────────────────────────────────────────
  console.log("\nHappy path (mock upstream returns canned responses):\n");

  const happyMock = await startMockServer({ hang: false });
  const happyMockPort = happyMock.address().port;
  const happyPort = await freePort();

  const happyChild = startApiServer({
    port: happyPort,
    xaiBaseUrl: `http://127.0.0.1:${happyMockPort}/v1`,
    dataRoot,
    timeoutMs: 30_000,
    heartbeatMs: 60_000, // won't fire during a fast happy-path run
  });

  try {
    await waitForServer(happyPort);

    const frames = await collectSseFrames(
      `http://127.0.0.1:${happyPort}/api/generate`,
      {
        jobPosting:
          "Software Engineer at Acme Corp. Build distributed systems at scale.",
        mode: "stream",
      },
      90_000
    );

    const dataFrames = frames
      .filter((f) => f.kind === "data")
      .map((f) => {
        try {
          return JSON.parse(f.raw);
        } catch {
          return { _raw: f.raw };
        }
      });

    await test("emits at least one status event for pass1", async () => {
      const found = dataFrames.some(
        (e) => e.type === "status" && e.stage === "pass1"
      );
      assert(
        found,
        `no pass1 status event; types seen: ${dataFrames.map((e) => e.type).join(", ")}`
      );
    });

    await test("emits a pass1 event containing the selection", async () => {
      const evt = dataFrames.find((e) => e.type === "pass1");
      assert(evt, `no pass1 event`);
      assert(
        evt.selection?.leadExperienceIds?.length > 0,
        `pass1 selection missing leads: ${JSON.stringify(evt.selection)}`
      );
    });

    await test("emits 4 draft events (one per document)", async () => {
      const drafts = dataFrames.filter((e) => e.type === "draft");
      assert(
        drafts.length === 4,
        `expected 4 drafts, got ${drafts.length}: ${drafts.map((d) => d.doc).join(", ")}`
      );
      const docs = new Set(drafts.map((d) => d.doc));
      for (const key of ["resume", "coverLetter", "alignmentNotes", "starPrep"]) {
        assert(docs.has(key), `missing draft for "${key}"`);
      }
    });

    await test("emits a done event with kit containing resume markdown", async () => {
      const evt = dataFrames.find((e) => e.type === "done");
      assert(evt, "no done event");
      // GenerateResult spreads into the event: { type, kit, selection, qaReport, stats, ... }
      assert(
        typeof evt.kit?.resumeMarkdown === "string" && evt.kit.resumeMarkdown.length > 0,
        `done.kit.resumeMarkdown is missing or empty; done keys: ${Object.keys(evt).join(", ")}`
      );
    });

    await test("last data frame is a close event", async () => {
      const last = dataFrames[dataFrames.length - 1];
      assert(
        last?.type === "close",
        `last frame type: "${last?.type}" (raw: ${JSON.stringify(last)})`
      );
    });
  } finally {
    happyChild.kill("SIGTERM");
    happyMock.close();
  }

  // ── 2. Hang path ───────────────────────────────────────────────────────────
  console.log("\nHang path (upstream never responds — heartbeats + timeout):\n");

  // Heartbeat every 1.5 s, model call times out after 5 s → ≥2 keepalives
  const HEARTBEAT_MS = 1_500;
  const TIMEOUT_MS = 5_000;

  const hangMock = await startMockServer({ hang: true });
  const hangMockPort = hangMock.address().port;
  const hangPort = await freePort();

  const hangChild = startApiServer({
    port: hangPort,
    xaiBaseUrl: `http://127.0.0.1:${hangMockPort}/v1`,
    dataRoot,
    timeoutMs: TIMEOUT_MS,
    heartbeatMs: HEARTBEAT_MS,
  });

  try {
    await waitForServer(hangPort);

    // Give plenty of budget: timeout fires at ~5 s, then close frame arrives.
    const frames = await collectSseFrames(
      `http://127.0.0.1:${hangPort}/api/generate`,
      {
        jobPosting:
          "Software Engineer at Acme Corp. Build distributed systems.",
        mode: "stream",
      },
      TIMEOUT_MS + 15_000
    );

    const keepalives = frames.filter(
      (f) => f.kind === "comment" && f.raw === "keepalive"
    );
    const dataFrames = frames
      .filter((f) => f.kind === "data")
      .map((f) => {
        try {
          return JSON.parse(f.raw);
        } catch {
          return { _raw: f.raw };
        }
      });

    await test("receives ≥2 keepalive SSE comment frames before timeout", async () => {
      assert(
        keepalives.length >= 2,
        `got only ${keepalives.length} keepalive frame(s) — HEARTBEAT_MS=${HEARTBEAT_MS}, TIMEOUT_MS=${TIMEOUT_MS}`
      );
    });

    await test("receives an error event whose message contains 'timed out'", async () => {
      const evt = dataFrames.find((e) => e.type === "error");
      assert(
        evt,
        `no error event; data frames: ${JSON.stringify(dataFrames.map((e) => e.type))}`
      );
      assert(
        evt.error?.toLowerCase().includes("timed out"),
        `error.message: "${evt.error}"`
      );
    });

    await test("stream ends with close frame after the timeout error", async () => {
      const last = dataFrames[dataFrames.length - 1];
      assert(
        last?.type === "close",
        `last frame: ${JSON.stringify(last)}`
      );
    });
  } finally {
    hangChild.kill("SIGTERM");
    hangMock.close();
  }

  // ── summary ────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(52));
  console.log(`${passed + failed} tests: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
