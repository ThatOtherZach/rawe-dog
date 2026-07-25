/**
 * Quiz-compose — unit + e2e tests
 *
 * Unit: compose request validation, prompt building, response schema, and a
 * drift guard asserting the server-side skeleton constants stay in sync with
 * the downloadable public starter files.
 *
 * E2E: the Library page wizard — compose → review → accept → slot populated,
 * the experience multi-role loop (two ordered files), regenerate-with-note,
 * missing-key guard, error surfacing, and the overwrite confirm.
 *
 * All API calls are intercepted via page.route() — no real model calls.
 * NOTE: Chromium's devtools protocol cannot expose multipart bodies that
 * contain File blobs (postData/postDataBuffer come back empty), so uploads
 * are captured by an injected fetch wrapper that records FormData contents
 * in-page and echoes slot/filename to the route mock via test-only headers.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Unit tests (no browser)
// ---------------------------------------------------------------------------

async function composeLib() {
  return (await import("../../artifacts/api-server/src/lib/compose.js")) as {
    parseComposeRequest: (body: unknown) => {
      slot: string;
      answers: { question: string; answer: string }[];
      tweakNote?: string;
    };
    buildComposeMessages: (req: {
      slot: "master-profile" | "system-instructions" | "experience";
      answers: { question: string; answer: string }[];
      tweakNote?: string;
    }) => { system: string; user: string };
    KNOWLEDGE_COMPOSE_SCHEMA: {
      required: string[];
      properties: Record<string, unknown>;
    };
    STARTER_SKELETONS: Record<string, string>;
    COMPOSE_SCHEMA_NAME: string;
  };
}

test("parseComposeRequest accepts valid bodies and rejects bad ones", async () => {
  const { parseComposeRequest } = await composeLib();

  const ok = parseComposeRequest({
    slot: "master-profile",
    answers: [{ question: "Name?", answer: "Jane" }],
  });
  expect(ok.slot).toBe("master-profile");
  expect(ok.answers).toHaveLength(1);
  expect(ok.tweakNote).toBeUndefined();

  // Template slots are not composable.
  expect(() =>
    parseComposeRequest({ slot: "resume-template", answers: [{ question: "q", answer: "a" }] })
  ).toThrow(/slot must be one of/);

  expect(() => parseComposeRequest({ slot: "experience", answers: [] })).toThrow(
    /non-empty/
  );

  // All answers blank → rejected (nothing to compose from).
  expect(() =>
    parseComposeRequest({
      slot: "system-instructions",
      answers: [
        { question: "Voice?", answer: "" },
        { question: "Emphasize?", answer: "  " },
      ],
    })
  ).toThrow(/at least one/i);

  // Oversized tweak note rejected.
  expect(() =>
    parseComposeRequest({
      slot: "experience",
      answers: [{ question: "q", answer: "a" }],
      tweakNote: "x".repeat(1001),
    })
  ).toThrow(/too long/i);
});

test("buildComposeMessages embeds skeleton, transcript, and revision note", async () => {
  const { buildComposeMessages } = await composeLib();

  const { system, user } = buildComposeMessages({
    slot: "experience",
    answers: [
      { question: "Company?", answer: "Acme Corp" },
      { question: "Wins?", answer: "Cut deploy time 45→8 min" },
    ],
    tweakNote: "shorter wins",
  });

  // Grounding rules live in the system message.
  expect(system).toContain("ONLY facts");
  expect(system).toContain("EXACTLY");

  // Skeleton + Q/A transcript + tweak note in the user message.
  expect(user).toContain("## Wins (with numbers)");
  expect(user).toContain("Q1: Company?");
  expect(user).toContain("A1: Acme Corp");
  expect(user).toContain("45→8");
  expect(user).toContain("REVISION REQUEST");
  expect(user).toContain("shorter wins");
});

test("compose schema requires markdown; skeletons match public starters", async () => {
  const { KNOWLEDGE_COMPOSE_SCHEMA, STARTER_SKELETONS, COMPOSE_SCHEMA_NAME } =
    await composeLib();

  expect(COMPOSE_SCHEMA_NAME).toBe("knowledge_compose");
  expect(KNOWLEDGE_COMPOSE_SCHEMA.required).toEqual(["markdown"]);
  expect(KNOWLEDGE_COMPOSE_SCHEMA.properties["markdown"]).toBeTruthy();

  // Drift guard: server-side skeleton constants must equal the public
  // starter files the users download.
  const startersDir = path.resolve(
    __dirname,
    "../../artifacts/rawe-dog/public/starters"
  );
  const pairs: [string, string][] = [
    ["master-profile", "Master-Profile.md"],
    ["system-instructions", "System-Instructions.md"],
    ["experience", "Experience-Role.md"],
  ];
  for (const [slot, fileName] of pairs) {
    const fromDisk = readFileSync(path.join(startersDir, fileName), "utf8");
    expect(STARTER_SKELETONS[slot]?.trim(), `${fileName} drift`).toBe(
      fromDisk.trim()
    );
  }
});

// ---------------------------------------------------------------------------
// Route-level tests — the REAL Express endpoint via the platform router
// (localhost:80 joins web + api; the vite port has no /api proxy).
// Validation short-circuits before any settings read or model call, so these
// are hermetic: no state mutation, no key dependency, no LLM traffic.
// ---------------------------------------------------------------------------

test.describe("compose route validation (live server)", () => {
  const COMPOSE_URL = "http://localhost:80/api/library/compose";

  test("rejects template slots with 400", async ({ request }) => {
    const res = await request.post(COMPOSE_URL, {
      data: { slot: "resume-template", answers: [{ question: "q", answer: "a" }] },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("slot must be one of");
  });

  test("rejects empty answer lists with 400", async ({ request }) => {
    const res = await request.post(COMPOSE_URL, {
      data: { slot: "master-profile", answers: [] },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("non-empty");
  });
});

// ---------------------------------------------------------------------------
// E2E — Library page wizard with intercepted API
// ---------------------------------------------------------------------------

type FileMeta = {
  id: string;
  slot: string;
  originalName: string;
  size: number;
  updatedAt: string;
  kind: string;
  catalogId?: string;
};

type CapturedUpload = { slot: string; name: string; text: string };

type MockState = {
  hasApiKey: boolean;
  files: Record<string, FileMeta[]>;
  composeResponses: { status: number; body: unknown }[];
  composeRequests: unknown[];
};

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    hasApiKey: true,
    files: {},
    composeResponses: [],
    composeRequests: [],
    ...overrides,
  };
}

function libraryPayload(state: MockState) {
  const exp = state.files["experience"] || [];
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
      experienceCount: exp.length,
      resumeTemplate: false,
      coverTemplate: false,
    },
  };
}

let fileSeq = 0;

async function installMocks(page: Page, state: MockState) {
  // Capture FormData uploads in-page (devtools can't expose blob bodies) and
  // echo slot/filename to the route mock via test-only headers.
  await page.addInitScript(() => {
    const w = window as unknown as { __uploads: CapturedUpload[] };
    w.__uploads = [];
    const orig = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const body = init?.body;
      if (body instanceof FormData) {
        const file = body.get("file");
        const slot = String(body.get("slot") ?? "");
        if (file instanceof File) {
          w.__uploads.push({ slot, name: file.name, text: await file.text() });
          init = {
            ...init,
            headers: {
              ...(init?.headers as Record<string, string> | undefined),
              "x-test-upload-slot": slot,
              "x-test-upload-name": encodeURIComponent(file.name),
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
    (url) => url.pathname === "/api/library/compose",
    async (route: Route) => {
      state.composeRequests.push(route.request().postDataJSON());
      const next =
        state.composeResponses.shift() ||
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
        const name = decodeURIComponent(
          headers["x-test-upload-name"] || "unknown.md"
        );
        const meta: FileMeta = {
          id: `mock-${++fileSeq}`,
          slot,
          originalName: name,
          size: 1,
          updatedAt: new Date().toISOString(),
          kind: "md",
        };
        if (slot === "experience") {
          state.files[slot] = [...(state.files[slot] || []), meta];
        } else {
          state.files[slot] = [meta];
        }
        await route.fulfill({ json: { ok: true } });
        return;
      }
      await route.fulfill({ json: libraryPayload(state) });
    }
  );
}

async function getUploads(page: Page): Promise<CapturedUpload[]> {
  return page.evaluate(
    () => (window as unknown as { __uploads: CapturedUpload[] }).__uploads
  );
}

/** Answer every question in order, then hit Compose. */
async function answerAll(page: Page, answers: string[]) {
  for (let i = 0; i < answers.length; i++) {
    await page.getByTestId("compose-input").fill(answers[i]);
    if (i < answers.length - 1) {
      await page.getByTestId("compose-next").click();
    } else {
      await page.getByTestId("compose-submit").click();
    }
  }
}

