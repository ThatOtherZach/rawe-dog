/**
 * xpStore.ts — Client-side XP & achievements for RAWE Dog.
 *
 * Fully self-contained; no React dependency.  Persists to localStorage.
 * Communicates to the React layer via CustomEvents:
 *   • "rawedog:xp_updated"   — profile changed (widget refreshes)
 *   • "rawedog:achievement"  — { achievement: AchievementRecord } unlocked
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AchievementId =
  | "memo"
  | "pc_load_letter"
  | "case_of_mondays"
  | "not_the_singer"
  | "miltons_stapler"
  | "flair"
  | "burned_it_down"
  | "basement"
  | "did_nothing"
  | "jumped_ship"
  | "derive_filters"
  | "setup_api"
  | "librarian"
  | "memo_drafted"
  | "imported_goods"
  | "taking_it_with_you"
  | "paper_trail"
  | "delegated"
  | "serial_refresher"
  | "move_fast"
  | "laser_focused"
  | "overachiever";

export type AchievementDef = {
  id: AchievementId;
  icon: string;
  name: string;
  flavour: string;
};

export type AchievementRecord = AchievementDef & { unlockedAt: string };

export type XpEventType =
  | "kit_generated"
  | "applied"
  | "paid_search"
  | "compose_doc"
  | "file_upload"
  | "dismiss"
  | "data_wipe"
  | "filter_change"
  | "derive_filters"
  | "api_key_saved"
  | "profile_exported"
  | "profile_imported"
  | "csv_exported";

export type XpEventLog = { type: XpEventType; at: string };

export type Profile = {
  xp: number;
  achievements: { id: AchievementId; unlockedAt: string }[];
  eventLog: XpEventLog[];
  stats: {
    kitsGenerated: number;
    applicationsTotal: number;
    dismissalsTotal: number;
    paidSearchesTotal: number;
    knowledgeDocsComposed: number;
    filesUploaded: number;
    filterChanges: number;
    firstApiKeySaved: boolean;
    deriveFiltersUsed: boolean;
    highScoreApplications: number;
    lastActivityAt: string | null;
  };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LS_PROFILE_KEY = "rawedog_profile";
export const LS_KIT_EVER_KEY = "rawedog_kit_ever_generated";

export const LEVELS: { min: number; name: string }[] = [
  { min: 0, name: "Unpaid Intern" },
  { min: 100, name: "New Hire" },
  { min: 300, name: "Has a Case of the Mondays" },
  { min: 600, name: "Filed the TPS Report" },
  { min: 1_000, name: "Sufficient Flair" },
  { min: 2_000, name: "The Bobs Approve" },
  { min: 4_000, name: "Jumped Ship" },
  { min: 7_000, name: "Do Nothing" },
  { min: 10_000, name: "CEO" },
  { min: 15_000, name: "Boss" },
  { min: 20_000, name: "Who's The Boss?" },
  { min: 25_000, name: "You da Boss frfr" },
];

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  {
    id: "memo",
    icon: "📋",
    name: "Did You Get the Memo?",
    flavour: "First application filed. The TPS report awaits.",
  },
  {
    id: "pc_load_letter",
    icon: "🖨️",
    name: "PC Load Letter",
    flavour: "First posting dismissed. Nobody knows what it means either.",
  },
  {
    id: "case_of_mondays",
    icon: "☕",
    name: "Sounds Like Somebody Has a Case of the Mondays",
    flavour: "First paid search run. The bandwidth has been leveraged.",
  },
  {
    id: "not_the_singer",
    icon: "🎸",
    name: "Not the Singer",
    flavour: "10 kits generated. That's a lot of flair.",
  },
  {
    id: "miltons_stapler",
    icon: "📎",
    name: "Milton's Stapler",
    flavour: "5 kits hoarded, zero applied. At least you have the stapler.",
  },
  {
    id: "flair",
    icon: "👔",
    name: "15 Pieces of Flair",
    flavour: "15 applications. The minimum is 15, you know.",
  },
  {
    id: "burned_it_down",
    icon: "🔥",
    name: "Burned It Down",
    flavour: "Data wiped. The building is fine. Probably.",
  },
  {
    id: "basement",
    icon: "📠",
    name: "Moved to the Basement",
    flavour: "Filters changed 3+ times. Decisiveness is overrated.",
  },
  {
    id: "did_nothing",
    icon: "🏆",
    name: "I Did Absolutely Nothing All Day",
    flavour: "7 days away, then returned. You still get paid… right?",
  },
  {
    id: "jumped_ship",
    icon: "🚀",
    name: "Jumped Ship",
    flavour: "25 applications. Bold move.",
  },
  {
    id: "derive_filters",
    icon: "🧪",
    name: "Let Me Derive That For You",
    flavour: "Filters derived from profile. The algorithm has spoken.",
  },
  {
    id: "setup_api",
    icon: "⚙️",
    name: "Someone Set Up Us the API",
    flavour: "First API key saved. All your tokens are belong to us.",
  },
  {
    id: "librarian",
    icon: "🗂️",
    name: "The Librarian",
    flavour: "5 knowledge files loaded. The Dewey Decimal System is impressed.",
  },
  {
    id: "memo_drafted",
    icon: "📝",
    name: "Memo Drafted",
    flavour: "3 docs composed. Somebody's gonna read them eventually.",
  },
  {
    id: "imported_goods",
    icon: "📥",
    name: "Imported Goods",
    flavour: "XP profile imported. Continuity of bureaucracy maintained.",
  },
  {
    id: "taking_it_with_you",
    icon: "💾",
    name: "Taking It With You",
    flavour: "Profile exported. Unlike your office plant, this you keep.",
  },
  {
    id: "paper_trail",
    icon: "📤",
    name: "Paper Trail",
    flavour: "Applied jobs exported. Documentation for the record.",
  },
  {
    id: "delegated",
    icon: "🧹",
    name: "Delegated Aggressively",
    flavour: "20 postings dismissed. Leadership material.",
  },
  {
    id: "serial_refresher",
    icon: "🔍",
    name: "Serial Refresher",
    flavour: "10 paid searches run. The market is being watched.",
  },
  {
    id: "move_fast",
    icon: "⚡",
    name: "Move Fast Break Things",
    flavour: "Applied within 1 hour of kit generation. Proactive AND reckless.",
  },
  {
    id: "laser_focused",
    icon: "🎯",
    name: "Laser Focused",
    flavour: "3 high-fit applications (score 80+). Discerning taste.",
  },
  {
    id: "overachiever",
    icon: "🏅",
    name: "Overachiever",
    flavour: "All achievements unlocked. You're the Michael Scott of job hunting.",
  },
];

const XP_VALUES: Partial<Record<XpEventType, number>> = {
  kit_generated: 25,
  applied: 100,
  paid_search: 50,
  compose_doc: 30,
  file_upload: 20,
  dismiss: 5,
};

const DAILY_BONUS_XP = 50;
const FULL_LOOP_BONUS_XP = 75;

// ---------------------------------------------------------------------------
// Session state — persisted in sessionStorage so it survives within-tab
// navigation (SPA route changes) but resets when the tab is closed.
// ---------------------------------------------------------------------------

const SS_SESSION_KEY = "rawedog_session";

type SessionState = {
  paidSearchRan: boolean;
  /** postingId → Unix timestamp (ms) when kit was generated */
  kitGeneratedIds: Record<string, number>;
  appliedIds: string[];
  dailyBonusAwardedDate: string; // "YYYY-MM-DD"
};

