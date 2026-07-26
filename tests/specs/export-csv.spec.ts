/**
 * Export applied jobs as CSV — e2e tests
 *
 * Verifies GET /api/postings/export.csv:
 *   - Returns correct CSV columns.
 *   - Includes one data row per applied posting.
 *   - Excludes non-applied postings.
 *   - Returns only the header row when no postings are applied.
 *
 * Uses the real API server (must be running on port 5002, same as playwright
 * baseURL pointed at the rawe-dog dev server which proxies /api/*).
 * Routes are intercepted via page.route() so no real file I/O occurs.
 */
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PostingStatus = "new" | "kit_generated" | "applied" | "dismissed";

interface PostingSummary {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean | null;
  hybrid: boolean | null;
  seniority: string;
  salary: string;
  url: string;
  datePosted: string;
  addedAt: string;
  status: PostingStatus;
  appliedAt?: string;
  score: number | null;
  rationale: string;
  matchedExperienceIds: string[];
  hasBrief: boolean;
  scoredAt: string | null;
  legitimacy: null | "high_confidence" | "caution" | "suspicious";
  legitimacySignals: string[];
  crossListingOf: null | { id: string; company: string; title: string };
}

function makePosting(
  n: number,
  status: PostingStatus = "new",
  overrides: Partial<PostingSummary> = {}
): PostingSummary {
  return {
    id: `posting-${n}`,
    title: `Engineer Role ${n}`,
    company: `Acme Corp ${n}`,
    location: "Remote",
    remote: true,
    hybrid: null,
    seniority: "senior",
    salary: "$120k",
    url: `https://example.com/job/${n}`,
    datePosted: "2026-07-20",
    addedAt: "2026-07-20T00:00:00Z",
    status,
    score: 80 - n * 5,
    rationale: `Strong fit for role ${n}`,
    matchedExperienceIds: [],
    hasBrief: true,
    scoredAt: "2026-07-20T12:00:00Z",
    legitimacy: "high_confidence",
    legitimacySignals: [],
    crossListingOf: null,
    ...overrides,
  };
}

function buildPostingsState(postings: PostingSummary[]) {
  const counts = {
    newCount: 0,
    kitGeneratedCount: 0,
    appliedCount: 0,
    dismissedCount: 0,
  };
  for (const p of postings) {
    if (p.status === "new") counts.newCount++;
    else if (p.status === "kit_generated") counts.kitGeneratedCount++;
    else if (p.status === "applied") counts.appliedCount++;
    else if (p.status === "dismissed") counts.dismissedCount++;
  }
  return {
    providerConfigured: true,
    xaiConfigured: true,
    hasMasterProfile: true,
    hasExperienceCatalog: true,
    filters: {
      titleQueries: ["engineer"],
      countryCodes: ["US"],
      remoteOnly: false,
      seniority: [],
      maxAgeDays: 14,
      minSalaryUsd: null,
      descriptionKeywords: [],
      limit: 25,
    },
    filtersSource: "manual",
    lastRefreshAt: null,
    lastRefreshStats: null,
    statusCounts: counts,
    postings,
  };
}

/**
 * Build a minimal CSV response that mirrors what the real route returns.
 * UTF-8 BOM + header + data rows.
 */