const MASTER_ANSWERS = [
  "Jane Doe · jane@example.com · +1 555 0100 · Toronto",
  "linkedin.com/in/janedoe",
  "Backend engineer for 8 years, known for reliable data pipelines.",
  "Backend Engineer, Platform Engineer",
  "Toronto, Canada — citizen, no visa needed",
  "Remote preferred, hybrid OK in Toronto",
  "Python, TypeScript, Postgres, Kafka",
  "CAD 140k floor, 4 weeks notice",
];

test("master-profile: compose → review → accept saves file and closes", async ({
  page,
}) => {
  const state = makeState({
    composeResponses: [
      {
        status: 200,
        body: {
          ok: true,
          markdown: "# Jane Doe\n\n## Contact & Links\n\n- Email: jane@example.com",
          model: "grok-4.5",
        },
      },
    ],
  });
  await installMocks(page, state);
  await page.goto("/library");

  await page.getByTestId("compose-open-master-profile").click();
  await expect(page.getByTestId("compose-question")).toBeVisible();

  await answerAll(page, MASTER_ANSWERS);

  // Review renders the draft via markdown (heading visible).
  await expect(page.getByTestId("compose-review")).toBeVisible();
  await expect(
    page.getByTestId("compose-review").getByRole("heading", { name: "Jane Doe" })
  ).toBeVisible();

  // Request carried slot + all 8 Q/A pairs.
  const req = state.composeRequests[0] as {
    slot: string;
    answers: { question: string; answer: string }[];
    tweakNote?: string;
  };
  expect(req.slot).toBe("master-profile");
  expect(req.answers).toHaveLength(8);
  expect(req.answers[0].answer).toContain("Jane Doe");
  expect(req.tweakNote).toBeUndefined();

  await page.getByTestId("compose-accept").click();

  // Wizard closes, file saved with the canonical name, card updates.
  await expect(page.getByTestId("compose-wizard")).toHaveCount(0);
  const uploads = await getUploads(page);
  expect(uploads).toHaveLength(1);
  expect(uploads[0].slot).toBe("master-profile");
  expect(uploads[0].name).toBe("Master-Profile.md");
  expect(uploads[0].text).toContain("# Jane Doe");
  await expect(page.getByText("Master-Profile.md")).toBeVisible();
});

