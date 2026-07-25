/**
 * Digest-cohesion tests
 *
 * Verifies that the "Today's picks" DigestStrip stays in sync with the
 * ranked postings list when a posting is dismissed (from the digest) or
 * marked applied (from the ranked list).
 *
 * All API calls are intercepted via page.route() — no real server calls.
 *
 * Route ordering note: Playwright matches routes in LIFO order (last
 * registered = first matched). Specific routes must be registered AFTER
 * the catch-all so they win.
 */
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Mock data helpers
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
  score: number | null;
  rationale: string;
  matchedExperienceIds: string[];
  hasBrief: boolean;
  scoredAt: string | null;
}

function makePosting(
  n: number,
  status: PostingStatus = "new"
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
    // Descending scores so the API rank order is preserved
    score: 100 - n * 5,
    rationale: `Strong fit for role ${n}`,
    matchedExperienceIds: [],
    hasBrief: false,
    scoredAt: "2026-07-20T00:00:00Z",
  };
}

/** Build the full /api/postings payload from a list of postings. */
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
    lastRefreshAt: "2026-07-20T10:00:00Z",
    lastRefreshStats: { fetched: 5, added: 5, scored: 5, scoreFailures: 0 },
    statusCounts: counts,
    postings,
  };
}

// ---------------------------------------------------------------------------
// Shared route-mock setup
// ---------------------------------------------------------------------------

/**
 * Wire up route interception with an in-memory postings list.
 *
 * Playwright routes are LIFO: register catch-alls FIRST so specific
 * handlers (registered later) take precedence.
 */
async function setupApiMocks(page: Page, initial: PostingSummary[]) {
  // Mutable state shared across handler calls within a test
  let postings = [...initial];

  // 1. Catch-all: block all other /api/** requests so nothing leaks to the
  //    real API server. Registered FIRST → matched LAST in LIFO order.
  await page.route("**/api/**", (route) => {
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "not mocked" }),
    });
  });

  // 2. PATCH /api/postings/:id/status — update in-memory state and return it.
  //    Registered SECOND → matched before the catch-all.
  await page.route("**/api/postings/*/status", (route) => {
    const url = route.request().url();
    const match = url.match(/\/api\/postings\/([^/]+)\/status/);
    const id = match ? decodeURIComponent(match[1]) : null;
    const body = JSON.parse(route.request().postData() || "{}") as {
      status?: PostingStatus;
    };
    const newStatus = body.status;
    if (id && newStatus) {
      postings = postings.map((p) =>
        p.id === id ? { ...p, status: newStatus } : p
      );
    }
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, ...buildPostingsState(postings) }),
    });
  });

  // 3. GET /api/postings — return the current in-memory state.
  //    Registered LAST → matched FIRST in LIFO order; wins over catch-all.
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

test.describe("Digest cohesion", () => {
  /** Five scored, actionable postings — enough so that after one is removed
   * from picks there is still a 5th to slide into position #4. */
  const FIVE_POSTINGS = [1, 2, 3, 4, 5].map((n) => makePosting(n));

  test("dismissing Best Match from digest removes it and promotes posting-5 to 4th pick", async ({
    page,
  }) => {
    await setupApiMocks(page, FIVE_POSTINGS);
    await page.goto("/postings");

    // Wait for the digest to appear
    const digest = page.locator("section").filter({ hasText: "Today's picks" });
    await expect(digest).toBeVisible();

    // Confirm the initial four picks are visible in the digest
    await expect(digest.getByText("Best match")).toBeVisible();
    await expect(digest.getByText("Engineer Role 1")).toBeVisible();
    await expect(digest.getByText("Engineer Role 4")).toBeVisible();
    // The 5th posting should NOT yet appear in the digest
    await expect(digest.getByText("Engineer Role 5")).not.toBeVisible();

    // Click "Dismiss" on the Best Match card (posting-1)
    const dismissBtn = digest
      .getByRole("button", { name: "Dismiss" })
      .first();
    await dismissBtn.click();

    // After the patch, posting-1 (Best Match) should be gone from the digest
    await expect(digest.getByText("Engineer Role 1")).not.toBeVisible();

    // posting-5 should now be the 4th card in the digest ("Eh, maybe?")
    await expect(digest.getByText("Engineer Role 5")).toBeVisible();
    await expect(digest.getByText("Eh, maybe?")).toBeVisible();

    // All four rank labels should still be present
    for (const label of [
      "Best match",
      "Second best",
      "You could do this",
      "Eh, maybe?",
    ]) {
      await expect(digest.getByText(label)).toBeVisible();
    }
  });

  test("applying a posting from the ranked list removes it from the digest", async ({
    page,
  }) => {
    await setupApiMocks(page, FIVE_POSTINGS);
    await page.goto("/postings");

    // Wait for both the digest and the ranked list to load
    const digest = page.locator("section").filter({ hasText: "Today's picks" });
    await expect(digest).toBeVisible();

    // posting-2 is the "Second best" pick initially
    await expect(digest.getByText("Second best")).toBeVisible();
    await expect(digest.getByText("Engineer Role 2")).toBeVisible();

    // Find posting-2 in the ranked list and click "Mark applied"
    const postingRow = page.locator('[id="posting-posting-2"]');
    await expect(postingRow).toBeVisible();

    const applyBtn = postingRow.getByRole("button", { name: "Mark applied" });
    await applyBtn.click();

    // After the patch, posting-2 should no longer appear in the digest
    await expect(digest.getByText("Engineer Role 2")).not.toBeVisible();

    // posting-5 should have slid up to fill the 4th slot in the digest
    await expect(digest.getByText("Engineer Role 5")).toBeVisible();
  });
});
