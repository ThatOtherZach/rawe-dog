import { NextRequest, NextResponse } from "next/server";
import {
  publicSettings,
  saveSettings,
  loadSettings,
  getDefaultSettings,
} from "@/lib/settings";
import { testConnection } from "@/lib/xai";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(publicSettings());
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    apiKey?: string;
    model?: string;
    clearApiKey?: boolean;
  };

  const current = loadSettings();
  const partial: { apiKey?: string; model?: string } = {};

  if (body.clearApiKey) {
    partial.apiKey = "";
  } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    // Only update key if a new non-empty value was provided
    partial.apiKey = body.apiKey.trim();
  }

  if (typeof body.model === "string") {
    partial.model = body.model.trim();
  }

  // Preserve existing key if client didn't send a new one
  if (partial.apiKey === undefined) {
    partial.apiKey = current.apiKey;
  }

  saveSettings(partial);
  return NextResponse.json(publicSettings());
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (body.action === "test") {
    const result = await testConnection();
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (body.action === "reset-env") {
    const defaults = getDefaultSettings();
    saveSettings(defaults);
    return NextResponse.json(publicSettings());
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