test("experience loop: two roles saved in order with distinct names", async ({
  page,
}) => {
  const state = makeState({
    composeResponses: [
      { status: 200, body: { ok: true, markdown: "# Backend Engineer — Acme Corp" } },
      { status: 200, body: { ok: true, markdown: "# Staff Engineer — Beta Inc" } },
    ],
  });
  await installMocks(page, state);
  await page.goto("/library");

  await page.getByTestId("compose-open-experience").click();
  // Oldest-first nudge shows before the first role.
  await expect(page.getByText(/OLDEST role/)).toBeVisible();

  await answerAll(page, [
    "Acme Corp — logistics SaaS, ~200 people",
    "Backend Engineer",
    "Mar 2019 – Jun 2022",
    "Owned the ingestion pipeline end to end.",
    "Cut deploy time from 45 min to 8",
    "Python, Kafka, Postgres",
  ]);
  await expect(page.getByTestId("compose-review")).toBeVisible();
  await page.getByTestId("compose-accept").click();

  // Interstitial offers another role.
  await expect(page.getByTestId("compose-role-saved")).toBeVisible();
  await page.getByTestId("compose-add-role").click();
  await expect(page.getByTestId("compose-question")).toBeVisible();

  await answerAll(page, [
    "Beta Inc, fintech",
    "Staff Engineer",
    "Jul 2022 – present",
    "Led the payments platform team.",
    "Grew throughput 3x while cutting infra spend 20%",
    "TypeScript, AWS",
  ]);
  await expect(page.getByTestId("compose-review")).toBeVisible();
  await page.getByTestId("compose-accept").click();
  await expect(page.getByTestId("compose-role-saved")).toBeVisible();
  await page.getByTestId("compose-done").click();
  await expect(page.getByTestId("compose-wizard")).toHaveCount(0);

  // Two uploads, in entry order, with role-derived filenames.
  const uploads = await getUploads(page);
  expect(uploads).toHaveLength(2);
  expect(uploads[0].name).toBe("backend-engineer-acme-corp.md");
  expect(uploads[0].slot).toBe("experience");
  expect(uploads[0].text).toContain("# Backend Engineer — Acme Corp");
  expect(uploads[1].name).toBe("staff-engineer-beta-inc.md");

  // Library list shows both files (E1/E2 assignment is server logic, mocked here).
  await expect(page.getByText("backend-engineer-acme-corp.md")).toBeVisible();
  await expect(page.getByText("staff-engineer-beta-inc.md")).toBeVisible();
});

