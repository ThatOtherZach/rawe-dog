import { Router, type Request, type Response } from "express";
import {
  publicSettings,
  saveSettings,
  loadSettings,
  getDefaultSettings,
} from "../lib/settings.js";
import { testConnection } from "../lib/xai.js";

const router = Router();

router.get("/settings", (_req: Request, res: Response) => {
  res.json(publicSettings());
});

router.put("/settings", async (req: Request, res: Response) => {
  const body = req.body as {
    apiKey?: string;
    model?: string;
    clearApiKey?: boolean;
  };

  const current = loadSettings();
  const partial: { apiKey?: string; model?: string } = {};

  if (body.clearApiKey) {
    partial.apiKey = "";
  } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    partial.apiKey = body.apiKey.trim();
  }

  if (typeof body.model === "string") {
    partial.model = body.model.trim();
  }

  if (partial.apiKey === undefined) {
    partial.apiKey = current.apiKey;
  }

  saveSettings(partial);
  res.json(publicSettings());
});

router.post("/settings", async (req: Request, res: Response) => {
  const body = (req.body || {}) as { action?: string };

  if (body.action === "test") {
    const result = await testConnection();
    res.status(result.ok ? 200 : 400).json(result);
    return;
  }

  if (body.action === "reset-env") {
    const defaults = getDefaultSettings();
    saveSettings(defaults);
    res.json(publicSettings());
    return;
  }

  res.status(400).json({ error: "Unknown action" });
});

export default router;