function emptySession(): SessionState {
  return {
    paidSearchRan: false,
    kitGeneratedIds: {},
    appliedIds: [],
    dailyBonusAwardedDate: "",
  };
}

function loadSession(): SessionState {
  try {
    const raw = sessionStorage.getItem(SS_SESSION_KEY);
    if (!raw) return emptySession();
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    const base = emptySession();
    return {
      paidSearchRan: parsed.paidSearchRan ?? base.paidSearchRan,
      kitGeneratedIds: parsed.kitGeneratedIds ?? base.kitGeneratedIds,
      appliedIds: parsed.appliedIds ?? base.appliedIds,
      dailyBonusAwardedDate: parsed.dailyBonusAwardedDate ?? base.dailyBonusAwardedDate,
    };
  } catch {
    return emptySession();
  }
}

function saveSession(s: SessionState): void {
  try {
    sessionStorage.setItem(SS_SESSION_KEY, JSON.stringify(s));
  } catch {
    // no-op — storage may be unavailable (private mode, quota, etc.)
  }
}

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

function emptyProfile(): Profile {
  return {
    xp: 0,
    achievements: [],
    eventLog: [],
    stats: {
      kitsGenerated: 0,
      applicationsTotal: 0,
      dismissalsTotal: 0,
      paidSearchesTotal: 0,
      knowledgeDocsComposed: 0,
      filesUploaded: 0,
      filterChanges: 0,
      firstApiKeySaved: false,
      deriveFiltersUsed: false,
      highScoreApplications: 0,
      lastActivityAt: null,
    },
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(LS_PROFILE_KEY);
    if (!raw) return emptyProfile();
    const p = JSON.parse(raw) as Partial<Profile>;
    // Merge with empty to fill any missing stats fields from older versions
    const base = emptyProfile();

    // Harden achievements: must be an array of objects with string id + unlockedAt.
    // A partial / corrupted entry is dropped rather than silently falling back to []
    // which would appear as all achievements cleared.
    let achievements: Profile["achievements"] = [];
    if (Array.isArray(p.achievements)) {
      achievements = p.achievements.filter(
        (a): a is { id: AchievementId; unlockedAt: string } =>
          a !== null &&
          typeof a === "object" &&
          typeof (a as Record<string, unknown>).id === "string" &&
          typeof (a as Record<string, unknown>).unlockedAt === "string",
      );
    }

    return {
      xp: typeof p.xp === "number" ? p.xp : 0,
      achievements,
      eventLog: Array.isArray(p.eventLog) ? p.eventLog : [],
      stats: { ...base.stats, ...(p.stats ?? {}) },
    };
  } catch {
    return emptyProfile();
  }
}