test("regenerate sends the tweak note and swaps in the new draft", async ({
  page,
}) => {
  const state = makeState({
    composeResponses: [
      { status: 200, body: { ok: true, markdown: "# Draft A" } },
      { status: 200, body: { ok: true, markdown: "# Draft B" } },
    ],
  });
  await installMocks(page, state);
  await page.goto("/library");

  await page.getByTestId("compose-open-system-instructions").click();
  await answerAll(page, ["Plain and direct", "Reliability", "", ""]);
  await expect(
    page.getByTestId("compose-review").getByRole("heading", { name: "Draft A" })
  ).toBeVisible();

  await page.getByTestId("compose-tweak").fill("shorter, punchier");
  await page.getByTestId("compose-regenerate").click();
  await expect(
    page.getByTestId("compose-review").getByRole("heading", { name: "Draft B" })
  ).toBeVisible();

  const second = state.composeRequests[1] as { tweakNote?: string };
  expect(second.tweakNote).toBe("shorter, punchier");
});

test("missing API key points to Settings instead of starting the quiz", async ({
  page,
}) => {
  const state = makeState({ hasApiKey: false });
  await installMocks(page, state);
  await page.goto("/library");

  await page.getByTestId("compose-open-master-profile").click();
  await expect(page.getByTestId("compose-no-key")).toBeVisible();
  await expect(page.getByTestId("compose-question")).toHaveCount(0);
  await expect(
    page.getByTestId("compose-no-key").getByRole("link", { name: /Settings/ })
  ).toBeVisible();
});

test("compose failure surfaces the error verbatim and saves nothing", async ({
  page,
}) => {
  const state = makeState({
    composeResponses: [
      { status: 502, body: { error: "drafting call failed (grok-4.5): boom" } },
    ],
  });
  await installMocks(page, state);
  await page.goto("/library");

  await page.getByTestId("compose-open-system-instructions").click();
  await answerAll(page, ["Plain", "", "", ""]);

  await expect(page.getByTestId("compose-error")).toContainText(
    "drafting call failed (grok-4.5): boom"
  );
  // Back on the questions phase, nothing uploaded.
  await expect(page.getByTestId("compose-question")).toBeVisible();
  expect(await getUploads(page)).toHaveLength(0);
});

test("accepting over an existing single-slot file asks before replacing", async ({
  page,
}) => {
  const state = makeState({
    files: {
      "master-profile": [
        {
          id: "existing-1",
          slot: "master-profile",
          originalName: "old-profile.md",
          size: 100,
          updatedAt: new Date().toISOString(),
          kind: "md",
        },
      ],
    },
    composeResponses: [
      { status: 200, body: { ok: true, markdown: "# New Profile" } },
    ],
  });
  await installMocks(page, state);
  await page.goto("/library");

  await page.getByTestId("compose-open-master-profile").click();
  await answerAll(page, MASTER_ANSWERS);
  await expect(page.getByTestId("compose-review")).toBeVisible();

  // First attempt: dismiss the confirm → nothing saved, review stays open.
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Replace");
    void dialog.dismiss();
  });
  await page.getByTestId("compose-accept").click();
  await expect(page.getByTestId("compose-review")).toBeVisible();
  expect(await getUploads(page)).toHaveLength(0);

  // Second attempt: accept the confirm → file replaced.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("compose-accept").click();
  await expect(page.getByTestId("compose-wizard")).toHaveCount(0);
  expect(await getUploads(page)).toHaveLength(1);
});
