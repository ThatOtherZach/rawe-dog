import { Router, type Request, type Response } from "express";
import { generateApplicationKit, runSelectionOnly, runKitFromSelection, type GenerateInput } from "../lib/generate.js";
import { getStoredPosting, setPostingStatus } from "../lib/jobs/store.js";
import { renderBriefForDrafting, renderBriefCompact } from "../lib/jobs/brief.js";
import { briefIsUsable } from "../lib/jobs/brief.js";
import { logger } from "../lib/logger.js";
import { loadSettings } from "../lib/settings.js";
import type { Pass1Selection } from "../lib/parse-kit.js";
import type { GenerateProgressEvent } from "../lib/generate.js";

const router = Router();

/** Keep proxies from cutting the SSE stream during long silent model calls.
 *  HEARTBEAT_MS env var is a dev/test hook (e.g. shorten for e2e tests). */
const HEARTBEAT_MS =
  Number(process.env["HEARTBEAT_MS"]) > 0
    ? Number(process.env["HEARTBEAT_MS"])
    : 15_000;

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

/**
 * Kit generation is FREE — no credit check. Credits gate the postings
 * search (POST /postings/refresh), not kit generation.
 */
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

    const settings = loadSettings();

    // Score-gated skip decision:
    //   - Settings toggle off → skip (user disabled verification)
    //   - No postingId → skip (paste mode, unchanged)
    //   - postingId, score ≥ 70 → skip (strong fit, low grounding risk)
    //   - postingId, score missing or score < 70 → run verification
    let skipVerification = false;
    let skipVerificationReason: string | undefined;

    if (!settings.runVerification) {
      skipVerification = true;
      skipVerificationReason = "Verification disabled in Settings.";
    } else if (!body.postingId) {
      skipVerification = true;
      // Reason omitted here — finishKitPipeline uses the default paste-mode message
    }
    // If postingId is present, defer the score check until after we load the stored posting below.

    const input: GenerateInput = {
      jobPosting: body.jobPosting || "",
      company: body.company,
      targetTitle: body.targetTitle,
      notes: body.notes,
      overrideLeads: body.overrideLeads,
      skipPass1: body.skipPass1,
      skipVerification,
      skipVerificationReason,
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

      // Apply score-gated skip if verification wasn't already disabled by settings.
      if (settings.runVerification) {
        const score = stored.fit?.score;
        if (typeof score === "number" && score >= 70) {
          input.skipVerification = true;
          input.skipVerificationReason = `Verification skipped — strong fit score (${score}/100); grounding risk is low.`;
        } else {
          // score < 70 or not yet scored — run verification
          input.skipVerification = false;
        }
      }
    }

    if (mode === "stream") {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const t0 = Date.now();
      const runLog = logger.child({
        route: "generate-stream",
        postingId: body.postingId || undefined,
        mode: body.selection ? "pass2" : "full",
      });
      const streamOpen = () => !res.destroyed && !res.writableEnded;

      // AbortController threaded through the pipeline: aborting it
      // cancels every in-flight xAI call immediately, stopping token
      // spend as soon as the client disconnects or clicks Cancel.
      const abortController = new AbortController();
      const onClientClose = () => {
        if (!abortController.signal.aborted) {
          runLog.info({ evt: "abort", ms: Date.now() - t0 }, "client disconnected — aborting pipeline");
          abortController.abort();
        }
      };
      // Use res.on("close") to detect actual client disconnection.
      // req.on("close") fires when the request body stream ends (after
      // express.json() finishes parsing), which is too early — the client
      // hasn't gone away, the body was simply fully consumed.
      res.on("close", onClientClose);

      // Every emitted event is logged so a stalled run is traceable after
      // the fact: which stage started, which docs finished, where it died.
      const send = (event: GenerateProgressEvent) => {
        if (streamOpen()) res.write(`data: ${JSON.stringify(event)}\n\n`);
        const ms = Date.now() - t0;
        if (event.type === "error") {
          runLog.error({ evt: "error", ms, error: event.error }, "generate stream error");
        } else {
          runLog.info(
            {
              evt: event.type,
              ms,
              stage: "stage" in event ? event.stage : undefined,
              doc: "doc" in event ? event.doc : undefined,
            },
            "generate stream event"
          );
        }
      };

      // SSE comment-frame heartbeat: clients ignore it, proxies see traffic.
      const heartbeat = setInterval(() => {
        if (streamOpen()) res.write(`: keepalive\n\n`);
      }, HEARTBEAT_MS);

      input.signal = abortController.signal;

      runLog.info({ evt: "start" }, "generate stream started");
      try {
        // With a provided selection this is the Pass 2 flow; without one it
        // runs the full pipeline (selection → drafts → verify → repair).
        if (body.selection) {
          await runKitFromSelection(input, body.selection, send);
        } else {
          await generateApplicationKit(input, send);
        }
        // Mark the posting as kit_generated on successful stream completion.
        if (body.postingId) {
          setPostingStatus(String(body.postingId), "kit_generated");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Suppress abort errors — the client already left; no point writing
        // to a dead socket, and "AbortError" is not a run failure.
        if (!abortController.signal.aborted) {
          send({ type: "error", error: message });
        }
      } finally {
        res.off("close", onClientClose);
        clearInterval(heartbeat);
        runLog.info({ evt: "close", ms: Date.now() - t0 }, "generate stream closed");
        if (streamOpen()) {
          res.write('data: {"type":"close"}\n\n');
          res.end();
        }
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
      if (body.postingId) {
        setPostingStatus(String(body.postingId), "kit_generated");
      }
      res.json({ ok: true, ...result });
      return;
    }

    // full one-shot (JSON)
    const result = await generateApplicationKit(input);
    if (body.postingId) {
      setPostingStatus(String(body.postingId), "kit_generated");
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(errorStatus(message)).json({ ok: false, error: message });
  }
});

export default router;
