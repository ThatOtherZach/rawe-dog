/**
 * Cross-listing deduplication — e2e tests
 *
 * Verifies that when a posting is flagged as a cross-listing of an earlier one:
 *   1. Both rows are visible in the ranked list.
 *   2. The cross-listing row shows the "likely same opening" note.
 *   3. The digest ("Today's picks") never surfaces both — the cross-listed
 *      posting is skipped and the next-ranked posting takes its slot.
 *
 * All API calls are intercepted via page.route() — no real server calls.
 */
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Mock data helpers
// ---------------------------------------------------------------------------

type PostingStatus = "new" | "kit_generated" | "applied" | "dismissed";

interface CrossListingRef {
  id: string;
  company: string;
  title: string;
}

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
  legitimacy: null;
  legitimacySignals: string[];
  crossListingOf: CrossListingRef | null;
}

function makePosting(
  n: number,
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
    status: "new",
    score: 100 - n * 5,
    rationale: `Strong fit for role ${n}`,
    matchedExperienceIds: [],
    hasBrief: false,
    scoredAt: "2026-07-20T00:00:00Z",
    legitimacy: null,
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
    lastRefreshAt: "2026-07-20T10:00:00Z",
    lastRefreshStats: { fetched: 5, added: 5, scored: 5, scoreFailures: 0 },
    statusCounts: counts,
    postings,
  };
}

async function setupApiMocks(page: Page, initial: PostingSummary[]) {
  await page.route("**/api/**", (route) => {
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "not mocked" }),
    });
  });

  await page.route("**/api/postings", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildPostingsState(initial)),
    });
  });
}

// ---------------------------------------------------------------------------
// Fixtures
//
// Five postings ranked by score desc:
//   posting-1  score=95  (original)
//   posting-2  score=90  (cross-listing of posting-1)
//   posting-3  score=85
//   posting-4  score=80
//   posting-5  score=75
//
// Without dedup: digest picks 1, 2, 3, 4.
// With dedup   : posting-2 is skipped (cross-listing of already-picked posting-1),
//                so digest picks 1, 3, 4, 5.
// ---------------------------------------------------------------------------

const ORIGINAL = makePosting(1, { score: 95 });
const CROSS_LIST = makePosting(2, {
  score: 90,
  crossListingOf: { id: "posting-1", company: "Acme Corp 1", title: "Engineer Role 1" },
});
const POST_3 = makePosting(3, { score: 85 });
const POST_4 = makePosting(4, { score: 80 });
const POST_5 = makePosting(5, { score: 75 });

const FIVE_POSTINGS = [ORIGINAL, CROSS_LIST, POST_3, POST_4, POST_5];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Cross-listing deduplication", () => {
  test("both rows visible in ranked list", async ({ page }) => {
    await setupApiMocks(page, FIVE_POSTINGS);
    await page.goto("/postings");

    // Wait for ranked list to load
    const list = page.locator("section").filter({ hasText: "Ranked postings" });
    await expect(list).toBeVisible();

    // Both rows must appear — match by the expand-button title which is unique per row
    await expect(list.getByRole("button", { name: "Engineer Role 1" })).toBeVisible();
    await expect(list.getByRole("button", { name: "Engineer Role 2" })).toBeVisible();
  });

  test("cross-listing row shows 'likely same opening' note", async ({ page }) => {
    await setupApiMocks(page, FIVE_POSTINGS);
    await page.goto("/postings");

    const list = page.locator("section").filter({ hasText: "Ranked postings" });
    await expect(list).toBeVisible();

    // The cross-listing badge referencing the original should be visible
    await expect(list.getByText(/likely same.*Acme Corp 1.*Engineer Role 1/i)).toBeVisible();
  });

  test("digest skips the cross-listing and promotes posting-5 to slot 4", async ({ page }) => {
    await setupApiMocks(page, FIVE_POSTINGS);
    await page.goto("/postings");

    const digest = page.locator("section").filter({ hasText: "Today's picks" });
    await expect(digest).toBeVisible();

    // posting-1 (original) is "Best match"
    await expect(digest.getByText("Best match")).toBeVisible();
    await expect(digest.getByText("Engineer Role 1")).toBeVisible();

    // posting-2 (cross-listing) must NOT appear in the digest
    await expect(digest.getByText("Engineer Role 2")).not.toBeVisible();

    // posting-3 fills slot 2
    await expect(digest.getByText("Engineer Role 3")).toBeVisible();

    // posting-5 should fill the 4th slot ("Eh, maybe?") instead of posting-2
    await expect(digest.getByText("Engineer Role 5")).toBeVisible();
    await expect(digest.getByText("Eh, maybe?")).toBeVisible();

    // All four rank labels present
    for (const label of ["Best match", "Second best", "You could do this", "Eh, maybe?"]) {
      await expect(digest.getByText(label)).toBeVisible();
    }
  });

  test("original still shows normally — cross-listing flag is only on the newer posting", async ({ page }) => {
    await setupApiMocks(page, FIVE_POSTINGS);
    await page.goto("/postings");

    const list = page.locator("section").filter({ hasText: "Ranked postings" });
    await expect(list).toBeVisible();

    // The original posting row must NOT carry a cross-listing note
    const originalRow = list.locator('[id="posting-posting-1"]');
    await expect(originalRow).toBeVisible();
    await expect(originalRow.getByText(/likely same/i)).not.toBeVisible();
  });

  /**
   * Chaining scenario — cross-refresh dedup:
   *   posting-1  score=95  original (no crossListingOf)
   *   posting-2  score=90  first duplicate, correctly resolved → posting-1
   *   posting-3  score=85  second duplicate from a later refresh, also resolved
   *                        → posting-1 (not → posting-2)
   *   posting-4  score=80  unrelated
   *   posting-5  score=75  unrelated
   *   posting-6  score=70  unrelated
   *
   * Expected digest: 1 (best), 4, 5, 6 — both posting-2 AND posting-3 are skipped
   * even though posting-3 shares its root with posting-2 (a sibling, not a direct
   * child of whichever posting is picked first).
   */
  test("two cross-listings of the same original both skipped from digest (chaining / sibling)", async ({
    page,
  }) => {
    const chainPostings = [
      makePosting(1, { score: 95 }),
      makePosting(2, {
        score: 90,
        crossListingOf: { id: "posting-1", company: "Acme Corp 1", title: "Engineer Role 1" },
      }),
      makePosting(3, {
        score: 85,
        // Resolved to root: posting-1, NOT posting-2
        crossListingOf: { id: "posting-1", company: "Acme Corp 1", title: "Engineer Role 1" },
      }),
      makePosting(4, { score: 80 }),
      makePosting(5, { score: 75 }),
      makePosting(6, { score: 70 }),
    ];

    await setupApiMocks(page, chainPostings);
    await page.goto("/postings");

    const digest = page.locator("section").filter({ hasText: "Today's picks" });
    await expect(digest).toBeVisible();

    // posting-1 is the best match
    await expect(digest.getByText("Best match")).toBeVisible();
    await expect(digest.getByText("Engineer Role 1")).toBeVisible();

    // Neither cross-listing should appear in the digest
    await expect(digest.getByText("Engineer Role 2")).not.toBeVisible();
    await expect(digest.getByText("Engineer Role 3")).not.toBeVisible();

    // The 4th slot should be filled by posting-6 (not 2 or 3)
    await expect(digest.getByText("Engineer Role 6")).toBeVisible();
    await expect(digest.getByText("Eh, maybe?")).toBeVisible();
  });
});
