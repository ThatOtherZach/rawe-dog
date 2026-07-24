import { NextRequest, NextResponse } from "next/server";
import {
  generateApplicationKit,
  runPass1Only,
  runPass2,
  type GenerateProgressEvent,
} from "@/lib/generate";
import { normalizePass1, type Pass1Selection } from "@/lib/parse-kit";

export const runtime = "nodejs";
export const maxDuration = 180;

type Body = {
  jobPosting?: string;
  company?: string;
  targetTitle?: string;
  notes?: string;
  overrideLeads?: string[];
  skipPass1?: boolean;
  /** "full" | "pass1" | "pass2" | "stream" */
  mode?: "full" | "pass1" | "pass2" | "stream";
  selection?: Partial<Pass1Selection>;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
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
      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const send = (event: GenerateProgressEvent) => {
            controller.enqueue(
              enc.encode(`data: ${JSON.stringify(event)}\n\n`)
            );
          };
          try {
            const result = await generateApplicationKit(input, send);
            // ensure done was emitted (generateApplicationKit emits done via pass2)
            if (!result) {
              /* noop */
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            send({ type: "error", error: message });
          } finally {
            controller.enqueue(enc.encode("data: {\"type\":\"close\"}\n\n"));
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    if (mode === "pass1") {
      const result = await runPass1Only(input);
      return NextResponse.json({ ok: true, ...result });
    }

    if (mode === "pass2") {
      if (!body.selection) {
        return NextResponse.json(
          { ok: false, error: "selection is required for pass2" },
          { status: 400 }
        );
      }
      const selection = normalizePass1(body.selection);
      const result = await runPass2(input, selection);
      return NextResponse.json({ ok: true, ...result });
    }

    // full one-shot
    const result = await generateApplicationKit(input);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("API key") || message.includes("Library")
        ? 400
        : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
