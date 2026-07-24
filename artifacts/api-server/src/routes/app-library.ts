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

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

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
