/**
 * Legitimacy badge — e2e tests
 *
 * Verifies that the ghost-posting legitimacy tier is correctly surfaced as a
 * badge on list rows and digest cards, and that signals appear in expanded
 * rows.  Also covers a legacy posting with no legitimacy field (no badge).
 *
 * All API calls are intercepted via page.route() — no real server calls.
 * The mock data exercises all three tiers plus the legacy (null) case.
 *
 * Schema unit-test: the first test block verifies that buildFitScanSchema
 * emits the correct legitimacy shape before any browser interaction.
 */
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Schema unit-test (no browser)
// ---------------------------------------------------------------------------

test("buildFitScanSchema includes legitimacy + legitimacySignals fields", async () => {
  // Dynamic import from the compiled API-server output
  const { buildFitScanSchema } = (await import(
    "../../artifacts/api-server/src/lib/schemas.js"
  )) as { buildFitScanSchema: (jobIds: string[], catalogIds: string[]) => Record<string, unknown> };

  const schema = buildFitScanSchema(["J1", "J2"], ["E1"]);
  const results = (schema as {
    properties: {
      results: {
        items: {
          required: string[];
          properties: Record<string, unknown>;
        };
      };
    };
  }).properties.results;

  const item = results.items;
  expect(item.required).toContain("legitimacy");
  expect(item.required).toContain("legitimacySignals");

  const legProp = (item.properties as Record<string, unknown>).legitimacy as Record<string, unknown>;
  expect(legProp.type).toBe("string");
  expect(legProp.enum).toEqual(
    expect.arrayContaining(["high_confidence", "caution", "suspicious"])
  );

  const sigProp = (item.properties as Record<string, unknown>).legitimacySignals as Record<string, unknown>;
  expect(sigProp.type).toBe("array");
});

// ---------------------------------------------------------------------------
// Mock data helpers
// ---------------------------------------------------------------------------

type PostingStatus = "new" | "kit_generated" | "applied" | "dismissed";
type LegitimacyTier = "high_confidence" | "caution" | "suspicious";

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
  score: number | null;
  rationale: string;
  matchedExperienceIds: string[];
  hasBrief: boolean;
  scoredAt: string | null;
  legitimacy: LegitimacyTier | null;
  legitimacySignals: string[];
}

function makePosting(
  n: number,
  legitimacy: LegitimacyTier | null,
  signals: string[] = []
): PostingSummary {
  return {
    id: `posting-${n}`,
    title: `Role ${n}`,
    company: `Corp ${n}`,
    location: "Remote",
    remote: true,
    hybrid: null,
    seniority: "senior",
    salary: "$120k",
    url: `https://example.com/job/${n}`,
    datePosted: "2026-07-20",
    addedAt: "2026-07-20T00:00:00Z",
    status: "new",
    score: 100 - n * 5,
    rationale: `Fit rationale for role ${n}`,
    matchedExperienceIds: [],
    hasBrief: false,
    scoredAt: "2026-07-20T00:00:00Z",
    legitimacy,
    legitimacySignals: signals,
  };
}

const HIGH_CONFIDENCE = makePosting(1, "high_confidence");
const CAUTION = makePosting(2, "caution", [
  "entry-level title paired with 7-year experience requirement",
  "no salary range stated in a salary-transparency jurisdiction",
]);
const SUSPICIOUS = makePosting(3, "suspicious", [
  "asks applicants to invoice as a contractor — no benefits language",
  "very limited description with no team or product context",
]);
const LEGACY = makePosting(4, null); // old record, no legitimacy field

function buildPostingsState(postings: PostingSummary[]) {
  const counts = {
    newCount: postings.filter((p) => p.status === "new").length,
    kitGeneratedCount: 0,
    appliedCount: 0,
    dismissedCount: 0,
  };
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
    lastRefreshAt: "2026-07-20T10:00:00Z",
    lastRefreshStats: { fetched: 4, added: 4, scored: 4, scoreFailures: 0 },
    statusCounts: counts,
    postings,
  };
}

function buildDetailResponse(p: PostingSummary) {
  return {
    ...p,
    provider: "theirstack",
    sourceUrl: p.url,
    countryCode: "US",
    employmentStatuses: ["full_time"],
    minSalaryUsd: null,
    maxSalaryUsd: null,
    discoveredAt: p.datePosted,
    description: `Full description for ${p.title}.`,
    fit: p.score !== null
      ? {
          score: p.score,
          rationale: p.rationale,
          matchedExperienceIds: p.matchedExperienceIds,
          brief: {
            targetTitle: p.title,
            company: p.company,
            seniority: p.seniority,
            mustHaves: ["TypeScript"],
            niceToHaves: [],
            responsibilities: ["Build things"],
            atsKeywords: ["TypeScript"],
            compensation: p.salary,
          },
          legitimacy: p.legitimacy,
          legitimacySignals: p.legitimacySignals,
          scoredAt: p.scoredAt,
          model: "grok-3",
        }
      : null,
  };
}

