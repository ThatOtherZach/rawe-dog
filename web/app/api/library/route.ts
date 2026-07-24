import { NextRequest, NextResponse } from "next/server";
import {
  isValidSlot,
  listLibrary,
  libraryReadiness,
  saveUpload,
  deleteLibraryFile,
  type LibrarySlot,
  slotLabel,
} from "@/lib/library";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    readiness: libraryReadiness(),
    files: listLibrary(),
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
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const slotRaw = String(form.get("slot") || "");
    if (!isValidSlot(slotRaw)) {
      return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
    }
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const meta = await saveUpload(
      slotRaw,
      file.name || "upload.md",
      buffer,
      file.type || "application/octet-stream"
    );

    return NextResponse.json({
      ok: true,
      file: meta,
      readiness: libraryReadiness(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slotRaw = searchParams.get("slot") || "";
  const id = searchParams.get("id") || "";
  if (!isValidSlot(slotRaw) || !id) {
    return NextResponse.json(
      { error: "slot and id are required" },
      { status: 400 }
    );
  }
  const ok = deleteLibraryFile(slotRaw, id);
  if (!ok) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, readiness: libraryReadiness() });
}
