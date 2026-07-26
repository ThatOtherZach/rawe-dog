/**
 * DOCX render content tests.
 *
 * Verifies that markdownToDocxBuffer (via POST /api/export?format=docx) produces
 * a DOCX whose extracted text:
 *   - Contains all section headings
 *   - Contains all bullet text
 *   - Contains inline-formatted runs (bold/italic stripped to plain text)
 *   - Renders bullets AFTER their section heading (no ordering bug)
 *   - Renders sections in document order
 *
 * Uses the real API server (port 8080) and mammoth for text extraction.
 * No browser is opened — all assertions run in Node context via Playwright's
 * APIRequestContext.
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// mammoth helper — extracts plain text from a DOCX buffer via mammoth's
// extractRawText API. Returns a single string with newlines between paragraphs.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mammoth = require("mammoth") as {
  extractRawText(opts: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }>;
};

async function extractText(docxBuffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: docxBuffer });
  return result.value.replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// Fixture markdown — same representative content used by the PDF spec, so
// regressions in either renderer are immediately comparable.
// ---------------------------------------------------------------------------

const FIXTURE_MD = `# Jane Doe
# jane.doe@example.com | +1 (555) 123-4567 | linkedin.com/in/janedoe

## Summary

**Senior engineer** with *10 years* of experience in TypeScript and systems design.

---

## Experience

### **Acme Corp** — Staff Engineer

- Led ***cross-functional*** team of 8
- Shipped **v2 platform** ahead of schedule
* Alternate bullet marker style

Regular paragraph with trailing text that should appear in order.

## Education

### **State University** — B.Sc. Computer Science

- Graduated with honours
- Dean's list for three years
`;

const API_BASE = "http://localhost:8080";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("DOCX renderer — content extraction", () => {
  let docxText: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/export`, {
      data: {
        markdown: FIXTURE_MD,
        format: "docx",
        filename: "test-resume",
        title: "Test Resume",
      },
    });

    expect(res.status(), "POST /api/export should return 200").toBe(200);

    const contentType = res.headers()["content-type"] ?? "";
    expect(
      contentType,
      "response should be DOCX content-type"
    ).toContain("wordprocessingml.document");

    const body = await res.body();
    expect(body.length, "DOCX buffer should be non-empty").toBeGreaterThan(0);

    // Verify ZIP/DOCX magic bytes (PK\x03\x04)
    expect(body[0]).toBe(0x50); // P
    expect(body[1]).toBe(0x4b); // K
    expect(body[2]).toBe(0x03);
    expect(body[3]).toBe(0x04);

    docxText = await extractText(body);
  });

  test("DOCX contains the candidate name heading", () => {
    expect(docxText).toContain("Jane Doe");
  });

  test("DOCX contains the contact line", () => {
    expect(docxText).toContain("jane.doe@example.com");
    expect(docxText).toContain("+1 (555) 123-4567");
  });

  test("DOCX contains all section headings", () => {
    expect(docxText).toContain("Summary");
    expect(docxText).toContain("Experience");
    expect(docxText).toContain("Education");
  });

  test("DOCX contains inline-formatted text stripped to plain", () => {
    // Bold/italic markers must not appear in the extracted text
    expect(docxText).not.toContain("**");
    expect(docxText).not.toContain("***");
    expect(docxText).not.toContain("*10 years*");
    // The plain text of those runs must be present
    expect(docxText).toContain("Senior engineer");
    expect(docxText).toContain("10 years");
    expect(docxText).toContain("cross-functional");
  });

  test("DOCX contains all bullet text", () => {
    expect(docxText).toContain("Led");
    expect(docxText).toContain("cross-functional");
    expect(docxText).toContain("team of 8");
    expect(docxText).toContain("Shipped");
    expect(docxText).toContain("v2 platform");
    expect(docxText).toContain("ahead of schedule");
    expect(docxText).toContain("Alternate bullet marker style");
    expect(docxText).toContain("Graduated with honours");
    expect(docxText).toContain("Dean");
  });

  test("DOCX contains paragraph text", () => {
    expect(docxText).toContain("Regular paragraph with trailing text");
  });

  test("Experience section heading appears before bullet content (no ordering bug)", () => {
    const expIdx = docxText.indexOf("Experience");
    const bulletIdx = docxText.indexOf("Led");
    expect(expIdx, "Experience heading must be found").toBeGreaterThanOrEqual(0);
    expect(bulletIdx, "bullet text must be found").toBeGreaterThanOrEqual(0);
    expect(expIdx, "Experience heading must precede bullet text").toBeLessThan(
      bulletIdx
    );
  });

  test("Summary section heading appears before summary paragraph (no ordering bug)", () => {
    const summaryIdx = docxText.indexOf("Summary");
    const paraIdx = docxText.indexOf("Senior engineer");
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(paraIdx).toBeGreaterThanOrEqual(0);
    expect(summaryIdx).toBeLessThan(paraIdx);
  });

  test("Experience section appears before Education section", () => {
    const expIdx = docxText.indexOf("Experience");
    const eduIdx = docxText.indexOf("Education");
    expect(expIdx).toBeGreaterThanOrEqual(0);
    expect(eduIdx).toBeGreaterThanOrEqual(0);
    expect(expIdx).toBeLessThan(eduIdx);
  });

  test("Experience bullet text appears before Education bullet text (section ordering)", () => {
    const expBulletIdx = docxText.indexOf("Shipped");
    const eduBulletIdx = docxText.indexOf("Graduated with honours");
    expect(expBulletIdx).toBeGreaterThanOrEqual(0);
    expect(eduBulletIdx).toBeGreaterThanOrEqual(0);
    expect(expBulletIdx).toBeLessThan(eduBulletIdx);
  });

  test("sub-heading text appears after its section heading", () => {
    const expIdx = docxText.indexOf("Experience");
    const subIdx = docxText.indexOf("Acme Corp");
    expect(expIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBeGreaterThanOrEqual(0);
    expect(expIdx).toBeLessThan(subIdx);
  });
});
