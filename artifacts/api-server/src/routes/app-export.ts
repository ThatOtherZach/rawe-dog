import { Router, type Request, type Response } from "express";
import { markdownToPdfBuffer } from "../lib/export/pdf.js";
import { markdownToDocxBuffer } from "../lib/export/docx.js";
import { buildKitZip } from "../lib/export/kit-zip.js";
import { cleanDocumentMarkdown, slugifyFilename } from "../lib/clean-md.js";
import type { ApplicationKit } from "../lib/parse-kit.js";

const router = Router();

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
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.pdf"`);
      res.send(buf);
      return;
    }

    if (format === "docx") {
      const buf = await markdownToDocxBuffer(markdown, body.title);
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
