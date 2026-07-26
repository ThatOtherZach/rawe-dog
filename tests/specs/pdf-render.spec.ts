/**
 * PDF render content tests.
 *
 * Verifies that markdownToPdfBuffer (via POST /api/export?format=pdf) produces
 * a PDF whose extracted text:
 *   - Contains all section headings
 *   - Contains all bullet text
 *   - Contains inline-formatted runs (bold/italic stripped to plain text)
 *   - Renders bullets AFTER their section heading (no x-drift / ordering bug)
 *   - Renders paragraph text in document order
 *
 * Uses the real API server (port 8080) and pdf-parse for text extraction.
 * No browser is opened — all assertions run in Node context via Playwright's
 * APIRequestContext.
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// pdf-parse v2 helper (CJS — plain require is available in commonjs test env)
//
// pdf-parse v2 uses a class-based API: new PDFParse({ data: buffer }) then
// load() + getText(). getText() resolves to { text, pages, total }.
// ---------------------------------------------------------------------------

interface PDFParseInstance {
  load(): Promise<unknown>;
  getText(): Promise<{ text: string; pages: unknown[]; total: number }>;
}
interface PDFParseConstructor {
  new (opts: { verbosity?: number; data: Buffer }): PDFParseInstance;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PDFParse } = require("pdf-parse") as { PDFParse: PDFParseConstructor };

async function extractText(pdfBuffer: Buffer): Promise<string> {
  const inst = new PDFParse({ verbosity: 0, data: pdfBuffer });
  await inst.load();
  const result = await inst.getText();
  return (result.text || "").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// Fixture markdown — mirrors SAMPLE_MD in app-export.ts but with an extra
// paragraph and more bullet types to exercise all renderer paths.
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

test.describe("PDF renderer — content extraction", () => {
  let pdfText: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/export`, {
      data: {
        markdown: FIXTURE_MD,
        format: "pdf",
        filename: "test-resume",
        title: "Test Resume",
      },
    });

    expect(res.status(), "POST /api/export should return 200").toBe(200);

    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType, "response should be application/pdf").toContain(
      "application/pdf"
    );

    const body = await res.body();
    expect(body.length, "PDF buffer should be non-empty").toBeGreaterThan(0);

    // Verify PDF magic bytes (%PDF)
    expect(body[0]).toBe(0x25); // %
    expect(body[1]).toBe(0x50); // P
    expect(body[2]).toBe(0x44); // D
    expect(body[3]).toBe(0x46); // F

    pdfText = await extractText(body);
  });

  test("PDF contains the candidate name heading", () => {
    expect(pdfText).toContain("Jane Doe");
  });

  test("PDF contains the contact line", () => {
    expect(pdfText).toContain("jane.doe@example.com");
    expect(pdfText).toContain("+1 (555) 123-4567");
  });

  test("PDF contains all section headings", () => {
    expect(pdfText).toContain("SUMMARY");
    expect(pdfText).toContain("EXPERIENCE");
    expect(pdfText).toContain("EDUCATION");
  });

  test("PDF contains inline-formatted text stripped to plain", () => {
    // Bold/italic markers must not appear in the extracted text
    expect(pdfText).not.toContain("**");
    expect(pdfText).not.toContain("***");
    expect(pdfText).not.toContain("*10 years*");
    // The plain text of those runs must be present
    expect(pdfText).toContain("Senior engineer");
    expect(pdfText).toContain("10 years");
    expect(pdfText).toContain("cross-functional");
  });

  test("PDF contains all bullet text", () => {
    expect(pdfText).toContain("Led");
    expect(pdfText).toContain("cross-functional");
    expect(pdfText).toContain("team of 8");
    expect(pdfText).toContain("Shipped");
    expect(pdfText).toContain("v2 platform");
    expect(pdfText).toContain("ahead of schedule");
    expect(pdfText).toContain("Alternate bullet marker style");
    expect(pdfText).toContain("Graduated with honours");
    expect(pdfText).toContain("Dean");
  });

  test("PDF contains paragraph text", () => {
    expect(pdfText).toContain("Regular paragraph with trailing text");
  });

  test("Experience section heading appears before bullet content (no ordering bug)", () => {
    const expIdx = pdfText.indexOf("EXPERIENCE");
    const bulletIdx = pdfText.indexOf("Led");
    expect(expIdx, "EXPERIENCE heading must be found").toBeGreaterThanOrEqual(0);
    expect(bulletIdx, "bullet text must be found").toBeGreaterThanOrEqual(0);
    expect(expIdx, "EXPERIENCE heading must precede bullet text").toBeLessThan(
      bulletIdx
    );
  });

  test("Summary section heading appears before summary paragraph (no ordering bug)", () => {
    const summaryIdx = pdfText.indexOf("SUMMARY");
    const paraIdx = pdfText.indexOf("Senior engineer");
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(paraIdx).toBeGreaterThanOrEqual(0);
    expect(summaryIdx).toBeLessThan(paraIdx);
  });

  test("Experience section appears before Education section", () => {
    const expIdx = pdfText.indexOf("EXPERIENCE");
    const eduIdx = pdfText.indexOf("EDUCATION");
    expect(expIdx).toBeGreaterThanOrEqual(0);
    expect(eduIdx).toBeGreaterThanOrEqual(0);
    expect(expIdx).toBeLessThan(eduIdx);
  });

  test("Experience bullet text appears before Education bullet text (section ordering)", () => {
    const expBulletIdx = pdfText.indexOf("Shipped");
    const eduBulletIdx = pdfText.indexOf("Graduated with honours");
    expect(expBulletIdx).toBeGreaterThanOrEqual(0);
    expect(eduBulletIdx).toBeGreaterThanOrEqual(0);
    expect(expBulletIdx).toBeLessThan(eduBulletIdx);
  });

  test("sub-heading text appears after its section heading", () => {
    const expIdx = pdfText.indexOf("EXPERIENCE");
    const subIdx = pdfText.indexOf("Acme Corp");
    expect(expIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBeGreaterThanOrEqual(0);
    expect(expIdx).toBeLessThan(subIdx);
  });
});