function saveProfile(p: Profile): void {
  // Guard: never silently shrink the achievements array.
  // If the in-memory profile somehow has fewer achievements than what is
  // already persisted (e.g. a re-entrant write raced with a stale load),
  // merge the persisted ones back in before writing.
  try {
    const existingRaw = localStorage.getItem(LS_PROFILE_KEY);
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as Partial<Profile>;
      if (Array.isArray(existing.achievements) && existing.achievements.length > p.achievements.length) {
        const ids = new Set(p.achievements.map((a) => a.id));
        for (const a of existing.achievements) {
          if (
            a !== null &&
            typeof a === "object" &&
            typeof (a as Record<string, unknown>).id === "string" &&
            !ids.has((a as { id: AchievementId }).id)
          ) {
            p.achievements.push(a as { id: AchievementId; unlockedAt: string });
            ids.add((a as { id: AchievementId }).id);
          }
        }
      }
    }
  } catch {
    // If we can't read the existing record, proceed with what we have.
  }

  // Keep event log trimmed to last 200 entries to avoid unbounded growth
  if (p.eventLog.length > 200) {
    p.eventLog = p.eventLog.slice(-200);
  }
  localStorage.setItem(LS_PROFILE_KEY, JSON.stringify(p));
}

// ---------------------------------------------------------------------------
// Level helpers
// ---------------------------------------------------------------------------

export function levelForXp(xp: number): { name: string; index: number } {
  let level = LEVELS[0];
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].min) {
      level = LEVELS[i];
      index = i;
    }
  }
  return { name: level.name, index };
}

/** Returns 0-1 progress through the current level band. */
export function xpProgress(xp: number): { pct: number; current: number; needed: number } {
  const { index } = levelForXp(xp);
  const lo = LEVELS[index].min;
  const hi = LEVELS[index + 1]?.min ?? null;
  if (hi === null) return { pct: 1, current: xp - lo, needed: 0 };
  const range = hi - lo;
  const current = xp - lo;
  return { pct: Math.min(1, current / range), current, needed: range };
}

// ---------------------------------------------------------------------------
// Achievement helpers
// ---------------------------------------------------------------------------

function isUnlocked(p: Profile, id: AchievementId): boolean {
  return p.achievements.some((a) => a.id === id);
}

function unlock(p: Profile, id: AchievementId): AchievementRecord | null {
  if (isUnlocked(p, id)) return null;
  const def = ACHIEVEMENT_DEFS.find((d) => d.id === id);
  if (!def) return null;
  const record: { id: AchievementId; unlockedAt: string } = {
    id,
    unlockedAt: new Date().toISOString(),
  };
  p.achievements.push(record);
  const full: AchievementRecord = { ...def, unlockedAt: record.unlockedAt };
  return full;
}

