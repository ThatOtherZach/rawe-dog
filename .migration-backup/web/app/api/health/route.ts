import { NextResponse } from "next/server";
import { libraryReadiness, assertDataWritable } from "@/lib/library";
import { publicSettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  const readiness = libraryReadiness();
  const settings = publicSettings();
  const data = assertDataWritable();
  return NextResponse.json({
    ok: true,
    dataWritable: data.ok,
    dataPath: data.path,
    settings: {
      hasApiKey: settings.hasApiKey,
      model: settings.model,
    },
    library: {
      ready: readiness.ready,
      masterProfile: readiness.masterProfile,
      systemInstructions: readiness.systemInstructions,
      experienceCount: readiness.experienceCount,
      resumeTemplate: readiness.resumeTemplate,
      coverTemplate: readiness.coverTemplate,
    },
  });
}