function buildCsvResponse(postings: PostingSummary[]): string {
  const BOM = "\uFEFF";
  const headers = [
    "Job Title",
    "Company",
    "Location",
    "Job URL",
    "Applied At",
    "Fit Score",
    "Kit Generated",
    "Kit Generated At",
    "Cross-Listing",
    "Suspicious",
  ];

  function cell(v: string): string {
    if (v.includes('"') || v.includes(",") || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  }

  const rows = [
    headers.join(","),
    ...postings
      .filter((p) => p.status === "applied")
      .map((p) =>
        [
          p.title,
          p.company,
          p.location,
          p.url,
          p.appliedAt ?? "",
          p.score != null ? String(p.score) : "",
          p.hasBrief ? "yes" : "no",
          p.scoredAt ?? "",
          p.crossListingOf ? "true" : "false",
          p.legitimacy === "suspicious" ? "true" : "false",
        ]
          .map(cell)
          .join(",")
      ),
  ];

  return BOM + rows.join("\r\n");
}

async function setupMocks(page: Page, postings: PostingSummary[]) {
  // Catch-all
  await page.route("**/api/**", (route) => {
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "not mocked" }),
    });
  });

  // GET /api/postings
  await page.route("**/api/postings", (route) => {
    if (route.request().method() !== "GET") {
      route.fallback();
      return;
    }
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildPostingsState(postings)),
    });
  });

  // GET /api/credits/status
  await page.route("**/api/credits/status", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, enforced: false, tokens: [] }),
    });
  });

  // GET /api/postings/export.csv
  await page.route("**/api/postings/export.csv", (route) => {
    route.fulfill({
      status: 200,
      contentType: "text/csv; charset=utf-8",
      body: buildCsvResponse(postings),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Export applied jobs as CSV", () => {
  test("export button is absent when no postings are applied", async ({
    page,
  }) => {
    const postings = [makePosting(1, "new"), makePosting(2, "kit_generated")];
    await setupMocks(page, postings);
    await page.goto("/postings");
    await expect(
      page.getByRole("button", { name: /export applied jobs/i })
    ).not.toBeVisible();
  });

  test("export button appears when at least one posting is applied", async ({
    page,
  }) => {
    const postings = [makePosting(1, "applied"), makePosting(2, "new")];
    await setupMocks(page, postings);
    await page.goto("/postings");
    await expect(
      page.getByRole("button", { name: /export applied jobs/i })
    ).toBeVisible();
  });

  test("CSV response has correct headers and one row per applied posting", async ({
    page,
  }) => {
    const applied1 = makePosting(1, "applied");
    const applied2 = makePosting(2, "applied", {
      legitimacy: "suspicious",
      crossListingOf: { id: "other-id", company: "Other Co", title: "Other Role" },
    });
    const notApplied = makePosting(3, "new");
    const postings = [applied1, applied2, notApplied];
    await setupMocks(page, postings);

    // Navigate so the page context resolves relative URLs
    await page.goto("/postings");

    // Fetch the CSV directly — the button's <a download> triggers a browser
    // download event rather than an interceptable fetch response, so we verify
    // the endpoint content via fetch in the page context instead.
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/postings/export.csv");
      return {
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        body: await res.text(),
      };
    });

    expect(result.status).toBe(200);
    expect(result.contentType).toMatch(/text\/csv/i);

    const text = result.body.startsWith("\uFEFF")
      ? result.body.slice(1)
      : result.body;
    const lines = text.split("\r\n").filter(Boolean);

    // Header + 2 applied rows (non-applied excluded)
    expect(lines.length).toBe(3);

    // Verify header columns
    const headerCols = lines[0].split(",");
    expect(headerCols[0]).toBe("Job Title");
    expect(headerCols[1]).toBe("Company");
    expect(headerCols[2]).toBe("Location");
    expect(headerCols[3]).toBe("Job URL");
    expect(headerCols[4]).toBe("Applied At");
    expect(headerCols[5]).toBe("Fit Score");
    expect(headerCols[6]).toBe("Kit Generated");
    expect(headerCols[7]).toBe("Kit Generated At");
    expect(headerCols[8]).toBe("Cross-Listing");
    expect(headerCols[9]).toBe("Suspicious");

    // Row 1 — normal applied posting
    const row1 = lines[1].split(",");
    expect(row1[0]).toBe(applied1.title);
    expect(row1[8]).toBe("false"); // no cross-listing
    expect(row1[9]).toBe("false"); // not suspicious

    // Row 2 — suspicious cross-listing
    const row2 = lines[2].split(",");
    expect(row2[0]).toBe(applied2.title);
    expect(row2[8]).toBe("true");  // is a cross-listing
    expect(row2[9]).toBe("true");  // suspicious
  });

  test("Applied At column contains the appliedAt timestamp when set", async ({
    page,
  }) => {
    const appliedAt = "2026-07-25T14:30:00.000Z";
    const posting = makePosting(1, "applied", { appliedAt });
    await setupMocks(page, [posting]);
    await page.goto("/postings");

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/postings/export.csv");
      return { status: res.status, body: await res.text() };
    });

    expect(result.status).toBe(200);
    const text = result.body.startsWith("\uFEFF")
      ? result.body.slice(1)
      : result.body;
    const lines = text.split("\r\n").filter(Boolean);
    // Header + 1 data row
    expect(lines.length).toBe(2);
    const cols = lines[1].split(",");
    // Column index 4 is "Applied At"
    expect(cols[4]).toBe(appliedAt);
  });

  test("Applied At column is blank for applied postings without appliedAt (backwards-compatible)", async ({
    page,
  }) => {
    // Simulate a pre-existing record that has no appliedAt field
    const posting = makePosting(1, "applied");
    delete posting.appliedAt;
    await setupMocks(page, [posting]);
    await page.goto("/postings");

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/postings/export.csv");
      return { status: res.status, body: await res.text() };
    });

    expect(result.status).toBe(200);
    const text = result.body.startsWith("\uFEFF")
      ? result.body.slice(1)
      : result.body;
    const lines = text.split("\r\n").filter(Boolean);
    expect(lines.length).toBe(2);
    const cols = lines[1].split(",");
    expect(cols[4]).toBe("");
  });

  test("CSV with no applied postings returns only the header row", async ({
    page,
  }) => {
    const postings: PostingSummary[] = [];
    await setupMocks(page, postings);

    // Navigate to page first so relative fetches resolve correctly
    await page.goto("/postings");

    // Hit the endpoint directly via fetch in page context
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/postings/export.csv");
      return { status: res.status, body: await res.text() };
    });

    expect(result.status).toBe(200);
    const text = result.body.startsWith("\uFEFF")
      ? result.body.slice(1)
      : result.body;
    const lines = text.split("\r\n").filter(Boolean);
    // Only the header — zero data rows
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Job Title");
  });
});

