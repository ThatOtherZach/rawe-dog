import { Router, type Request, type Response } from "express";
import { markdownToPdfBuffer } from "../lib/export/pdf.js";
import { markdownToDocxBuffer } from "../lib/export/docx.js";
import { buildKitZip } from "../lib/export/kit-zip.js";
import { cleanDocumentMarkdown, slugifyFilename } from "../lib/clean-md.js";
import type { ApplicationKit } from "../lib/parse-kit.js";

const router = Router();

const SAMPLE_MD = `# Jane Doe
# jane.doe@example.com | +1 (555) 123-4567 | linkedin.com/in/janedoe

## Summary

**Senior engineer** with *10 years* of experience in \`TypeScript\` and [systems](https://example.com).

---

## Experience

### **Acme Corp** — Staff Engineer

- Led ***cross-functional*** team of 8
- Shipped **v2 platform** ahead of schedule
* Alternate bullet marker

Regular paragraph with trailing text.
`;

function sampleKit(): ApplicationKit {
  return {
    meta: {
      targetTitle: "Staff Engineer",
      company: "Acme Corp",
      leadExperiences: ["Platform v2"],
      rationale: "smoke test",
      sourcesUsed: [],
    },
    resumeMarkdown: SAMPLE_MD,
    coverLetterMarkdown: SAMPLE_MD,
    alignmentNotesMarkdown: "## Alignment\n\n- Point one",
    starPrepMarkdown: "## STAR\n\n- Situation",
  };
}

function hasMagic(buf: Buffer, magic: number[]): boolean {
  if (buf.length < magic.length) return false;
  return magic.every((b, i) => buf[i] === b);
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 (also DOCX)

router.get("/export/smoke", async (_req: Request, res: Response) => {
  type CheckResult = {
    ok: boolean;
    bytes: number;
    error?: string;
  };
  const results: Record<string, CheckResult> = {};

  const check = async (
    name: string,
    fn: () => Promise<Buffer>,
    magic: number[] | null
  ) => {
    try {
      const buf = await fn();
      const ok =
        buf.length > 0 && (magic === null || hasMagic(buf, magic));
      results[name] = {
        ok,
        bytes: buf.length,
        ...(ok
          ? {}
          : { error: buf.length === 0 ? "empty output" : "bad magic bytes" }),
      };
    } catch (err) {
      results[name] = {
        ok: false,
        bytes: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const kit = sampleKit();
  await check("md", async () => Buffer.from(cleanDocumentMarkdown(SAMPLE_MD), "utf-8"), null);
  await check("pdf", () => markdownToPdfBuffer(SAMPLE_MD, "Smoke"), PDF_MAGIC);
  await check("docx", () => markdownToDocxBuffer(SAMPLE_MD, "Smoke"), ZIP_MAGIC);
  await check("zip", () => buildKitZip(kit, "smoke"), ZIP_MAGIC);

  const allOk = Object.values(results).every((r) => r.ok);
  res.status(allOk ? 200 : 500).json({ ok: allOk, results });
});

router.post("/export", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      markdown?: string;
      format?: "pdf" | "docx" | "md" | "zip";
      filename?: string;
      title?: string;
      kit?: ApplicationKit;
    };

    const format = body.format || "md";
    const base = slugifyFilename(body.filename || "document");

    if (format === "zip") {
      if (!body.kit) {
        res.status(400).json({ error: "kit is required for zip export" });
        return;
      }
      const buf = await buildKitZip(body.kit, base);
      if (buf.length === 0 || !hasMagic(buf, ZIP_MAGIC)) {
        res.status(500).json({ error: "ZIP export produced an invalid file" });
        return;
      }
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${base}_kit.zip"`);
      res.send(buf);
      return;
    }

    const markdown = cleanDocumentMarkdown(body.markdown || "");
    if (!markdown.trim()) {
      res.status(400).json({ error: "markdown is required" });
      return;
    }

    if (format === "md") {
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.md"`);
      res.send(markdown);
      return;
    }

    if (format === "pdf") {
      const buf = await markdownToPdfBuffer(markdown, body.title);
      if (buf.length === 0 || !hasMagic(buf, PDF_MAGIC)) {
        res.status(500).json({ error: "PDF export produced an invalid file" });
        return;
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.pdf"`);
      res.send(buf);
      return;
    }

    if (format === "docx") {
      const buf = await markdownToDocxBuffer(markdown, body.title);
      if (buf.length === 0 || !hasMagic(buf, ZIP_MAGIC)) {
        res.status(500).json({ error: "DOCX export produced an invalid file" });
        return;
      }
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${base}.docx"`);
      res.send(buf);
      return;
    }

    res.status(400).json({ error: "Invalid format" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
