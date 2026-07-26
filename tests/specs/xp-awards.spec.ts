/**
 * XP awards and achievement toast tests
 *
 * Three groups:
 *   1. Unit-style — xpStore logic exercised in-browser via dynamic import and
 *      page.evaluate(); localStorage is the source of truth so all mutations
 *      are real (not mocked).
 *   2. XpWidget visibility — confirms the widget hides until the first kit is
 *      ever generated, then appears after the xp_updated event fires.
 *   3. Kit-generation e2e — mocks the /api/generate SSE endpoint so the
 *      "done" event fires, then confirms XP is awarded and the widget appears.
 *
 * All real server calls are blocked by a catch-all route mock.
 */
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Block every real API call (we only want localStorage / in-browser logic). */
async function blockApi(page: Page) {
  await page.route("**/api/**", (route) => {
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "not mocked" }),
    });
  });
}

/** Return a healthy /api/health response so the generate form is usable. */
const HEALTHY_RESPONSE = {
  settings: { hasApiKey: true, model: "grok-3" },
  library: {
    ready: true,
    masterProfile: true,
    experienceCount: 2,
    resumeTemplate: true,
    coverTemplate: true,
    systemInstructions: false,
  },
};

/**
 * Build a minimal SSE body that fires one "done" event containing a valid kit.
 * The generate page splits on "\n\n" and looks for lines starting with "data: ".
 */
function buildSseDoneBody(): string {
  const doneEvent = {
    type: "done",
    kit: {
      meta: {
        targetTitle: "Software Engineer",
        company: "Acme Corp",
        leadExperiences: ["Senior Dev at Widgets Inc"],
        rationale: "Strong technical match.",
      },
      resumeMarkdown: "# Resume\n\nExperience here.",
      coverLetterMarkdown: "# Cover Letter\n\nDear Hiring Manager,",
      alignmentNotesMarkdown: "# Alignment\n\n- React: strong match.",
      starPrepMarkdown: "# STAR Prep\n\n**Situation:** ...",
    },
    selection: {
      targetTitle: "Software Engineer",
      company: "Acme Corp",
      leadExperienceIds: ["exp-1"],
      supportingExperienceIds: [],
      leadExperiences: ["Senior Dev at Widgets Inc"],
      supportingExperiences: [],
      keywordsToHit: ["React", "TypeScript"],
      rationale: "Strong match.",
    },
    experienceOptions: [
      { id: "exp-1", catalogId: "exp-1", title: "Senior Dev", fileName: "exp1.md" },
    ],
    qaReport: {
      verdict: "pass",
      summary: "No issues found.",
      findings: [],
      keywordCoverage: [],
      repairedDocuments: [],
      counts: { major: 0, minor: 0, info: 0 },
      verifierRan: false,
    },
    stats: { durationMs: 3000 },
  };

  return `data: ${JSON.stringify(doneEvent)}\n\n`;
}

// ---------------------------------------------------------------------------
// 1. Unit-style xpStore logic
// ---------------------------------------------------------------------------

