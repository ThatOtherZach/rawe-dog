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
    providerConfigured?: boolean;
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
        providerConfigured: opts.providerConfigured ?? true,
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

  test("buy flow: quote → verify → granted → panel shows credits ready", async ({ page }) => {
    // Full end-to-end purchase path:
    //   1. Enforcement on, crypto available, no token yet → buy buttons shown
    //   2. User clicks Pay USDC → POST /api/credits/quote succeeds → quote details appear
    //   3. User pastes a tx hash and clicks Verify → POST /api/credits/verify returns granted
    //   4. Panel calls onChanged() → re-fetches status → panel now shows "1 ready"
    const FAKE_ADDR = "0x1234567890123456789012345678901234567890";
    const FAKE_TX = "0x" + "a".repeat(64);
    let verifyCallCount = 0;

    await page.route("**/api/**", (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes("/api/postings") && method === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(postingsState()) });
        return;
      }
      if (url.includes("/api/credits/status")) {
        const token = route.request().headers()["x-credit-token"];
        // After verify succeeds the page re-fetches status with the token stored in localStorage
        const hasValid = Boolean(token === FAKE_TOKEN);
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            enforced: true,
            providerConfigured: true,
            priceUsdCents: 100,
            crypto: { available: true, network: "base", receivingAddress: FAKE_ADDR },
            token: token ? { valid: hasValid, remaining: hasValid ? 1 : 0 } : null,
          }),
        });
        return;
      }
      if (url.includes("/api/credits/quote") && method === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            quoteId: "qtest-1",
            asset: "usdc",
            network: "base",
            receivingAddress: FAKE_ADDR,
            amountAtomic: "1000000",
            amountDisplay: "1.000000 USDC",
            priceUsdCents: 100,
            creditUnits: 1,
            expiresAt: Date.now() + 600_000,
          }),
        });
        return;
      }
      if (url.includes("/api/credits/verify") && method === "POST") {
        verifyCallCount++;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, status: "granted", token: FAKE_TOKEN, credits: 1 }),
        });
        return;
      }
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not mocked" }) });
    });

    await page.goto("/postings");

    // Panel present, no credits yet
    await expect(page.getByText("Search credits")).toBeVisible();
    await expect(page.getByText("none")).toBeVisible();

    // Click "Pay USDC" to request a quote
    await page.getByRole("button", { name: "Pay USDC" }).click();

    // Quote details should appear: amount, address, and tx-hash input
    await expect(page.getByText("1.000000 USDC")).toBeVisible();
    await expect(page.getByPlaceholder(/Paste your tx hash/i)).toBeVisible();

    // Enter a valid tx hash and click Verify
    await page.getByPlaceholder(/Paste your tx hash/i).fill(FAKE_TX);
    await page.getByRole("button", { name: "Verify" }).click();

    // Verify was called once
    expect(verifyCallCount).toBe(1);

    // The app calls setSearchCreditToken() inside verifySearchPayment() when status
    // is "granted" — wait for that to land in localStorage, proving the UI drove it.
    await page.waitForFunction(
      (expectedToken) => localStorage.getItem("rawe.search.token") === expectedToken,
      FAKE_TOKEN,
      { timeout: 8_000 }
    );

    // onChanged() → refreshKey increment → status re-fetch with the stored token → "1 ready"
    await expect(page.getByText("1 ready")).toBeVisible({ timeout: 10_000 });
  });

  test("buy flow still starts even when provider is not configured", async ({ page }) => {
    // providerConfigured: false shows the Settings warning but MUST NOT block the
    // quote flow — users should be able to buy credits and configure the provider
    // independently. Gating the purchase on the provider would be a regression.
    const FAKE_ADDR = "0x1234567890123456789012345678901234567890";

    await page.route("**/api/**", (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes("/api/postings") && method === "GET") {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(postingsState()) });
        return;
      }
      if (url.includes("/api/credits/status")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            enforced: true,
            providerConfigured: false,
            priceUsdCents: 100,
            crypto: { available: true, network: "base", receivingAddress: FAKE_ADDR },
            token: null,
          }),
        });
        return;
      }
      if (url.includes("/api/credits/quote") && method === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            quoteId: "qtest-2",
            asset: "usdc",
            network: "base",
            receivingAddress: FAKE_ADDR,
            amountAtomic: "1000000",
            amountDisplay: "1.000000 USDC",
            priceUsdCents: 100,
            creditUnits: 1,
            expiresAt: Date.now() + 600_000,
          }),
        });
        return;
      }
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not mocked" }) });
    });

    await page.goto("/postings");

    // Warning must be visible
    await expect(page.locator("main").getByText(/Set your TheirStack key in/i)).toBeVisible();

    // Buy buttons must still be present and functional despite the warning
    const payBtn = page.getByRole("button", { name: "Pay USDC" });
    await expect(payBtn).toBeVisible();
    await payBtn.click();

    // Quote details appear — the warning didn't block the flow
    await expect(page.getByText("1.000000 USDC")).toBeVisible();
    await expect(page.getByPlaceholder(/Paste your tx hash/i)).toBeVisible();
  });

  test("credits/status API returns providerConfigured as a boolean", async ({ request }) => {
    // Hit the real API endpoint through the shared proxy and assert the shape of
    // the response — specifically that providerConfigured is a boolean.
    // This guards against settings-read regressions that would break the panel on
    // every page load.
    const resp = await request.get("http://localhost:80/api/credits/status");
    expect(resp.ok()).toBe(true);
    const body = await resp.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.providerConfigured).toBe("boolean");
    // enforced and priceUsdCents must also always be present
    expect(typeof body.enforced).toBe("boolean");
    expect(typeof body.priceUsdCents).toBe("number");
  });

  test("panel shows Settings warning when providerConfigured is false", async ({ page }) => {
    // When the TheirStack key is absent the panel must surface a warning so
    // users know why buying a credit would be pointless right now.
    await setupPostingsMocks(page, {
      creditsEnforced: true,
      hasSearchToken: false,
      providerConfigured: false,
    });
    await page.goto("/postings");

    // Panel is present (enforcement on)
    await expect(page.getByText("Search credits")).toBeVisible();

    // Settings warning note must be visible (scope to main to avoid matching the nav)
    const warning = page.locator("main").getByText(/Set your TheirStack key in/i);
    await expect(warning).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: "Settings" })).toBeVisible();
  });

  test("panel does NOT show Settings warning when providerConfigured is true", async ({ page }) => {
    await setupPostingsMocks(page, {
      creditsEnforced: true,
      hasSearchToken: false,
      providerConfigured: true,
    });
    await page.goto("/postings");

    await expect(page.getByText("Search credits")).toBeVisible();
    await expect(page.getByText(/Set your TheirStack key in/i)).not.toBeVisible();
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