// ---------------------------------------------------------------------------
// Dispatch helpers
// ---------------------------------------------------------------------------

function dispatchXpUpdated(xpGained = 0): void {
  window.dispatchEvent(new CustomEvent("rawedog:xp_updated", { detail: { xpGained } }));
}

function dispatchAchievement(a: AchievementRecord): void {
  window.dispatchEvent(new CustomEvent("rawedog:achievement", { detail: { achievement: a } }));
}

// ---------------------------------------------------------------------------
// Achievement check — called after every XP award
// ---------------------------------------------------------------------------

function checkAchievements(
  p: Profile,
  opts: {
    knowledgeFileCount?: number;
    fitScore?: number;
    postingId?: string;
    kitGeneratedAt?: number;
  } = {}
): AchievementRecord[] {
  const unlocked: AchievementRecord[] = [];

  const maybeUnlock = (id: AchievementId) => {
    const r = unlock(p, id);
    if (r) unlocked.push(r);
  };

  const { stats } = p;

  // "Did You Get the Memo?" — first application
  if (stats.applicationsTotal >= 1) maybeUnlock("memo");

  // "PC Load Letter" — first dismiss
  if (stats.dismissalsTotal >= 1) maybeUnlock("pc_load_letter");

  // "Sounds Like Somebody Has a Case of the Mondays" — first paid search
  if (stats.paidSearchesTotal >= 1) maybeUnlock("case_of_mondays");

  // "Not the Singer" — 10 kits
  if (stats.kitsGenerated >= 10) maybeUnlock("not_the_singer");

  // "Milton's Stapler" — 5 kits, 0 applications
  if (stats.kitsGenerated >= 5 && stats.applicationsTotal === 0) maybeUnlock("miltons_stapler");

  // "15 Pieces of Flair" — 15 applications
  if (stats.applicationsTotal >= 15) maybeUnlock("flair");

  // "Moved to the Basement" — 3+ filter changes
  if (stats.filterChanges >= 3) maybeUnlock("basement");

  // "Jumped Ship" — 25 applications
  if (stats.applicationsTotal >= 25) maybeUnlock("jumped_ship");

  // "Let Me Derive That For You" — derive filters used
  if (stats.deriveFiltersUsed) maybeUnlock("derive_filters");

  // "Someone Set Up Us the API" — first API key
  if (stats.firstApiKeySaved) maybeUnlock("setup_api");

  // "The Librarian" — 5+ knowledge files
  if (opts.knowledgeFileCount !== undefined && opts.knowledgeFileCount >= 5)
    maybeUnlock("librarian");

  // "Memo Drafted" — 3 composed docs
  if (stats.knowledgeDocsComposed >= 3) maybeUnlock("memo_drafted");

  // "Delegated Aggressively" — 20 dismissals
  if (stats.dismissalsTotal >= 20) maybeUnlock("delegated");

  // "Serial Refresher" — 10 paid searches
  if (stats.paidSearchesTotal >= 10) maybeUnlock("serial_refresher");

  // "Move Fast Break Things" — applied within 1h of kit gen
  if (opts.postingId && opts.kitGeneratedAt) {
    const elapsed = Date.now() - opts.kitGeneratedAt;
    if (elapsed < 60 * 60 * 1000) maybeUnlock("move_fast");
  }

  // "Laser Focused" — 3 high-score applications
  if (stats.highScoreApplications >= 3) maybeUnlock("laser_focused");

  // "Overachiever" — all others unlocked
  const nonOverachiever = ACHIEVEMENT_DEFS.filter((d) => d.id !== "overachiever");
  if (nonOverachiever.every((d) => isUnlocked(p, d.id))) maybeUnlock("overachiever");

  return unlocked;
}

// ---------------------------------------------------------------------------
// Core award function
// ---------------------------------------------------------------------------

export type AwardOpts = {
  /** For kit_generated / applied / paid_search: links the event to a posting */
  postingId?: string;
  /** For applied: the fit score to check laser-focused */
  fitScore?: number;
  /** Count of knowledge files currently in library (triggers librarian check) */
  knowledgeFileCount?: number;
};

