/**
 * PDF-toggle ZIP export tests.
 *
 * Verifies that the "PDF Export" setting (generatePdf) controls whether
 * .pdf entries appear in ZIP downloads, and that the direct
 * POST /api/export { format: "pdf" } endpoint is blocked (403) when the
 * toggle is off.
 *
 * Uses the real API server (http://localhost:8080). No browser is opened —
 * all assertions run in Node context via Playwright's APIRequestContext.
 *
 * ZIP inspection is done without any third-party library: the ZIP local-file-
 * header format is well-defined and straightforward to scan for filenames.
 */

import { test, expect } from "@playwright/test";

const API_BASE = "http://127.0.0.1:8080";

// ---------------------------------------------------------------------------
// Minimal ZIP entry scanner (no library required).
//
// ZIP local file header layout (little-endian):
//   Offset  Len  Field
//      0     4   Signature (0x50 0x4B 0x03 0x04)
//      4     2   Version needed to extract
//      6     2   General purpose bit flag
//      8     2   Compression method
//     10     2   Last mod time
//     12     2   Last mod date
//     14     4   CRC-32
//     18     4   Compressed size
//     22     4   Uncompressed size
//     26     2   File name length (n)
//     28     2   Extra field length (m)
//     30     n   File name (UTF-8)
//     30+n   m   Extra field
// ---------------------------------------------------------------------------

