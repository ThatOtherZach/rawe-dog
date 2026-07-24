import { createRequire } from "module";

const _require = createRequire(import.meta.url);

/**
 * Extract text from PDF buffers for template/experience context.
 * pdf-parse is CJS; load via createRequire.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse = _require("pdf-parse") as (data: Buffer) => Promise<{ text: string; numpages?: number }>;
  const result = await pdfParse(buffer);
  return (result.text || "").replace(/\n{3,}/g, "\n\n").trim();
}

export async function fileToModelText(
  buffer: Buffer,
  kind: "markdown" | "pdf" | "text" | "other",
  originalName: string
): Promise<string> {
  if (kind === "pdf") {
    const text = await extractPdfText(buffer);
    if (!text) {
      return `[PDF template/file "${originalName}" had no extractable text. Infer a clean professional ATS layout.]`;
    }
    return `--- Extracted text from PDF: ${originalName} ---\n${text}`;
  }
  return buffer.toString("utf8");
}
