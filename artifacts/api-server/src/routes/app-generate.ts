import { Router, type Request, type Response } from "express";
import {
  generateApplicationKit,
  runSelectionOnly,
  runKitFromSelection,
  type GenerateInput,
  type GenerateProgressEvent,
} from "../lib/generate.js";
import type { Pass1Selection } from "../lib/parse-kit.js";
import { getStoredPosting, setPostingStatus } from "../lib/jobs/store.js";
import {
  briefIsUsable,
  renderBriefCompact,
  renderBriefForDrafting,
} from "../lib/jobs/brief.js";
import { logger } from "../lib/logger.js";
import { checkToken, creditsEnforced, reserveCredit, releaseCredit } from "../lib/credits/tokens.js";
import { spendCredit } from "../lib/credits/store.js";

const router = Router();

/** Keep proxies from cutting the SSE stream during long silent model calls. */
const HEARTBEAT_MS = 15_000;

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
  // Set when this run holds an in-flight credit reservation (consuming modes
  // only) — always released in the finally below.
  let reservedTokenId: string | null = null;
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

    // Credit gate (the toasteth pattern — the generate pipeline is the
    // toaster, a bearer token is the paid unlock). When armed, every run
    // needs a live token; ONE credit is consumed only when a kit completes
    // successfully. Pass 1 selection alone never consumes, and failed runs
    // never consume.
    let creditTokenId: string | null = null;
    if (creditsEnforced()) {
      const check = await checkToken(req.header("x-credit-token") ?? undefined);
      if (!check.ok) {
        const why =
          check.reason === "missing"
            ? "A generation credit is required to run the kit."
            : check.reason === "empty"
              ? "This credit has already been used — get a fresh one."
              : "Your credit token is invalid — redeem or buy a new credit.";
        res.status(402).json({ ok: false, error: why, code: "credit_required", reason: check.reason });
        return;
      }
      creditTokenId = check.token.id;
      // Consuming modes reserve their credit up front so N parallel runs on a
      // 1-credit token can't all deliver kits (spend happens on success, so
      // validation alone isn't enough). Pass 1 never consumes → no reserve.
      if (mode !== "pass1") {
        if (!reserveCredit(creditTokenId, check.token.remaining)) {
          res.status(402).json({
            ok: false,
            error: "Your credit is already funding a run in progress — wait for it to finish.",
            code: "credit_required",
            reason: "in_use",
          });
          return;
        }
        reservedTokenId = creditTokenId;
      }
    }
    const consumeCredit = async () => {
      if (!creditTokenId) return;
      const spent = await spendCredit(creditTokenId);
      if (spent) {
        logger.info({ route: "generate", evt: "credit_spent", remaining: spent.remaining }, "credit consumed");
      } else {
        // Run already delivered — log loudly rather than clawing it back.
        logger.warn({ route: "generate", evt: "credit_spend_failed" }, "credit spend failed after successful run");
      }
    };

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

      const t0 = Date.now();
      const runLog = logger.child({
        route: "generate-stream",
        postingId: body.postingId || undefined,
        mode: body.selection ? "pass2" : "full",
      });
      const streamOpen = () => !res.destroyed && !res.writableEnded;

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
        await consumeCredit();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", error: message });
      } finally {
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
      await consumeCredit();
      res.json({ ok: true, ...result });
      return;
    }

    // full one-shot (JSON)
    const result = await generateApplicationKit(input);
    if (body.postingId) {
      setPostingStatus(String(body.postingId), "kit_generated");
    }
    await consumeCredit();
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(errorStatus(message)).json({ ok: false, error: message });
  } finally {
    // Runs on every exit path, including early returns and stream mode
    // (the handler awaits the full stream run before returning).
    if (reservedTokenId) releaseCredit(reservedTokenId);
  }
});

export default router;
