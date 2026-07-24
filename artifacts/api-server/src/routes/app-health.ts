import { Router } from "express";
import { libraryReadiness, assertDataWritable } from "../lib/library.js";
import { publicSettings } from "../lib/settings.js";

const router = Router();

router.get("/health", (_req, res) => {
  const readiness = libraryReadiness();
  const settings = publicSettings();
  const data = assertDataWritable();
  res.json({
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
});

export default router;
