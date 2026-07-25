/**
 * Wipe type-to-confirm tests
 *
 * Verifies the danger-zone "Delete all my data" button on /settings is
 * disabled until the exact phrase "delete my data" is typed, and that a
 * successful wipe renders the per-area success UI with no error banner.
 *
 * All API calls are intercepted via page.route() — no real server calls.
 *
 * Route ordering note: Playwright matches routes in LIFO order (last
 * registered = first matched). Specific routes must be registered AFTER
 * the catch-all so they win.
 */
import { test, expect, type Page } from "@playwright/test";

const SETTINGS_PAYLOAD = {
  hasApiKey: false,
  apiKeyMasked: "",
  model: "grok-4.5",
  selectionModel: "",
  verificationModel: "",
  hasTheirstackKey: false,
  theirstackKeyMasked: "",
  apiEndpoint: "",
};

const WIPE_OK_PAYLOAD = {
  library: { ok: true },
  postings: { ok: true, skipped: true },
  settings: { ok: true },
  allOk: true,
};

async function setupApiMocks(page: Page) {
  let wipeCalls = 0;

  // 1. Catch-all: block all other /api/** requests. Registered FIRST →
  //    matched LAST in LIFO order.
  await page.route("**/api/**", (route) => {
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "not mocked" }),
    });
  });

  // 2. GET /api/settings — minimal public settings.
  await page.route("**/api/settings", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SETTINGS_PAYLOAD),
    });
  });

  // 3. DELETE /api/wipe — successful wipe. Registered LAST → wins.
  await page.route("**/api/wipe", (route) => {
    if (route.request().method() !== "DELETE") {
      return route.fulfill({
        status: 405,
        contentType: "application/json",
        body: JSON.stringify({ error: "method not allowed" }),
      });
    }
    wipeCalls++;
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(WIPE_OK_PAYLOAD),
    });
  });

  return { getWipeCalls: () => wipeCalls };
}

test.describe("Wipe type-to-confirm guard", () => {
  test("button stays disabled until the exact phrase is typed, then wipe succeeds", async ({
    page,
  }) => {
    const mocks = await setupApiMocks(page);
    await page.goto("/settings");

    // Scroll to the danger zone
    const dangerZone = page
      .locator("section")
      .filter({ hasText: "Danger zone" });
    await dangerZone.scrollIntoViewIfNeeded();
    await expect(dangerZone).toBeVisible();

    const wipeButton = dangerZone.getByRole("button", {
      name: "Delete all my data",
    });
    const confirmInput = dangerZone.getByPlaceholder("delete my data");

    // Disabled by default (empty input)
    await expect(wipeButton).toBeDisabled();

    // Partial phrase — still disabled
    await confirmInput.fill("delete");
    await expect(wipeButton).toBeDisabled();

    // Wrong phrase (superset) — still disabled
    await confirmInput.fill("delete my data!");
    await expect(wipeButton).toBeDisabled();

    // Wrong case — still disabled (exact match required)
    await confirmInput.fill("Delete My Data");
    await expect(wipeButton).toBeDisabled();

    // Exact phrase — enabled
    await confirmInput.fill("delete my data");
    await expect(wipeButton).toBeEnabled();

    // Submit and confirm the API was hit and returned allOk: true
    const wipeResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/wipe") &&
        res.request().method() === "DELETE"
    );
    await wipeButton.click();
    const wipeResponse = await wipeResponsePromise;
    expect(wipeResponse.status()).toBe(200);
    expect((await wipeResponse.json()).allOk).toBe(true);
    expect(mocks.getWipeCalls()).toBe(1);

    // Per-area success UI renders
    await expect(
      dangerZone.getByText("All data wiped successfully.")
    ).toBeVisible();
    await expect(dangerZone.getByText(/Library files:/)).toBeVisible();
    await expect(dangerZone.getByText(/Postings cache:/)).toBeVisible();
    await expect(dangerZone.getByText(/Saved settings:/)).toBeVisible();

    // No error banner
    await expect(
      dangerZone.getByText("Wipe completed with errors.")
    ).not.toBeVisible();
    await expect(dangerZone.getByText(/✗ error/)).not.toBeVisible();
  });
});
