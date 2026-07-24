import { NextRequest, NextResponse } from "next/server";
import {
  isValidSlot,
  readLibraryFileBuffer,
  type LibrarySlot,
} from "@/lib/library";

export const runtime = "nodejs";

function contentType(kind: string, name: string): string {
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slotRaw = searchParams.get("slot") || "";
  const id = searchParams.get("id") || "";

  if (!isValidSlot(slotRaw) || !id) {
    return NextResponse.json(
      { error: "slot and id are required" },
      { status: 400 }
    );
  }

  const hit = readLibraryFileBuffer(slotRaw as LibrarySlot, id);
  if (!hit) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const filename = hit.meta.originalName.replace(/"/g, "");
  return new NextResponse(new Uint8Array(hit.buffer), {
    headers: {
      "Content-Type": contentType(hit.meta.kind, hit.meta.originalName),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(hit.buffer.length),
    },
  });
}
