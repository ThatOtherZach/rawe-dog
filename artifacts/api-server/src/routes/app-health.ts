import { Router } from "express";
import { libraryReadiness, assertDataWritable } from "../lib/library.js";
import { publicSettings, loadSettings } from "../lib/settings.js";
import { loadMasterProfile } from "../lib/context-pack.js";
import {
  freeTierEnabled,
  freeKitEnforced,
  isOperatorKeyRun,
  requestClientIp,
  computeFingerprint,
  freeKitStatus,
  freeKitWindowHours,
} from "../lib/free-quota.js";

const router = Router();

router.get("/health", async (req, res) => {
  const readiness = libraryReadiness();
  const settings = publicSettings();
  const data = assertDataWritable();

  // Free-kit status for THIS caller (fingerprint is one-way and never returned).
  let freeKit: {
    enforced: boolean;
    /** True when the free tier is switched off entirely (kill switch). */
    disabled?: boolean;
    remaining: number;
    limit: number;
    windowHours: number;
    resetsInHours: number;
  } | null = null;
  const operatorRun = isOperatorKeyRun(loadSettings());
  if (!freeTierEnabled() && operatorRun) {
    // Kill switch on: the caller cannot generate at all until they BYOK.
    freeKit = {
      enforced: true,
      disabled: true,
      remaining: 0,
      limit: 0,
      windowHours: freeKitWindowHours(),
      resetsInHours: 0,
    };
  } else if (freeKitEnforced() && operatorRun) {
    try {
      const master = await loadMasterProfile();
      if (master) {
        const s = freeKitStatus(computeFingerprint(master.text, requestClientIp(req)));
        freeKit = {
          enforced: true,
          remaining: s.remaining,
          limit: s.limit,
          windowHours: s.windowHours,
          resetsInHours: Math.max(1, Math.ceil(s.resetsInMs / 3_600_000)),
        };
      }
    } catch {
      // Status is informational only — never fail /health over it.
    }
  }
  res.json({
    ok: true,
    dataWritable: data.ok,
    dataPath: data.path,
    settings: {
      hasApiKey: settings.hasApiKey,
      model: settings.model,
      generatePdf: settings.generatePdf,
    },
    library: {
      ready: readiness.ready,
      masterProfile: readiness.masterProfile,
      systemInstructions: readiness.systemInstructions,
      experienceCount: readiness.experienceCount,
      resumeTemplate: readiness.resumeTemplate,
      coverTemplate: readiness.coverTemplate,
    },
    freeKit,
  });
});

export default router;