test.describe("xpStore — core XP logic", () => {
  test.beforeEach(async ({ page }) => {
    await blockApi(page);
    await page.goto("/");
    // Start each test with a clean profile
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test("kit_generated awards 25 XP and increments kitsGenerated", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("kit_generated");
      const p = loadProfile();
      return { xp: p.xp, kits: p.stats.kitsGenerated };
    });
    expect(result.xp).toBe(25);
    expect(result.kits).toBe(1);
  });

  test("kit_generated sets LS_KIT_EVER_KEY", async ({ page }) => {
    const kitEver = await page.evaluate(async () => {
      const { awardXp, LS_KIT_EVER_KEY } = await import("/src/lib/xpStore.ts");
      awardXp("kit_generated");
      return localStorage.getItem(LS_KIT_EVER_KEY);
    });
    expect(kitEver).toBe("1");
  });

  test("applied awards 100 XP + 50 daily bonus on the first apply of the day", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("applied");
      const p = loadProfile();
      return { xp: p.xp, applications: p.stats.applicationsTotal };
    });
    // 100 base + 50 daily first-apply bonus
    expect(result.xp).toBe(150);
    expect(result.applications).toBe(1);
  });

  test("daily bonus is not awarded twice on the same day", async ({ page }) => {
    const xpAfterTwo = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("applied");
      awardXp("applied");
      return loadProfile().xp;
    });
    // First apply: 100 + 50 daily = 150; second apply: 100 (no bonus again today)
    expect(xpAfterTwo).toBe(250);
  });

  test("dismiss awards 5 XP and increments dismissalsTotal", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("dismiss");
      const p = loadProfile();
      return { xp: p.xp, dismissals: p.stats.dismissalsTotal };
    });
    expect(result.xp).toBe(5);
    expect(result.dismissals).toBe(1);
  });

  test("paid_search awards 50 XP and increments paidSearchesTotal", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("paid_search");
      const p = loadProfile();
      return { xp: p.xp, searches: p.stats.paidSearchesTotal };
    });
    expect(result.xp).toBe(50);
    expect(result.searches).toBe(1);
  });

  test("compose_doc awards 30 XP and increments knowledgeDocsComposed", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("compose_doc");
      const p = loadProfile();
      return { xp: p.xp, docs: p.stats.knowledgeDocsComposed };
    });
    expect(result.xp).toBe(30);
    expect(result.docs).toBe(1);
  });

  test("file_upload awards 20 XP and increments filesUploaded", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("file_upload");
      const p = loadProfile();
      return { xp: p.xp, files: p.stats.filesUploaded };
    });
    expect(result.xp).toBe(20);
    expect(result.files).toBe(1);
  });

  test("filter_change awards 0 XP but increments filterChanges", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("filter_change");
      const p = loadProfile();
      return { xp: p.xp, changes: p.stats.filterChanges };
    });
    expect(result.xp).toBe(0);
    expect(result.changes).toBe(1);
  });

  test("api_key_saved awards XP only the first time", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      // XP_VALUES doesn't define api_key_saved so xpGained starts at 0,
      // but it sets firstApiKeySaved = true and the achievement fires.
      awardXp("api_key_saved");
      const afterFirst = loadProfile().xp;
      awardXp("api_key_saved"); // second time — no-op on XP
      const afterSecond = loadProfile().xp;
      return { afterFirst, afterSecond };
    });
    // Both calls produce the same XP (0 base; achievement unlocks once)
    expect(result.afterFirst).toBe(result.afterSecond);
  });

  test("data_wipe, profile_exported, profile_imported, csv_exported award 0 XP", async ({
    page,
  }) => {
    const xp = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("data_wipe");
      awardXp("profile_exported");
      awardXp("profile_imported");
      awardXp("csv_exported");
      return loadProfile().xp;
    });
    expect(xp).toBe(0);
  });

  test("full-loop bonus: paid_search + kit_generated + applied for same posting adds 75 extra XP", async ({
    page,
  }) => {
    const xp = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      const postingId = "posting-abc";
      awardXp("paid_search", { postingId });       // 50 XP, marks paidSearchRan
      awardXp("kit_generated", { postingId });     // 25 XP, records kit timestamp
      awardXp("applied", { postingId });           // 100 + 50 daily + 75 full-loop = 225 XP
      return loadProfile().xp;
    });
    // 50 (search) + 25 (kit) + 100 (apply) + 50 (daily bonus) + 75 (full-loop) = 300
    expect(xp).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// 2. Level and progress helpers
// ---------------------------------------------------------------------------

