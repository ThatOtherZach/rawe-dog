import { NextRequest, NextResponse } from "next/server";
import { markdownToPdfBuffer } from "@/lib/export/pdf";
import { markdownToDocxBuffer } from "@/lib/export/docx";
import { buildKitZip } from "@/lib/export/kit-zip";
import { cleanDocumentMarkdown, slugifyFilename } from "@/lib/clean-md";
import type { ApplicationKit } from "@/lib/parse-kit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
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
        return NextResponse.json(
          { error: "kit is required for zip export" },
          { status: 400 }
        );
      }
      const buf = await buildKitZip(body.kit, base);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${base}_kit.zip"`,
        },
      });
    }

    const markdown = cleanDocumentMarkdown(body.markdown || "");
    if (!markdown.trim()) {
      return NextResponse.json(
        { error: "markdown is required" },
        { status: 400 }
      );
    }

    if (format === "md") {
      return new NextResponse(markdown, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${base}.md"`,
        },
      });
    }

    if (format === "pdf") {
      const buf = await markdownToPdfBuffer(markdown, body.title);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${base}.pdf"`,
        },
      });
    }

    if (format === "docx") {
      const buf = await markdownToDocxBuffer(markdown, body.title);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${base}.docx"`,
        },
      });
    }

    return NextResponse.json({ error: "Invalid format" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
