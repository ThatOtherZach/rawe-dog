import { Router, type Request, type Response } from "express";
import multer from "multer";
import {
  isValidSlot,
  listLibrary,
  libraryReadiness,
  saveUpload,
  deleteLibraryFile,
  readLibraryFileBuffer,
  type LibrarySlot,
  slotLabel,
} from "../lib/library.js";
import {
  parseComposeRequest,
  buildComposeMessages,
  KNOWLEDGE_COMPOSE_SCHEMA,
  COMPOSE_SCHEMA_NAME,
} from "../lib/compose.js";
import { chatStructured } from "../lib/xai.js";
import { loadSettings } from "../lib/settings.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Compose a knowledge doc from guided-interview answers.
 * Runs on the user's configured key/model (BYOM) and is NOT credit-gated —
 * credits price kits, not setup. Returns markdown only and saves nothing;
 * saving is a separate explicit step through the normal upload route.
 */
router.post("/library/compose", async (req: Request, res: Response) => {
  let parsed: ReturnType<typeof parseComposeRequest>;
  try {
    parsed = parseComposeRequest(req.body);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (!loadSettings().apiKey) {
    res.status(400).json({
      error: "No xAI API key configured. Add one on the Settings page first.",
    });
    return;
  }
  try {
    const { system, user } = buildComposeMessages(parsed);
    const { data, meta } = await chatStructured<{ markdown: string }>({
      stage: "drafting",
      system,
      user,
      schemaName: COMPOSE_SCHEMA_NAME,
      schema: KNOWLEDGE_COMPOSE_SCHEMA,
      maxTokens: 4096,
      temperature: 0.4,
    });
    const markdown = (data.markdown || "").trim();
    if (!markdown) {
      res.status(502).json({ error: "Model returned an empty document. Try again." });
      return;
    }
    res.json({ ok: true, markdown, model: meta.model });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

router.get("/library", (_req: Request, res: Response) => {
  const library = listLibrary();
  // Attach stable catalog IDs (E1, E2, …) to experience files — same sort
  // order used by assignCatalogIds in context-pack so the UI matches the model.
  if (Array.isArray(library["experience"])) {
    library["experience"] = [...library["experience"]]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((f, i) => ({ ...f, catalogId: `E${i + 1}` }));
  }
  res.json({
    readiness: libraryReadiness(),
    files: library,
    slots: (
      [
        "master-profile",
        "system-instructions",
        "experience",
        "resume-template",
        "cover-template",
      ] as LibrarySlot[]
    ).map((slot) => ({
      slot,
      label: slotLabel(slot),
      multi: slot === "experience",
      required: slot !== "system-instructions",
    })),
  });
});

router.post("/library", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const slotRaw = String(req.body?.slot || "");
    if (!isValidSlot(slotRaw)) {
      res.status(400).json({ error: "Invalid slot" });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "file is required" });
      return;
    }

    const buffer = file.buffer;
    const meta = await saveUpload(
      slotRaw,
      file.originalname || "upload.md",
      buffer,
      file.mimetype || "application/octet-stream"
    );

    res.json({
      ok: true,
      file: meta,
      readiness: libraryReadiness(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

router.delete("/library", (req: Request, res: Response) => {
  const slotRaw = String(req.query["slot"] || "");
  const id = String(req.query["id"] || "");
  if (!isValidSlot(slotRaw) || !id) {
    res.status(400).json({ error: "slot and id are required" });
    return;
  }
  const ok = deleteLibraryFile(slotRaw, id);
  if (!ok) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.json({ ok: true, readiness: libraryReadiness() });
});

// File download endpoint
router.get("/library/file", (req: Request, res: Response) => {
  const slotRaw = String(req.query["slot"] || "");
  const id = String(req.query["id"] || "");

  if (!isValidSlot(slotRaw) || !id) {
    res.status(400).json({ error: "slot and id are required" });
    return;
  }

  const hit = readLibraryFileBuffer(slotRaw as LibrarySlot, id);
  if (!hit) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const filename = hit.meta.originalName.replace(/"/g, "");
  const contentType = getContentType(hit.meta.kind, hit.meta.originalName);

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", String(hit.buffer.length));
  res.send(hit.buffer);
});

function getContentType(kind: string, name: string): string {
  if (kind === "pdf" || name.toLowerCase().endsWith(".pdf")) {
    return "application/pdf";
  }
  if (name.toLowerCase().endsWith(".md") || name.toLowerCase().endsWith(".markdown")) {
    return "text/markdown; charset=utf-8";
  }
  if (name.toLowerCase().endsWith(".txt")) {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
}

export default router;