// ---------------------------------------------------------------------------
// Re-entrancy guard for awardXp
// ---------------------------------------------------------------------------

// window.dispatchEvent is synchronous, so a listener that calls awardXp again
// would re-enter this function before the first invocation has finished and
// saved its profile, causing the inner call to load a stale copy and then
// overwrite the outer call's (unsaved) achievements.  This flag makes any
// nested / re-entrant call a no-op.
let _awardXpInFlight = false;

/**
 * Awards XP for an event, updates stats, checks achievements, persists, and
 * fires CustomEvents so the React layer can react.
 *
 * Safe to call from anywhere; no-ops silently if localStorage is unavailable.
 */
export function awardXp(type: XpEventType, opts: AwardOpts = {}): void {
  if (_awardXpInFlight) return;
  _awardXpInFlight = true;
  try {
    const p = loadProfile();
    const now = new Date().toISOString();

    let xpGained = XP_VALUES[type] ?? 0;
    let extraBonus = 0;
    let kitGeneratedAt: number | undefined;

    // Load persisted session state (survives SPA navigation within the same tab)
    const sess = loadSession();

    // Update stats
    const { stats } = p;
    stats.lastActivityAt = now;

    switch (type) {
      case "kit_generated":
        stats.kitsGenerated += 1;
        // Mark first kit ever generated (shows the widget)
        localStorage.setItem(LS_KIT_EVER_KEY, "1");
        // Session tracking — persist so the kit survives navigation to another page
        if (opts.postingId) {
          sess.kitGeneratedIds[opts.postingId] = Date.now();
          saveSession(sess);
        }
        break;

      case "applied": {
        stats.applicationsTotal += 1;
        // High-score tracking
        if (opts.fitScore !== undefined && opts.fitScore >= 80) {
          stats.highScoreApplications += 1;
        }
        // Daily first-apply bonus
        const todayStr = new Date().toISOString().slice(0, 10);
        if (sess.dailyBonusAwardedDate !== todayStr) {
          sess.dailyBonusAwardedDate = todayStr;
          extraBonus += DAILY_BONUS_XP;
          p.eventLog.push({ type: "applied", at: now }); // log daily bonus alongside
        }
        // Full-loop bonus: paid search ran this session + kit generated for this posting
        if (opts.postingId) {
          const kitAt = sess.kitGeneratedIds[opts.postingId];
          if (sess.paidSearchRan && kitAt !== undefined) {
            extraBonus += FULL_LOOP_BONUS_XP;
          }
          kitGeneratedAt = sess.kitGeneratedIds[opts.postingId];
          if (!sess.appliedIds.includes(opts.postingId)) {
            sess.appliedIds.push(opts.postingId);
          }
        }
        saveSession(sess);
        break;
      }

      case "paid_search":
        stats.paidSearchesTotal += 1;
        sess.paidSearchRan = true;
        saveSession(sess);
        break;

      case "compose_doc":
        stats.knowledgeDocsComposed += 1;
        break;

      case "file_upload":
        stats.filesUploaded += 1;
        break;

      case "dismiss":
        stats.dismissalsTotal += 1;
        break;

      case "filter_change":
        stats.filterChanges += 1;
        xpGained = 0; // no XP for filter changes, just stat tracking
        break;

      case "derive_filters":
        if (!stats.deriveFiltersUsed) {
          stats.deriveFiltersUsed = true;
          xpGained = 0; // XP comes from the derive_filters event itself via check
        } else {
          xpGained = 0;
        }
        break;

      case "api_key_saved":
        if (!stats.firstApiKeySaved) {
          stats.firstApiKeySaved = true;
        } else {
          xpGained = 0; // only first time
        }
        break;

      case "data_wipe":
      case "profile_exported":
      case "profile_imported":
      case "csv_exported":
        xpGained = 0; // achievement-only events
        break;
    }

    const totalGained = xpGained + extraBonus;
    p.xp += totalGained;
    if (totalGained > 0 || type !== "filter_change") {
      p.eventLog.push({ type, at: now });
    }

    // Check achievements
    const newAchievements = checkAchievements(p, {
      knowledgeFileCount: opts.knowledgeFileCount,
      fitScore: opts.fitScore,
      postingId: opts.postingId,
      kitGeneratedAt,
    });

    // Special achievement checks for non-XP events
    if (type === "data_wipe") {
      const r = unlock(p, "burned_it_down");
      if (r) newAchievements.push(r);
    }
    if (type === "profile_exported") {
      const r = unlock(p, "taking_it_with_you");
      if (r) newAchievements.push(r);
    }
    if (type === "profile_imported") {
      const r = unlock(p, "imported_goods");
      if (r) newAchievements.push(r);
    }
    if (type === "csv_exported") {
      const r = unlock(p, "paper_trail");
      if (r) newAchievements.push(r);
    }

    saveProfile(p);
    dispatchXpUpdated(totalGained);
    for (const a of newAchievements) {
      dispatchAchievement(a);
    }
  } catch {
    // Never throw from XP tracking
  } finally {
    _awardXpInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// On-load check: "I Did Absolutely Nothing All Day"
// ---------------------------------------------------------------------------

export function checkIdleReturn(): void {
  try {
    const p = loadProfile();
    if (!p.stats.lastActivityAt) return;
    const lastAt = new Date(p.stats.lastActivityAt).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - lastAt >= sevenDaysMs) {
      const r = unlock(p, "did_nothing");
      if (r) {
        saveProfile(p);
        dispatchXpUpdated();
        dispatchAchievement(r);
      }
    }
  } catch {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// Full wipe — called from the Settings danger-zone action
// ---------------------------------------------------------------------------

export function wipeXpData(): void {
  try {
    localStorage.removeItem(LS_PROFILE_KEY);
    localStorage.removeItem(LS_KIT_EVER_KEY);
    sessionStorage.removeItem(SS_SESSION_KEY);
    dispatchXpUpdated(0);
  } catch {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

export type ExportedProfile = {
  xp: number;
  level: string;
  achievements: { id: AchievementId; unlockedAt: string }[];
  eventLog: XpEventLog[];
  exportedAt: string;
};

export function exportProfile(): void {
  try {
    const p = loadProfile();
    const { name } = levelForXp(p.xp);
    const data: ExportedProfile = {
      xp: p.xp,
      level: name,
      achievements: p.achievements,
      eventLog: p.eventLog,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rawedog-profile.json";
    a.click();
    URL.revokeObjectURL(url);
    awardXp("profile_exported");
  } catch {
    // no-op
  }
}

export function importProfile(file: File): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = reader.result as string;
        const imported = JSON.parse(raw) as Partial<ExportedProfile>;
        if (
          typeof imported.xp !== "number" ||
          !Array.isArray(imported.achievements)
        ) {
          resolve({ ok: false, error: "File doesn't look like a RAWE Dog profile." });
          return;
        }
        const current = loadProfile();
        // Merge: take higher XP, union of achievements
        const merged = emptyProfile();
        merged.xp = Math.max(current.xp, imported.xp);
        merged.stats = { ...current.stats };
        // Union achievements
        const seen = new Set<AchievementId>(current.achievements.map((a) => a.id));
        merged.achievements = [...current.achievements];
        for (const a of imported.achievements) {
          if (!seen.has(a.id)) {
            merged.achievements.push(a);
            seen.add(a.id);
          }
        }
        // Merge event logs (keep current + imported, deduplicate by at+type roughly)
        const combined = [...current.eventLog, ...(imported.eventLog ?? [])];
        merged.eventLog = combined.slice(-200);
        // Keep lastActivityAt as the most recent
        if (current.stats.lastActivityAt && imported.exportedAt) {
          const a = new Date(current.stats.lastActivityAt).getTime();
          const b = new Date(imported.exportedAt).getTime();
          merged.stats.lastActivityAt = a > b ? current.stats.lastActivityAt : imported.exportedAt;
        }
        localStorage.setItem(LS_PROFILE_KEY, JSON.stringify(merged));
        // Ensure widget shows if imported profile has kits
        if (merged.stats.kitsGenerated > 0 || merged.xp > 0) {
          localStorage.setItem(LS_KIT_EVER_KEY, "1");
        }
        awardXp("profile_imported");
        dispatchXpUpdated();
        resolve({ ok: true });
      } catch {
        resolve({ ok: false, error: "Could not parse profile file." });
      }
    };
    reader.onerror = () => resolve({ ok: false, error: "Could not read file." });
    reader.readAsText(file);
  });
}
