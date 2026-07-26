/**
 * LinkedIn PDF import — unit + e2e tests
 *
 * Unit: prompt building (skeleton reuse, text cap, tweak note).
 * E2E: Library page "Import LinkedIn" button → instruction step → PDF pick →
 * draft review → accept saves Master-Profile.md; regenerate-with-note re-posts;
 * server error surfaces and returns to the picker.
 *
 * All API calls are intercepted via page.route() — no real model calls.
 */
import { test, expect, type Page, type Route } from "@playwright/test";

// ---------------------------------------------------------------------------
// Unit tests (no browser)
// ---------------------------------------------------------------------------

test("buildLinkedInImportMessages reuses the master-profile skeleton and caps text", async () => {
  const lib = (await import("../../artifacts/api-server/src/lib/compose.js")) as {
    buildLinkedInImportMessages: (
      text: string,
      tweakNote?: string
    ) => { system: string; user: string };
    STARTER_SKELETONS: Record<string, string>;
    MAX_LINKEDIN_TEXT_CHARS: number;
  };

  const { system, user } = lib.buildLinkedInImportMessages("Jane Doe\nEngineer at Acme");
  expect(system).toContain("LinkedIn");
  expect(system).toContain('First line must be "# <the person\'s name>"');
  // Skeleton is embedded, not duplicated in a parallel prompt system.
  expect(user).toContain(lib.STARTER_SKELETONS["master-profile"].trim());
  expect(user).toContain("Jane Doe\nEngineer at Acme");
  expect(user).not.toContain("REVISION REQUEST");

  // Oversized text is truncated to the cap.
  const big = "x".repeat(lib.MAX_LINKEDIN_TEXT_CHARS + 5000);
  const capped = lib.buildLinkedInImportMessages(big);
  expect(capped.user.length).toBeLessThan(big.length);

  // Tweak note appended when present.
  const tweaked = lib.buildLinkedInImportMessages("text", "shorter");
  expect(tweaked.user).toContain("REVISION REQUEST");
  expect(tweaked.user).toContain("shorter");
});

// ---------------------------------------------------------------------------
// E2E — Library page with intercepted API
// ---------------------------------------------------------------------------

type FileMeta = {
  id: string;
  slot: string;
  originalName: string;
  size: number;
  updatedAt: string;
  kind: string;
};

type MockState = {
  hasApiKey: boolean;
  files: Record<string, FileMeta[]>;
  importResponses: { status: number; body: unknown }[];
  importRequestCount: number;
};

function makeState(overrides: Partial<MockState> = {}): MockState {
  return { hasApiKey: true, files: {}, importResponses: [], importRequestCount: 0, ...overrides };
}

function libraryPayload(state: MockState) {
  return {
    slots: [
      { slot: "resume-template", label: "Resume template", multi: false, required: true },
      { slot: "cover-template", label: "Cover letter template", multi: false, required: true },
      { slot: "master-profile", label: "Master Profile", multi: false, required: true },
      { slot: "experience", label: "Workplace experience", multi: true, required: true },
      {
        slot: "system-instructions",
        label: "Custom system instructions",
        multi: false,
        required: false,
      },
    ],
    files: state.files,
    readiness: {
      ready: false,
      masterProfile: (state.files["master-profile"] || []).length > 0,
      experienceCount: 0,
      resumeTemplate: false,
      coverTemplate: false,
    },
  };
}

let fileSeq = 0;