test.describe("xpStore — level helpers", () => {
  test.beforeEach(async ({ page }) => {
    await blockApi(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test("levelForXp returns Unpaid Intern at 0 XP", async ({ page }) => {
    const name = await page.evaluate(async () => {
      const { levelForXp } = await import("/src/lib/xpStore.ts");
      return levelForXp(0).name;
    });
    expect(name).toBe("Unpaid Intern");
  });

  test("levelForXp returns New Hire at 100 XP", async ({ page }) => {
    const name = await page.evaluate(async () => {
      const { levelForXp } = await import("/src/lib/xpStore.ts");
      return levelForXp(100).name;
    });
    expect(name).toBe("New Hire");
  });

  test("levelForXp returns the top level at very high XP", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { levelForXp, LEVELS } = await import("/src/lib/xpStore.ts");
      const topLevel = LEVELS[LEVELS.length - 1];
      return { name: levelForXp(topLevel.min + 1000).name, top: topLevel.name };
    });
    expect(result.name).toBe(result.top);
  });

  test("xpProgress returns pct 0 at level minimum", async ({ page }) => {
    const pct = await page.evaluate(async () => {
      const { xpProgress, LEVELS } = await import("/src/lib/xpStore.ts");
      // Start of second level (New Hire) — should be 0 progress into that band
      return xpProgress(LEVELS[1].min).pct;
    });
    expect(pct).toBe(0);
  });

  test("xpProgress returns pct 1 at max level", async ({ page }) => {
    const pct = await page.evaluate(async () => {
      const { xpProgress, LEVELS } = await import("/src/lib/xpStore.ts");
      return xpProgress(LEVELS[LEVELS.length - 1].min).pct;
    });
    expect(pct).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Achievement unlocks
// ---------------------------------------------------------------------------

test.describe("xpStore — achievement unlocks", () => {
  test.beforeEach(async ({ page }) => {
    await blockApi(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test("'memo' unlocks after first application", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("applied");
      return loadProfile().achievements.some((a) => a.id === "memo");
    });
    expect(unlocked).toBe(true);
  });

  test("'pc_load_letter' unlocks after first dismiss", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("dismiss");
      return loadProfile().achievements.some((a) => a.id === "pc_load_letter");
    });
    expect(unlocked).toBe(true);
  });

  test("'case_of_mondays' unlocks after first paid search", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("paid_search");
      return loadProfile().achievements.some((a) => a.id === "case_of_mondays");
    });
    expect(unlocked).toBe(true);
  });

  test("'burned_it_down' unlocks after data_wipe", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("data_wipe");
      return loadProfile().achievements.some((a) => a.id === "burned_it_down");
    });
    expect(unlocked).toBe(true);
  });

  test("'taking_it_with_you' unlocks after profile_exported", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("profile_exported");
      return loadProfile().achievements.some((a) => a.id === "taking_it_with_you");
    });
    expect(unlocked).toBe(true);
  });

  test("'imported_goods' unlocks after profile_imported", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("profile_imported");
      return loadProfile().achievements.some((a) => a.id === "imported_goods");
    });
    expect(unlocked).toBe(true);
  });

  test("'paper_trail' unlocks after csv_exported", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("csv_exported");
      return loadProfile().achievements.some((a) => a.id === "paper_trail");
    });
    expect(unlocked).toBe(true);
  });

  test("'not_the_singer' unlocks after 10 kits generated", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      for (let i = 0; i < 10; i++) awardXp("kit_generated");
      return loadProfile().achievements.some((a) => a.id === "not_the_singer");
    });
    expect(unlocked).toBe(true);
  });

  test("'miltons_stapler' unlocks after 5 kits with 0 applications", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      for (let i = 0; i < 5; i++) awardXp("kit_generated");
      return loadProfile().achievements.some((a) => a.id === "miltons_stapler");
    });
    expect(unlocked).toBe(true);
  });

  test("'miltons_stapler' does NOT unlock once an application exists", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("applied");
      for (let i = 0; i < 5; i++) awardXp("kit_generated");
      return loadProfile().achievements.some((a) => a.id === "miltons_stapler");
    });
    expect(unlocked).toBe(false);
  });

  test("'basement' unlocks after 3 filter changes", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("filter_change");
      awardXp("filter_change");
      awardXp("filter_change");
      return loadProfile().achievements.some((a) => a.id === "basement");
    });
    expect(unlocked).toBe(true);
  });

  test("'derive_filters' unlocks after derive_filters event", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("derive_filters");
      return loadProfile().achievements.some((a) => a.id === "derive_filters");
    });
    expect(unlocked).toBe(true);
  });

  test("'setup_api' unlocks after api_key_saved", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("api_key_saved");
      return loadProfile().achievements.some((a) => a.id === "setup_api");
    });
    expect(unlocked).toBe(true);
  });

  test("'flair' unlocks after 15 applications", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      for (let i = 0; i < 15; i++) awardXp("applied");
      return loadProfile().achievements.some((a) => a.id === "flair");
    });
    expect(unlocked).toBe(true);
  });

  test("'delegated' unlocks after 20 dismissals", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      for (let i = 0; i < 20; i++) awardXp("dismiss");
      return loadProfile().achievements.some((a) => a.id === "delegated");
    });
    expect(unlocked).toBe(true);
  });

  test("'move_fast' unlocks when applied within 1 hour of kit generation for same posting", async ({
    page,
  }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      const postingId = "posting-fast";
      awardXp("kit_generated", { postingId });
      awardXp("applied", { postingId });
      return loadProfile().achievements.some((a) => a.id === "move_fast");
    });
    expect(unlocked).toBe(true);
  });

  test("'laser_focused' unlocks after 3 high-score (80+) applications", async ({ page }) => {
    const unlocked = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("applied", { fitScore: 85 });
      awardXp("applied", { fitScore: 92 });
      awardXp("applied", { fitScore: 80 });
      return loadProfile().achievements.some((a) => a.id === "laser_focused");
    });
    expect(unlocked).toBe(true);
  });

  test("achievements are not double-unlocked on repeated calls", async ({ page }) => {
    const count = await page.evaluate(async () => {
      const { awardXp, loadProfile } = await import("/src/lib/xpStore.ts");
      awardXp("applied");
      awardXp("applied");
      awardXp("applied");
      return loadProfile().achievements.filter((a) => a.id === "memo").length;
    });
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Custom event dispatch
// ---------------------------------------------------------------------------

test.describe("xpStore — event dispatch", () => {
  test.beforeEach(async ({ page }) => {
    await blockApi(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test("rawedog:xp_updated fires after awardXp", async ({ page }) => {
    const fired = await page.evaluate(async () => {
      const { awardXp } = await import("/src/lib/xpStore.ts");
      let eventFired = false;
      window.addEventListener("rawedog:xp_updated", () => {
        eventFired = true;
      });
      awardXp("kit_generated");
      return eventFired;
    });
    expect(fired).toBe(true);
  });

  test("rawedog:achievement fires with the correct achievement on first apply", async ({
    page,
  }) => {
    const achievementId = await page.evaluate(async () => {
      const { awardXp } = await import("/src/lib/xpStore.ts");
      let receivedId: string | null = null;
      window.addEventListener("rawedog:achievement", (e) => {
        const ev = e as CustomEvent<{ achievement: { id: string } }>;
        // 'memo' is the first-application achievement
        if (ev.detail.achievement.id === "memo") {
          receivedId = ev.detail.achievement.id;
        }
      });
      awardXp("applied");
      return receivedId;
    });
    expect(achievementId).toBe("memo");
  });

  test("rawedog:achievement fires 'burned_it_down' on data_wipe", async ({ page }) => {
    const achievementId = await page.evaluate(async () => {
      const { awardXp } = await import("/src/lib/xpStore.ts");
      let receivedId: string | null = null;
      window.addEventListener("rawedog:achievement", (e) => {
        const ev = e as CustomEvent<{ achievement: { id: string } }>;
        receivedId = ev.detail.achievement.id;
      });
      awardXp("data_wipe");
      return receivedId;
    });
    expect(achievementId).toBe("burned_it_down");
  });
});

// ---------------------------------------------------------------------------
// 5. Export / import merge
// ---------------------------------------------------------------------------

test.describe("xpStore — export / import merge", () => {
  test.beforeEach(async ({ page }) => {
    await blockApi(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test("import keeps the higher XP value", async ({ page }) => {
    const xp = await page.evaluate(async () => {
      const { awardXp, importProfile, loadProfile } = await import(
        "/src/lib/xpStore.ts"
      );
      // Seed current profile with 50 XP
      awardXp("paid_search"); // 50 XP
      // Build an import file with 500 XP
      const blob = new Blob(
        [
          JSON.stringify({
            xp: 500,
            achievements: [],
            eventLog: [],
            exportedAt: new Date().toISOString(),
          }),
        ],
        { type: "application/json" }
      );
      const file = new File([blob], "profile.json", {
        type: "application/json",
      });
      await importProfile(file);
      return loadProfile().xp;
    });
    expect(xp).toBe(500);
  });

  test("import keeps the current XP when it is higher", async ({ page }) => {
    const xp = await page.evaluate(async () => {
      const { awardXp, importProfile, loadProfile } = await import(
        "/src/lib/xpStore.ts"
      );
      // Seed 500 XP
      for (let i = 0; i < 5; i++) awardXp("applied"); // 5 × 100 + 1 daily bonus = 550
      const currentXp = loadProfile().xp;
      // Try to import a profile with only 10 XP
      const blob = new Blob(
        [
          JSON.stringify({
            xp: 10,
            achievements: [],
            eventLog: [],
            exportedAt: new Date().toISOString(),
          }),
        ],
        { type: "application/json" }
      );
      const file = new File([blob], "profile.json", {
        type: "application/json",
      });
      await importProfile(file);
      return { after: loadProfile().xp, before: currentXp };
    });
    expect(xp.after).toBe(xp.before);
  });

  test("import unions achievements — imported achievements are added to current", async ({
    page,
  }) => {
    const ids = await page.evaluate(async () => {
      const { awardXp, importProfile, loadProfile } = await import(
        "/src/lib/xpStore.ts"
      );
      // Current profile has 'dismiss' achievement
      awardXp("dismiss"); // unlocks pc_load_letter
      // Imported profile has 'applied' achievement
      const now = new Date().toISOString();
      const blob = new Blob(
        [
          JSON.stringify({
            xp: 0,
            achievements: [{ id: "memo", unlockedAt: now }],
            eventLog: [],
            exportedAt: now,
          }),
        ],
        { type: "application/json" }
      );
      const file = new File([blob], "profile.json", {
        type: "application/json",
      });
      await importProfile(file);
      return loadProfile().achievements.map((a) => a.id);
    });
    expect(ids).toContain("pc_load_letter");
    expect(ids).toContain("memo");
  });

  test("import sets LS_KIT_EVER_KEY when imported XP is > 0", async ({ page }) => {
    const kitEver = await page.evaluate(async () => {
      const { importProfile, LS_KIT_EVER_KEY } = await import(
        "/src/lib/xpStore.ts"
      );
      const blob = new Blob(
        [
          JSON.stringify({
            xp: 250,
            achievements: [],
            eventLog: [],
            exportedAt: new Date().toISOString(),
          }),
        ],
        { type: "application/json" }
      );
      const file = new File([blob], "profile.json", {
        type: "application/json",
      });
      await importProfile(file);
      return localStorage.getItem(LS_KIT_EVER_KEY);
    });
    expect(kitEver).toBe("1");
  });

  test("import rejects a malformed JSON file", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { importProfile } = await import("/src/lib/xpStore.ts");
      const blob = new Blob(["not json at all"], {
        type: "application/json",
      });
      const file = new File([blob], "bad.json", { type: "application/json" });
      return importProfile(file);
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("import rejects a file that is valid JSON but missing required fields", async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const { importProfile } = await import("/src/lib/xpStore.ts");
      const blob = new Blob([JSON.stringify({ foo: "bar" })], {
        type: "application/json",
      });
      const file = new File([blob], "wrong.json", {
        type: "application/json",
      });
      return importProfile(file);
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. XpWidget visibility
// ---------------------------------------------------------------------------

/**
 * Wire up a minimal health mock so the GeneratePage renders cleanly
 * (without it the health 404 sets an unexpectedly-shaped state object that
 * crashes the component and tears down the React tree, preventing XpWidget
 * from responding to events).
 */
async function setupWidgetPageMocks(page: Page) {
  await page.route("**/api/**", (route) => {
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "not mocked" }),
    });
  });
  await page.route("**/api/health", (route) => {
    if (route.request().method() !== "GET") { route.fallback(); return; }
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(HEALTHY_RESPONSE),
    });
  });
}

test.describe("XpWidget visibility", () => {
  test("widget is hidden when no kit has ever been generated", async ({ page }) => {
    // Do NOT set LS_KIT_EVER_KEY — fresh context has clean localStorage
    await setupWidgetPageMocks(page);
    await page.goto("/");
    // XpWidget returns null until LS_KIT_EVER_KEY === "1"
    await expect(page.getByTitle("Your XP profile")).not.toBeVisible();
  });

  test("widget appears on load when LS_KIT_EVER_KEY is pre-set", async ({ page }) => {
    // Inject localStorage state before the page mounts so XpWidget sees it on
    // initial render (tests the mount-time branch of useXpProfile).
    await page.addInitScript(() => {
      const LS_KIT_EVER_KEY = "rawedog_kit_ever_generated";
      const LS_PROFILE_KEY = "rawedog_profile";
      localStorage.setItem(LS_KIT_EVER_KEY, "1");
      localStorage.setItem(
        LS_PROFILE_KEY,
        JSON.stringify({
          xp: 25,
          achievements: [],
          eventLog: [{ type: "kit_generated", at: new Date().toISOString() }],
          stats: {
            kitsGenerated: 1,
            applicationsTotal: 0,
            dismissalsTotal: 0,
            paidSearchesTotal: 0,
            knowledgeDocsComposed: 0,
            filesUploaded: 0,
            filterChanges: 0,
            firstApiKeySaved: false,
            deriveFiltersUsed: false,
            highScoreApplications: 0,
            lastActivityAt: new Date().toISOString(),
          },
        })
      );
    });
    await setupWidgetPageMocks(page);
    await page.goto("/");

    const widget = page.getByTitle("Your XP profile");
    await expect(widget).toBeVisible();
    await expect(widget).toContainText("25 XP");
  });

  test("widget shows the correct level name when XP is at Unpaid Intern range", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("rawedog_kit_ever_generated", "1");
      localStorage.setItem(
        "rawedog_profile",
        JSON.stringify({
          xp: 25,
          achievements: [],
          eventLog: [],
          stats: {
            kitsGenerated: 1,
            applicationsTotal: 0,
            dismissalsTotal: 0,
            paidSearchesTotal: 0,
            knowledgeDocsComposed: 0,
            filesUploaded: 0,
            filterChanges: 0,
            firstApiKeySaved: false,
            deriveFiltersUsed: false,
            highScoreApplications: 0,
            lastActivityAt: null,
          },
        })
      );
    });
    await setupWidgetPageMocks(page);
    await page.goto("/");

    const widget = page.getByTitle("Your XP profile");
    await expect(widget).toBeVisible();
    await expect(widget).toContainText("Unpaid Intern");
  });

  test("widget shows updated XP after additional awards fire xp_updated", async ({
    page,
  }) => {
    // Start with an already-visible widget (kit was generated in a prior session)
    await page.addInitScript(() => {
      localStorage.setItem("rawedog_kit_ever_generated", "1");
      localStorage.setItem(
        "rawedog_profile",
        JSON.stringify({
          xp: 25,
          achievements: [],
          eventLog: [],
          stats: {
            kitsGenerated: 1,
            applicationsTotal: 0,
            dismissalsTotal: 0,
            paidSearchesTotal: 0,
            knowledgeDocsComposed: 0,
            filesUploaded: 0,
            filterChanges: 0,
            firstApiKeySaved: false,
            deriveFiltersUsed: false,
            highScoreApplications: 0,
            lastActivityAt: null,
          },
        })
      );
    });
    await setupWidgetPageMocks(page);
    await page.goto("/");

    const widget = page.getByTitle("Your XP profile");
    await expect(widget).toBeVisible();
    await expect(widget).toContainText("25 XP");

    // Award more XP — the xp_updated event should trigger a re-render
    await page.evaluate(async () => {
      const { awardXp } = await import("/src/lib/xpStore.ts");
      awardXp("paid_search"); // +50 XP → total 75 XP
    });

    // Widget must refresh to show the new total
    await expect(widget).toContainText("75 XP");
  });
});

// ---------------------------------------------------------------------------
// 7. Kit generation XP — end-to-end via SSE mock
// ---------------------------------------------------------------------------

test.describe("kit generation XP — e2e", () => {
  /**
   * Wire up the generate page: health returns "ready", generate returns an
   * immediate SSE done event, everything else is blocked.
   */
  async function setupGenerateMocks(page: Page) {
    // Catch-all: reject unrecognised routes
    await page.route("**/api/**", (route) => {
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "not mocked" }),
      });
    });

    // GET /api/health — library ready, API key present
    await page.route("**/api/health", (route) => {
      if (route.request().method() !== "GET") { route.fallback(); return; }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(HEALTHY_RESPONSE),
      });
    });

    // POST /api/generate — returns a single SSE done event
    await page.route("**/api/generate", (route) => {
      if (route.request().method() !== "POST") { route.fallback(); return; }
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: buildSseDoneBody(),
      });
    });
  }

  test("XP is awarded and widget appears after the SSE done event fires", async ({ page }) => {
    await setupGenerateMocks(page);
    await page.goto("/");

    // Clean slate so the widget starts hidden
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Widget should be hidden initially
    await expect(page.getByTitle("Your XP profile")).not.toBeVisible();

    // Fill the job description and submit
    const textarea = page.getByPlaceholder("Paste the full job description here…");
    await textarea.fill(
      "We are looking for a Software Engineer to join our team at Acme Corp. " +
        "You will build scalable systems using React and TypeScript."
    );

    const generateBtn = page.getByRole("button", { name: /Generate \(Auto\)/i });
    await generateBtn.click();

    // Wait for the kit to be done — "Kit ready." appears in the status bar
    await expect(page.getByText("Kit ready.")).toBeVisible({ timeout: 15_000 });

    // The widget must now be visible and show XP
    const widget = page.getByTitle("Your XP profile");
    await expect(widget).toBeVisible();
    await expect(widget).toContainText("XP");
  });

  test("XP store reflects kit_generated stat after SSE done event", async ({ page }) => {
    await setupGenerateMocks(page);
    await page.goto("/");

    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    const textarea = page.getByPlaceholder("Paste the full job description here…");
    await textarea.fill("Software Engineer role at Acme Corp using React and TypeScript.");

    await page.getByRole("button", { name: /Generate \(Auto\)/i }).click();
    await expect(page.getByText("Kit ready.")).toBeVisible({ timeout: 15_000 });

    const stats = await page.evaluate(async () => {
      const { loadProfile } = await import("/src/lib/xpStore.ts");
      const p = loadProfile();
      return { xp: p.xp, kits: p.stats.kitsGenerated };
    });

    expect(stats.kits).toBe(1);
    expect(stats.xp).toBe(25); // kit_generated = 25 XP
  });
});
