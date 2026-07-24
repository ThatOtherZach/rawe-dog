import { Router, type Request, type Response } from "express";
import {
  generateApplicationKit,
  runSelectionOnly,
  runKitFromSelection,
  type GenerateInput,
  type GenerateProgressEvent,
} from "../lib/generate.js";
import type { Pass1Selection } from "../lib/parse-kit.js";
import { getStoredPosting } from "../lib/jobs/store.js";
import {
  briefIsUsable,
  renderBriefCompact,
  renderBriefForDrafting,
} from "../lib/jobs/brief.js";

const router = Router();

function errorStatus(message: string): number {
  return message.includes("API key") ||
    message.includes("Library") ||
    message.includes("required") ||
    message.includes("matched no library files")
    ? 400
    : 500;
}

/** Raw descriptions can be huge; cap the no-brief fallback. */
const RAW_POSTING_CAP = 12000;

router.post("/generate", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      jobPosting?: string;
      postingId?: string;
      company?: string;
      targetTitle?: string;
      notes?: string;
      overrideLeads?: string[];
      skipPass1?: boolean;
      mode?: "full" | "pass1" | "pass2" | "stream";
      selection?: Partial<Pass1Selection>;
    };

    const mode = body.mode || "full";
    const input: GenerateInput = {
      jobPosting: body.jobPosting || "",
      company: body.company,
      targetTitle: body.targetTitle,
      notes: body.notes,
      overrideLeads: body.overrideLeads,
      skipPass1: body.skipPass1,
    };

    // ID-only posting handoff: the client sends just a posting id and the
    // server swaps in the canonical brief (token-efficient) — or the raw
    // description if the posting was never scored.
    if (body.postingId) {
      const stored = getStoredPosting(String(body.postingId));
      if (!stored) {
        res.status(404).json({
          ok: false,
          error:
            "Linked posting not found — it may have been pruned. Open the Postings page and refresh.",
        });
        return;
      }
      const brief = stored.fit?.brief;
      if (!input.jobPosting.trim()) {
        input.jobPosting = briefIsUsable(brief)
          ? renderBriefForDrafting(stored.posting, brief)
          : stored.posting.description.slice(0, RAW_POSTING_CAP);
      }
      if (briefIsUsable(brief)) {
        input.jobPostingCompact = renderBriefCompact(stored.posting, brief);
      }
      if (!input.company?.trim()) input.company = stored.posting.company;
      if (!input.targetTitle?.trim()) {
        input.targetTitle = brief?.targetTitle || stored.posting.title;
      }
      if (!input.jobPosting.trim()) {
        res.status(400).json({
          ok: false,
          error: "The linked posting has no description or brief to work from.",
        });
        return;
      }
    }

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