async function installMocks(page: Page, state: MockState) {
  // Echo FormData file/slot names via test-only headers (devtools can't read blob bodies).
  await page.addInitScript(() => {
    const orig = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const body = init?.body;
      if (body instanceof FormData) {
        const file = body.get("file");
        if (file instanceof File) {
          init = {
            ...init,
            headers: {
              ...(init?.headers as Record<string, string> | undefined),
              "x-test-upload-slot": String(body.get("slot") ?? ""),
              "x-test-upload-name": encodeURIComponent(file.name),
              "x-test-tweak": encodeURIComponent(String(body.get("tweakNote") ?? "")),
            },
          };
        }
      }
      return orig(input, init);
    };
  });

  await page.route(
    (url) => url.pathname === "/api/settings",
    (route: Route) =>
      route.fulfill({
        json: {
          hasApiKey: state.hasApiKey,
          apiKeyMasked: state.hasApiKey ? "xai-…abcd" : "",
          model: "grok-4.5",
          selectionModel: "",
          verificationModel: "",
          hasTheirstackKey: false,
          theirstackKeyMasked: "",
          apiEndpoint: "",
        },
      })
  );

  await page.route(
    (url) => url.pathname === "/api/library/import-linkedin",
    async (route: Route) => {
      state.importRequestCount += 1;
      const next =
        state.importResponses.shift() ||
        ({ status: 500, body: { error: "mock exhausted" } } as const);
      await route.fulfill({ status: next.status, json: next.body });
    }
  );

  await page.route(
    (url) => url.pathname === "/api/library",
    async (route: Route) => {
      const req = route.request();
      if (req.method() === "POST") {
        const headers = req.headers();
        const slot = headers["x-test-upload-slot"] || "unknown";
        const name = decodeURIComponent(headers["x-test-upload-name"] || "unknown.md");
        const meta: FileMeta = {
          id: `mock-${++fileSeq}`,
          slot,
          originalName: name,
          size: 1,
          updatedAt: new Date().toISOString(),
          kind: "md",
        };
        state.files[slot] = [meta];
        await route.fulfill({ json: { ok: true } });
        return;
      }
      await route.fulfill({ json: libraryPayload(state) });
    }
  );
}

const FAKE_PDF = {
  name: "Profile.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4 fake"),
};

const DRAFT_MD = "# Jane Doe\n\n## Contact & Links\n\n- Email: jane@example.com";

test("import LinkedIn: pick PDF → review → accept saves Master-Profile.md", async ({
  page,
}) => {
  const state = makeState({
    importResponses: [{ status: 200, body: { ok: true, markdown: DRAFT_MD, model: "grok-4.5" } }],
  });
  await installMocks(page, state);
  await page.goto("/library");

  // Button exists only on the Master Profile card.
  await expect(page.getByTestId("linkedin-import-open")).toHaveCount(1);
  await page.getByTestId("linkedin-import-open").click();

  // Instruction step with the Save to PDF walkthrough.
  await expect(page.getByTestId("linkedin-import-step")).toBeVisible();
  await expect(page.getByTestId("linkedin-import-step")).toContainText("Save to PDF");

  await page.getByTestId("linkedin-file-input").setInputFiles(FAKE_PDF);

  await expect(page.getByTestId("compose-review")).toBeVisible();
  await expect(page.getByTestId("compose-review")).toContainText("Jane Doe");

  await page.getByTestId("compose-accept").click();
  await expect(page.getByTestId("compose-wizard")).toHaveCount(0);
  expect(state.files["master-profile"]?.[0]?.originalName).toBe("Master-Profile.md");
});

test("import LinkedIn: regenerate re-posts the same PDF with the tweak note", async ({
  page,
}) => {
  const state = makeState({
    importResponses: [
      { status: 200, body: { ok: true, markdown: DRAFT_MD, model: "grok-4.5" } },
      { status: 200, body: { ok: true, markdown: "# Jane Doe\n\nShorter.", model: "grok-4.5" } },
    ],
  });
  await installMocks(page, state);
  await page.goto("/library");

  await page.getByTestId("linkedin-import-open").click();
  await page.getByTestId("linkedin-file-input").setInputFiles(FAKE_PDF);
  await expect(page.getByTestId("compose-review")).toBeVisible();

  await page.getByTestId("compose-tweak").fill("shorter");
  await page.getByTestId("compose-regenerate").click();

  await expect(page.getByTestId("compose-review")).toContainText("Shorter.");
  expect(state.importRequestCount).toBe(2);
});

test("import LinkedIn: server error surfaces and returns to the picker", async ({
  page,
}) => {
  const state = makeState({
    importResponses: [
      { status: 400, body: { error: "No text could be extracted from that PDF" } },
    ],
  });
  await installMocks(page, state);
  await page.goto("/library");

  await page.getByTestId("linkedin-import-open").click();
  await page.getByTestId("linkedin-file-input").setInputFiles(FAKE_PDF);

  await expect(page.getByTestId("compose-error")).toContainText("No text could be extracted");
  // Back on the picker so the user can retry with a different file.
  await expect(page.getByTestId("linkedin-import-step")).toBeVisible();
});
