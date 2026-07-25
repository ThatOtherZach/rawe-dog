import { Router, type Request, type Response } from "express";
import { rmSync, unlinkSync, existsSync } from "fs";
import { getLibraryRoot, getDataRoot, getSettingsPath } from "../lib/paths.js";
import path from "path";

const router = Router();

type WipeAreaResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

type WipeResult = {
  library: WipeAreaResult;
  postings: WipeAreaResult;
  settings: WipeAreaResult;
  allOk: boolean;
};

/**
 * DELETE /wipe
 *
 * Destructive maintenance endpoint: wipes all user career data.
 * Deletes:
 *   - data/library/ (all library files: master profile, experiences, templates)
 *   - data/postings/ (postings cache and saved search filters)
 *   - data/settings.json (API keys, models, endpoint)
 *
 * Explicitly does NOT touch:
 *   - data/credits/ (operator tax records + buyer credit tokens)
 *
 * Returns a per-area result summary. Never claims success when a delete failed.
 */
router.delete("/wipe", (_req: Request, res: Response) => {
  const result: WipeResult = {
    library: { ok: false },
    postings: { ok: false },
    settings: { ok: false },
    allOk: false,
  };

  // --- Library ---
  try {
    const libraryRoot = getLibraryRoot();
    if (existsSync(libraryRoot)) {
      rmSync(libraryRoot, { recursive: true, force: true });
      result.library = { ok: true };
    } else {
      result.library = { ok: true, skipped: true };
    }
  } catch (err) {
    result.library = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // --- Postings ---
  try {
    const postingsDir = path.join(getDataRoot(), "postings");
    if (existsSync(postingsDir)) {
      rmSync(postingsDir, { recursive: true, force: true });
      result.postings = { ok: true };
    } else {
      result.postings = { ok: true, skipped: true };
    }
  } catch (err) {
    result.postings = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // --- Settings ---
  try {
    const settingsPath = getSettingsPath();
    if (existsSync(settingsPath)) {
      unlinkSync(settingsPath);
      result.settings = { ok: true };
    } else {
      result.settings = { ok: true, skipped: true };
    }
  } catch (err) {
    result.settings = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  result.allOk = result.library.ok && result.postings.ok && result.settings.ok;

  res.status(result.allOk ? 200 : 207).json(result);
});

export default router;