function listZipEntries(buf: Buffer): string[] {
  const LOCAL_HEADER_SIG = 0x04034b50; // little-endian
  const names: string[] = [];
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) === LOCAL_HEADER_SIG) {
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const name = buf.slice(i + 30, i + 30 + nameLen).toString("utf8");
      names.push(name);
      // Jump to next header: past the fixed portion, the name, the extra
      // field, and the compressed data.
      const compressedSize = buf.readUInt32LE(i + 18);
      i += 30 + nameLen + extraLen + compressedSize;
    } else {
      i++;
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Sample kit matching the ApplicationKit shape
// ---------------------------------------------------------------------------

const SAMPLE_KIT = {
  meta: {
    targetTitle: "Staff Engineer",
    company: "Acme Corp",
    leadExperiences: ["Platform v2"],
    rationale: "test run",
    sourcesUsed: [],
  },
  resumeMarkdown: "# Jane Doe\n\n## Summary\n\nExperienced engineer.\n",
  coverLetterMarkdown: "# Cover Letter\n\nDear Hiring Manager,\n\nI am interested.\n",
  alignmentNotesMarkdown: "## Alignment\n\n- Strong fit.\n",
  starPrepMarkdown: "## STAR Prep\n\n- Situation: ...\n",
};

// ---------------------------------------------------------------------------
// Helpers to read and restore the generatePdf setting
// ---------------------------------------------------------------------------

async function getGeneratePdfSetting(request: import("@playwright/test").APIRequestContext): Promise<boolean> {
  const res = await request.get(`${API_BASE}/api/settings`);
  expect(res.status()).toBe(200);
  const body = await res.json() as { generatePdf: boolean };
  return Boolean(body.generatePdf);
}

async function setGeneratePdfSetting(
  request: import("@playwright/test").APIRequestContext,
  value: boolean
): Promise<void> {
  const res = await request.put(`${API_BASE}/api/settings`, {
    data: { generatePdf: value },
  });
  expect(res.status()).toBe(200);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("PDF-toggle — ZIP export", () => {
  let originalGeneratePdf: boolean;

  test.beforeAll(async ({ request }) => {
    originalGeneratePdf = await getGeneratePdfSetting(request);
  });

  test.afterAll(async ({ request }) => {
    // Always restore the original setting regardless of test outcome.
    await setGeneratePdfSetting(request, originalGeneratePdf);
  });

  // -------------------------------------------------------------------------
  // Toggle OFF — no .pdf entries in ZIP
  // -------------------------------------------------------------------------

  test("ZIP contains no .pdf entries when generatePdf is false", async ({ request }) => {
    await setGeneratePdfSetting(request, false);

    const res = await request.post(`${API_BASE}/api/export`, {
      data: { format: "zip", filename: "test-kit", kit: SAMPLE_KIT },
    });

    expect(
      res.status(),
      `POST /api/export (zip, pdf=off) should return 200 — got ${res.status()}`
    ).toBe(200);

    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/zip");

    const body = await res.body();
    expect(body.length, "ZIP buffer should be non-empty").toBeGreaterThan(0);

    // Verify ZIP magic bytes PK\x03\x04
    expect(body[0]).toBe(0x50);
    expect(body[1]).toBe(0x4b);

    const entries = listZipEntries(body);
    expect(entries.length, "ZIP should contain at least one entry").toBeGreaterThan(0);

    const pdfEntries = entries.filter((name) => name.endsWith(".pdf"));
    expect(
      pdfEntries,
      `ZIP must contain no .pdf entries when PDF export is off (found: ${pdfEntries.join(", ")})`
    ).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Toggle ON — .pdf entries ARE present
  // -------------------------------------------------------------------------

  test("ZIP contains .pdf entries when generatePdf is true", async ({ request }) => {
    await setGeneratePdfSetting(request, true);

    const res = await request.post(`${API_BASE}/api/export`, {
      data: { format: "zip", filename: "test-kit", kit: SAMPLE_KIT },
    });

    expect(
      res.status(),
      `POST /api/export (zip, pdf=on) should return 200 — got ${res.status()}`
    ).toBe(200);

    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/zip");

    const body = await res.body();
    expect(body.length, "ZIP buffer should be non-empty").toBeGreaterThan(0);

    const entries = listZipEntries(body);
    expect(entries.length, "ZIP should contain at least one entry").toBeGreaterThan(0);

    const pdfEntries = entries.filter((name) => name.endsWith(".pdf"));
    expect(
      pdfEntries.length,
      `ZIP must contain at least one .pdf entry when PDF export is on (entries: ${entries.join(", ")})`
    ).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Toggle ON — confirm expected docs have PDFs (resume + cover letter)
  // -------------------------------------------------------------------------

  test("ZIP with pdf=true contains Resume and Cover_Letter PDFs", async ({ request }) => {
    await setGeneratePdfSetting(request, true);

    const res = await request.post(`${API_BASE}/api/export`, {
      data: { format: "zip", filename: "acme-kit", kit: SAMPLE_KIT },
    });

    expect(res.status()).toBe(200);
    const body = await res.body();
    const entries = listZipEntries(body);

    const pdfEntries = entries.filter((name) => name.endsWith(".pdf"));
    const hasSomeResumePdf = pdfEntries.some((n) => n.includes("Resume"));
    const hasCoverLetterPdf = pdfEntries.some((n) => n.includes("Cover_Letter"));

    expect(
      hasSomeResumePdf,
      `Expected a Resume.pdf entry; found: ${pdfEntries.join(", ")}`
    ).toBe(true);
    expect(
      hasCoverLetterPdf,
      `Expected a Cover_Letter.pdf entry; found: ${pdfEntries.join(", ")}`
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Toggle OFF — non-PDF documents still included (md, docx)
  // -------------------------------------------------------------------------

  test("ZIP with pdf=false still includes .md entries", async ({ request }) => {
    await setGeneratePdfSetting(request, false);

    const res = await request.post(`${API_BASE}/api/export`, {
      data: { format: "zip", filename: "test-kit", kit: SAMPLE_KIT },
    });

    expect(res.status()).toBe(200);
    const body = await res.body();
    const entries = listZipEntries(body);

    const mdEntries = entries.filter((name) => name.endsWith(".md"));
    expect(
      mdEntries.length,
      `ZIP must contain .md entries even when PDF export is off (entries: ${entries.join(", ")})`
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Direct /api/export?format=pdf blocked when toggle is off
// ---------------------------------------------------------------------------

test.describe("PDF-toggle — direct PDF endpoint", () => {
  let originalGeneratePdf: boolean;

  test.beforeAll(async ({ request }) => {
    originalGeneratePdf = await getGeneratePdfSetting(request);
  });

  test.afterAll(async ({ request }) => {
    await setGeneratePdfSetting(request, originalGeneratePdf);
  });

  test("POST /api/export { format: pdf } returns 403 when generatePdf is false", async ({ request }) => {
    await setGeneratePdfSetting(request, false);

    const res = await request.post(`${API_BASE}/api/export`, {
      data: {
        format: "pdf",
        markdown: "# Jane Doe\n\nSenior Engineer.\n",
        filename: "resume",
        title: "Resume",
      },
    });

    expect(
      res.status(),
      "Direct PDF export must return 403 when the PDF toggle is off"
    ).toBe(403);

    const body = await res.json() as { error: string };
    expect(body.error, "403 body must include a descriptive error message").toBeTruthy();
  });

  test("POST /api/export { format: pdf } returns 200 when generatePdf is true", async ({ request }) => {
    await setGeneratePdfSetting(request, true);

    const res = await request.post(`${API_BASE}/api/export`, {
      data: {
        format: "pdf",
        markdown: "# Jane Doe\n\nSenior Engineer.\n",
        filename: "resume",
        title: "Resume",
      },
    });

    expect(
      res.status(),
      "Direct PDF export must succeed when the PDF toggle is on"
    ).toBe(200);

    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/pdf");

    const body = await res.body();
    // Check PDF magic bytes (%PDF)
    expect(body[0]).toBe(0x25); // %
    expect(body[1]).toBe(0x50); // P
    expect(body[2]).toBe(0x44); // D
    expect(body[3]).toBe(0x46); // F
  });
});