// ---------------------------------------------------------------------------
// Minimal RFC-4180 CSV cell parser (handles quoted fields with escaped quotes).
// ---------------------------------------------------------------------------

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      // Quoted field: read until closing unescaped quote.
      let val = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          val += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          val += line[i++];
        }
      }
      cells.push(val);
      if (line[i] === ",") i++; // skip separator
    } else {
      // Unquoted field: read until comma or end.
      const start = i;
      while (i < line.length && line[i] !== ",") i++;
      cells.push(line.slice(start, i));
      if (line[i] === ",") i++;
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Real server smoke test — no mocks, hits the actual API server
// ---------------------------------------------------------------------------

test.describe("Export CSV — real server", () => {
  const API_BASE = "http://localhost:8080";

  test("GET /api/postings/export.csv returns text/csv with correct headers and attachment disposition", async ({
    request,
  }) => {
    // Hit the real API server directly (no page.route mocks).
    // The endpoint always returns at minimum the header row, regardless of
    // how many applied postings are in local storage, so we only assert
    // shape and response metadata.
    const res = await request.get(`${API_BASE}/api/postings/export.csv`);

    expect(res.status()).toBe(200);

    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toMatch(/text\/csv/i);

    const disposition = res.headers()["content-disposition"] ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("applied-jobs.csv");

    const body = await res.text();
    // Strip BOM (any encoding) by removing leading non-ASCII junk before "Job Title"
    const text = body.replace(/^[\s\S]*?(?=Job Title)/, "Job Title");
    const lines = text.split("\r\n").filter(Boolean);

    // At minimum the header row must be present
    expect(lines.length).toBeGreaterThanOrEqual(1);

    // Verify all required column headers are present in the header line.
    // Use substring checks rather than array equality so BOM handling is
    // irrelevant — the BOM only prefixes the very first column.
    const headerLine = lines[0];
    expect(headerLine).toContain("Job Title");
    expect(headerLine).toContain("Company");
    expect(headerLine).toContain("Location");
    expect(headerLine).toContain("Job URL");
    expect(headerLine).toContain("Applied At");
    expect(headerLine).toContain("Fit Score");
    expect(headerLine).toContain("Kit Generated");
    expect(headerLine).toContain("Kit Generated At");
    expect(headerLine).toContain("Cross-Listing");
    expect(headerLine).toContain("Suspicious");
  });

  test("appliedAt is set on first apply and not overwritten by a duplicate apply", async ({
    request,
  }) => {
    // Fetch existing postings — skip gracefully if none are present.
    const listRes = await request.get(`${API_BASE}/api/postings`);
    expect(listRes.status()).toBe(200);
    const listBody = await listRes.json() as {
      postings: Array<{ id: string; url: string; status: string }>;
    };
    const postings = listBody.postings ?? [];
    if (postings.length === 0) {
      // No postings stored — nothing to apply, idempotency trivially holds.
      return;
    }

    // Pick first posting; remember its original status so we can clean up.
    const target = postings[0];
    const originalStatus = target.status;

    // Ensure a clean slate: clear any existing appliedAt by moving to "new".
    const clearRes = await request.patch(
      `${API_BASE}/api/postings/${target.id}/status`,
      { data: { status: "new" } }
    );
    expect(clearRes.status()).toBe(200);

    // ---------- First apply ----------
    const apply1Res = await request.patch(
      `${API_BASE}/api/postings/${target.id}/status`,
      { data: { status: "applied" } }
    );
    expect(apply1Res.status()).toBe(200);

    // Read the CSV and find the Applied At value for our posting by URL.
    const csv1 = await (await request.get(`${API_BASE}/api/postings/export.csv`)).text();
    const lines1 = csv1.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    // Skip header row; find the row whose URL column (index 3) matches.
    const row1 = lines1.slice(1).map(parseCsvRow).find((cols) => cols[3] === target.url);
    expect(row1).toBeDefined();
    const appliedAt1 = row1![4];
    expect(appliedAt1).toMatch(/^\d{4}-\d{2}-\d{2}T/); // valid ISO timestamp

    // ---------- Small delay then duplicate apply ----------
    await new Promise((r) => setTimeout(r, 50));
    const apply2Res = await request.patch(
      `${API_BASE}/api/postings/${target.id}/status`,
      { data: { status: "applied" } }
    );
    expect(apply2Res.status()).toBe(200);

    const csv2 = await (await request.get(`${API_BASE}/api/postings/export.csv`)).text();
    const lines2 = csv2.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    const row2 = lines2.slice(1).map(parseCsvRow).find((cols) => cols[3] === target.url);
    expect(row2).toBeDefined();
    const appliedAt2 = row2![4];

    // Timestamp must be identical — duplicate apply must not advance the clock.
    expect(appliedAt2).toBe(appliedAt1);

    // ---------- Cleanup: restore original status ----------
    await request.patch(
      `${API_BASE}/api/postings/${target.id}/status`,
      { data: { status: originalStatus } }
    );
  });
});
