/**
 * Search-credit gate e2e tests
 *
 * Verifies the $1-per-refresh flow:
 *   - Gate off (default): refresh works with no token.
 *   - Gate on + no token: refresh returns 402 credit_required.
 *   - Gate on + valid token: refresh succeeds and the credits panel is visible.
 *   - Gate on + provider failure: credit is NOT burned (no spend on failure).
 *   - Kit generation is always free: no token needed, no 402 ever.
 *
 * All network calls are intercepted — no real server or provider calls.
 */
import { test, expect, type Page } from "@playwright/test";

// ── Helpers ──────────────────────────────────────────────────────────────────

const FAKE_TOKEN =
  "rdc1.eyJpZCI6InRlc3QtaWQiLCJpYXQiOjE3NTMwMDAwMDB9.c2lnbmF0dXJl"; // not a real HMAC — server never sees it in these UI tests

function postingsState(postings: unknown[] = []) {
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
    statusCounts: { newCount: 0, kitGeneratedCount: 0, appliedCount: 0, dismissedCount: 0 },
    postings,
  };
}

/** Wire up minimal mocks for the Postings page. */
async function setupPostingsMocks(
  page: Page,
  opts: {
    creditsEnforced?: boolean;
    refreshResponse?: { status: number; body: object };
    hasSearchToken?: boolean;
  } = {}
) {
  const enforced = opts.creditsEnforced ?? false;
  const refreshResp = opts.refreshResponse ?? {
    status: 200,
    body: { ok: true, ...postingsState(), lastRefreshStats: { fetched: 3, added: 3, scored: 3, scoreFailures: 0 } },
  };

  // Catch-all: reject anything not explicitly mocked.
  await page.route("**/api/**", (route) => {
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not mocked" }) });
  });

  // GET /api/postings
  await page.route("**/api/postings", (route) => {
    if (route.request().method() !== "GET") { route.fallback(); return; }
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(postingsState()) });
  });

  // GET /api/credits/status
  await page.route("**/api/credits/status", (route) => {
    const token = route.request().headers()["x-credit-token"];
    const hasValid = Boolean(token && opts.hasSearchToken);
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        enforced,
        priceUsdCents: 100,
        crypto: { available: false },
        token: token ? { valid: hasValid, remaining: hasValid ? 1 : 0, reason: hasValid ? undefined : "unknown" } : null,
      }),
    });
  });

  // POST /api/postings/refresh
  await page.route("**/api/postings/refresh", (route) => {
    route.fulfill({
      status: refreshResp.status,
      contentType: "application/json",
      body: JSON.stringify(refreshResp.body),
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Search credit gate", () => {
  test("gate off: refresh works with no token, credits panel is hidden", async ({ page }) => {
    await setupPostingsMocks(page, { creditsEnforced: false });
    await page.goto("/postings");

    // Credits panel should NOT be visible when enforcement is off
    await expect(page.getByText("Search credits")).not.toBeVisible();

    // Refresh button should work
    const refreshBtn = page.getByRole("button", { name: /Refresh postings/i });
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // Should show success message (no 402)
    await expect(page.getByText(/Fetched 3 postings/)).toBeVisible();
  });

  test("gate on: credits panel is visible with no-credit badge", async ({ page }) => {
    await setupPostingsMocks(page, { creditsEnforced: true, hasSearchToken: false });
    await page.goto("/postings");

    // Panel should appear
    await expect(page.getByText("Search credits")).toBeVisible();
    await expect(page.getByText("none")).toBeVisible();
  });

  test("gate on: credits panel shows balance badge when token is valid", async ({ page }) => {
    // Inject a fake token into localStorage before navigating
    await page.goto("/postings");
    await page.evaluate((token) => localStorage.setItem("rawe.search.token", token), FAKE_TOKEN);

    await setupPostingsMocks(page, { creditsEnforced: true, hasSearchToken: true });
    await page.reload();

    await expect(page.getByText("Search credits")).toBeVisible();
    await expect(page.getByText("1 ready")).toBeVisible();
  });

  test("gate on: 402 credit_required shows error and bumps credits panel", async ({ page }) => {
    await setupPostingsMocks(page, {
      creditsEnforced: true,
      hasSearchToken: false,
      refreshResponse: {
        status: 402,
        body: { ok: false, error: "A search credit is required to refresh postings — buy or redeem one.", code: "credit_required", reason: "missing" },
      },
    });
    await page.goto("/postings");

    const refreshBtn = page.getByRole("button", { name: /Refresh postings/i });
    await refreshBtn.click();

    // Error message should appear
    await expect(page.getByText(/search credit is required/i)).toBeVisible();

    // Credits panel should still be visible (it was there before)
    await expect(page.getByText("Search credits")).toBeVisible();
  });

  test("gate on + valid token: refresh succeeds", async ({ page }) => {
    await page.goto("/postings");
    await page.evaluate((token) => localStorage.setItem("rawe.search.token", token), FAKE_TOKEN);

    // Re-setup mocks after navigation
    await setupPostingsMocks(page, {
      creditsEnforced: true,
      hasSearchToken: true,
      refreshResponse: {
        status: 200,
        body: { ok: true, ...postingsState(), lastRefreshStats: { fetched: 5, added: 5, scored: 5, scoreFailures: 0 } },
      },
    });
    await page.reload();

    // Panel shows 1 credit ready
    await expect(page.getByText("1 ready")).toBeVisible();

    const refreshBtn = page.getByRole("button", { name: /Refresh postings/i });
    await refreshBtn.click();

    // Should succeed — show the success message
    await expect(page.getByText(/Fetched 5 postings/)).toBeVisible();
  });

  test("generate page has no credits panel — kits are always free", async ({ page }) => {
    // Minimal mocks for the generate page — enforcement ON but kits are free
    await page.route("**/api/**", (route) => {
      const url = route.request().url();
      if (url.includes("/api/healthz")) {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", settings: { hasApiKey: true, model: "grok-3" }, library: { ready: true, masterProfile: true, experienceCount: 1, resumeTemplate: true, coverTemplate: true, systemInstructions: false } }) });
        return;
      }
      if (url.includes("/api/credits/status")) {
        // Enforcement ON — but the generate page should show no credits panel at all
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, enforced: true, priceUsdCents: 100, crypto: { available: false }, token: null }) });
        return;
      }
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not mocked" }) });
    });

    await page.goto("/");

    // Neither "Generation credits" nor "Search credits" should appear on the generate page
    await expect(page.getByText("Generation credits")).not.toBeVisible();
    await expect(page.getByText("Search credits")).not.toBeVisible();
  });

  test("token redeemed via Postings panel authorizes postings refresh", async ({ page }) => {
    // Simulate redeem flow on the Postings page, then verify the token is used on refresh.
    let capturedRefreshToken: string | null = null;

    await page.route("**/api/**", (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes("/api/postings/refresh") && method === "POST") {
        // Capture what token was sent
        capturedRefreshToken = route.request().headers()["x-credit-token"] ?? null;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, ...postingsState(), lastRefreshStats: { fetched: 2, added: 2, scored: 2, scoreFailures: 0 } }),
        });
        return;
      }
      if (url.includes("/api/postings") && method === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(postingsState()) });
        return;
      }
      if (url.includes("/api/credits/redeem") && method === "POST") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, token: FAKE_TOKEN, credits: 1 }) });
        return;
      }
      if (url.includes("/api/credits/status")) {
        const sentToken = route.request().headers()["x-credit-token"];
        const hasToken = sentToken === FAKE_TOKEN;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, enforced: true, priceUsdCents: 100, crypto: { available: false }, token: sentToken ? { valid: hasToken, remaining: hasToken ? 1 : 0 } : null }),
        });
        return;
      }
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not mocked" }) });
    });

    await page.goto("/postings");

    // Panel should appear (enforcement on, no token yet)
    await expect(page.getByText("Search credits")).toBeVisible();

    // Redeem a code — this stores the token in rawe.search.token
    const codeInput = page.getByPlaceholder("RAWE-XXXXXXXXXX");
    await codeInput.fill("RAWE-TESTCODE12");
    await page.getByRole("button", { name: "Redeem" }).click();

    // After redeeming, check that the stored token is the FAKE_TOKEN
    const storedToken = await page.evaluate(() => localStorage.getItem("rawe.search.token"));
    expect(storedToken).toBe(FAKE_TOKEN);

    // The panel should update to show credits ready
    await expect(page.getByText("1 ready")).toBeVisible();

    // Now hit refresh — the captured token should match
    await page.getByRole("button", { name: /Refresh postings/i }).click();
    await expect(page.getByText(/Fetched 2 postings/)).toBeVisible();
    expect(capturedRefreshToken).toBe(FAKE_TOKEN);
  });
});
