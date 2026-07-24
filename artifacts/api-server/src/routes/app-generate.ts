import { Router, type Request, type Response } from "express";
import {
  generateApplicationKit,
  runSelectionOnly,
  runKitFromSelection,
  type GenerateProgressEvent,
} from "../lib/generate.js";
import type { Pass1Selection } from "../lib/parse-kit.js";

const router = Router();

function errorStatus(message: string): number {
  return message.includes("API key") ||
    message.includes("Library") ||
    message.includes("required") ||
    message.includes("matched no library files")
    ? 400
    : 500;
}

router.post("/generate", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      jobPosting?: string;
      company?: string;
      targetTitle?: string;
      notes?: string;
      overrideLeads?: string[];
      skipPass1?: boolean;
      mode?: "full" | "pass1" | "pass2" | "stream";
      selection?: Partial<Pass1Selection>;
    };

    const mode = body.mode || "full";
    const input = {
      jobPosting: body.jobPosting || "",
      company: body.company,
      targetTitle: body.targetTitle,
      notes: body.notes,
      overrideLeads: body.overrideLeads,
      skipPass1: body.skipPass1,
    };

    if (mode === "stream") {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const send = (event: GenerateProgressEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      try {
        // With a provided selection this is the Pass 2 flow; without one it
        // runs the full pipeline (selection → drafts → verify → repair).
        if (body.selection) {
          await runKitFromSelection(input, body.selection, send);
        } else {
          await generateApplicationKit(input, send);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", error: message });
      } finally {
        res.write('data: {"type":"close"}\n\n');
        res.end();
      }
      return;
    }

    if (mode === "pass1") {
      const result = await runSelectionOnly(input);
      res.json({ ok: true, ...result });
      return;
    }

    if (mode === "pass2") {
      if (!body.selection) {
        res.status(400).json({ ok: false, error: "selection is required for pass2" });
        return;
      }
      const result = await runKitFromSelection(input, body.selection);
      res.json({ ok: true, ...result });
      return;
    }

    // full one-shot (JSON)
    const result = await generateApplicationKit(input);
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(errorStatus(message)).json({ ok: false, error: message });
  }
});

export default router;