async function setupMocks(page: Page, postings: PostingSummary[]) {
  // Catch-all (LIFO: registered first, matched last)
  await page.route("**/api/**", (route) => {
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "not mocked" }),
    });
  });

  // GET /api/postings/:id — return detail for any posting
  await page.route("**/api/postings/*", (route) => {
    const url = route.request().url();
    const match = url.match(/\/api\/postings\/([^/]+)$/);
    const id = match ? decodeURIComponent(match[1]) : null;
    const posting = postings.find((p) => p.id === id);
    if (!posting) {
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "not found" }),
      });
      return;
    }
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildDetailResponse(posting)),
    });
  });

  // GET /api/postings — list
  await page.route("**/api/postings", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildPostingsState(postings)),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ALL_POSTINGS = [HIGH_CONFIDENCE, CAUTION, SUSPICIOUS, LEGACY];

test.describe("Legitimacy badges", () => {
  test("high_confidence posting shows no legitimacy badge", async ({ page }) => {
    await setupMocks(page, ALL_POSTINGS);
    await page.goto("/postings");

    const row = page.locator('[id="posting-posting-1"]');
    await expect(row).toBeVisible();

    // No caution or suspicious badge on this row
    await expect(row.getByRole("status", { name: /worth a look/i })).not.toBeVisible();
    await expect(row.locator('[data-legitimacy]')).not.toBeVisible();
  });

  test("caution posting shows a caution badge on the list row", async ({ page }) => {
    await setupMocks(page, ALL_POSTINGS);
    await page.goto("/postings");

    const row = page.locator('[id="posting-posting-2"]');
    await expect(row).toBeVisible();

    const badge = row.getByTitle(/worth a look/i);
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/worth a look/i);
  });

  test("suspicious posting shows a suspicious badge on the list row", async ({ page }) => {
    await setupMocks(page, ALL_POSTINGS);
    await page.goto("/postings");

    const row = page.locator('[id="posting-posting-3"]');
    await expect(row).toBeVisible();

    const badge = row.getByTitle(/review carefully/i);
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/review carefully/i);
  });

  test("legacy posting (null legitimacy) shows no legitimacy badge", async ({ page }) => {
    await setupMocks(page, ALL_POSTINGS);
    await page.goto("/postings");

    const row = page.locator('[id="posting-posting-4"]');
    await expect(row).toBeVisible();

    // Neither caution nor suspicious
    await expect(row.getByTitle(/worth a look/i)).not.toBeVisible();
    await expect(row.getByTitle(/review carefully/i)).not.toBeVisible();
  });

  test("expanding a caution row reveals legitimacy signals", async ({ page }) => {
    await setupMocks(page, ALL_POSTINGS);
    await page.goto("/postings");

    const row = page.locator('[id="posting-posting-2"]');
    await expect(row).toBeVisible();

    // Click the title to expand
    await row.getByRole("button", { name: /Role 2/i }).click();

    // Signals should be visible in the expanded section
    await expect(
      row.getByText("entry-level title paired with 7-year experience requirement")
    ).toBeVisible();
    await expect(
      row.getByText("no salary range stated in a salary-transparency jurisdiction")
    ).toBeVisible();
  });

  test("expanding a suspicious row reveals legitimacy signals", async ({ page }) => {
    await setupMocks(page, ALL_POSTINGS);
    await page.goto("/postings");

    const row = page.locator('[id="posting-posting-3"]');
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: /Role 3/i }).click();

    await expect(
      row.getByText("asks applicants to invoice as a contractor — no benefits language")
    ).toBeVisible();
  });

  test("digest cards show caution badge for caution postings", async ({ page }) => {
    // Use only scored postings with various tiers for the digest
    await setupMocks(page, [HIGH_CONFIDENCE, CAUTION, SUSPICIOUS, LEGACY]);
    await page.goto("/postings");

    const digest = page.locator("section").filter({ hasText: "Today's picks" });
    await expect(digest).toBeVisible();

    // The caution card should carry a badge
    const cautionCard = digest.locator('[id]').filter({ hasText: "Role 2" }).first();
    // Use a broader locator if the card doesn't carry an id
    const allCards = digest.locator(".rounded-xl");
    const cautionBadge = allCards.filter({ hasText: "Role 2" }).getByTitle(/worth a look/i);
    await expect(cautionBadge).toBeVisible();
  });

  test("digest cards show suspicious badge for suspicious postings", async ({ page }) => {
    await setupMocks(page, [HIGH_CONFIDENCE, CAUTION, SUSPICIOUS, LEGACY]);
    await page.goto("/postings");

    const digest = page.locator("section").filter({ hasText: "Today's picks" });
    await expect(digest).toBeVisible();

    const allCards = digest.locator(".rounded-xl");
    const suspiciousBadge = allCards.filter({ hasText: "Role 3" }).getByTitle(/review carefully/i);
    await expect(suspiciousBadge).toBeVisible();
  });
});
