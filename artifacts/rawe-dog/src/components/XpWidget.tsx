/**
 * XpWidget — persistent corner widget showing level + XP bar.
 *
 * Hidden until the first kit is generated (rawedog_kit_ever_generated in
 * localStorage).  Clicking opens the profile panel.
 */
import { useEffect, useState } from "react";
import {
  ACHIEVEMENT_DEFS,
  LS_KIT_EVER_KEY,
  exportProfile,
  importProfile,
  levelForXp,
  loadProfile,
  xpProgress,
} from "../lib/xpStore";
import type { Profile } from "../lib/xpStore";

function useXpProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [kitEver, setKitEver] = useState(false);

  function reload() {
    const ke = localStorage.getItem(LS_KIT_EVER_KEY) === "1";
    setKitEver(ke);
    if (ke) setProfile(loadProfile());
  }

  useEffect(() => {
    reload();
    const onUpdate = () => reload();
    window.addEventListener("rawedog:xp_updated", onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener("rawedog:xp_updated", onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { profile, kitEver, reload };
}

export function XpWidget() {
  const { profile, kitEver } = useXpProfile();
  const [panelOpen, setPanelOpen] = useState(false);

  if (!kitEver || !profile) return null;

  const { name } = levelForXp(profile.xp);
  const { pct } = xpProgress(profile.xp);

  return (
    <>
      {/* Widget button */}
      <button
        onClick={() => setPanelOpen(true)}
        title="Your XP profile"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2.5 rounded-2xl border border-[color-mix(in_srgb,var(--accent)_30%,var(--border))] bg-[#0e1820] px-3 py-2 shadow-lg shadow-black/30 transition hover:border-[color-mix(in_srgb,var(--accent)_60%,var(--border))]"
      >
        <div className="flex flex-col items-start gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">
            {name}
          </span>
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[#60a5fa] transition-all duration-500"
              style={{ width: `${Math.round(pct * 100)}%` }}
            />
          </div>
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--text)]">
          {profile.xp.toLocaleString()} XP
        </span>
      </button>

      {/* Profile panel */}
      {panelOpen && <ProfilePanel profile={profile} onClose={() => setPanelOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Profile panel
// ---------------------------------------------------------------------------

function ProfilePanel({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const { name: levelName, index: levelIndex } = levelForXp(profile.xp);
  const { pct, current, needed } = xpProgress(profile.xp);
  const [importError, setImportError] = useState<string | null>(null);
  const [importOk, setImportOk] = useState(false);
  const { reload } = useXpProfile();

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportOk(false);
    const result = await importProfile(file);
    if (result.ok) {
      setImportOk(true);
      reload();
    } else {
      setImportError(result.error ?? "Import failed.");
    }
    e.target.value = "";
  }

  // Sort achievements: unlocked first (by date), then locked
  const unlockedIds = new Set(profile.achievements.map((a) => a.id));
  const unlockedMap = new Map(profile.achievements.map((a) => [a.id, a.unlockedAt]));

  const sortedDefs = [...ACHIEVEMENT_DEFS].sort((a, b) => {
    const au = unlockedIds.has(a.id);
    const bu = unlockedIds.has(b.id);
    if (au && !bu) return -1;
    if (!au && bu) return 1;
    if (au && bu) {
      return (unlockedMap.get(a.id) ?? "").localeCompare(unlockedMap.get(b.id) ?? "");
    }
    return 0;
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 flex h-full max-h-screen w-full max-w-sm flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">XP Profile</h2>
            <p className="text-xs text-[var(--muted)]">Office Space edition</p>
          </div>
          <button
            className="text-[var(--muted)] hover:text-[var(--text)]"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Level section */}
          <div className="border-b border-[var(--border)] px-5 py-4">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-sm font-semibold text-[var(--accent)]">{levelName}</span>
              <span className="text-xs text-[var(--muted)]">Level {levelIndex + 1}</span>
            </div>
            <div className="mb-1 h-2 overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[#60a5fa] transition-all duration-500"
                style={{ width: `${Math.round(pct * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-[var(--muted)]">
              <span>{profile.xp.toLocaleString()} XP total</span>
              {needed > 0 ? (
                <span>{current.toLocaleString()} / {needed.toLocaleString()} to next</span>
              ) : (
                <span>Max level 🎉</span>
              )}
            </div>

            {/* Quick stats */}
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Kits", value: profile.stats.kitsGenerated },
                { label: "Applied", value: profile.stats.applicationsTotal },
                { label: "Searches", value: profile.stats.paidSearchesTotal },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-[var(--border)] bg-[#0c0e13] py-2">
                  <div className="text-sm font-bold text-[var(--text)]">{value}</div>
                  <div className="text-[10px] text-[var(--muted)]">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Achievements */}
          <div className="px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Achievements{" "}
                <span className="font-normal text-[var(--muted)]">
                  {unlockedIds.size}/{ACHIEVEMENT_DEFS.length}
                </span>
              </h3>
            </div>
            <div className="space-y-2">
              {sortedDefs.map((def) => {
                const isUnlocked = unlockedIds.has(def.id);
                const unlockedAt = unlockedMap.get(def.id);
                return (
                  <div
                    key={def.id}
                    className={`flex items-start gap-3 rounded-lg border p-3 transition ${
                      isUnlocked
                        ? "border-[color-mix(in_srgb,var(--accent)_25%,var(--border))] bg-[#0d1a14]"
                        : "border-[var(--border)] bg-[#0c0e13] opacity-40"
                    }`}
                  >
                    <span className="text-xl leading-none">{isUnlocked ? def.icon : "🔒"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[var(--text)]">
                        {isUnlocked ? def.name : "???"}
                      </p>
                      {isUnlocked && (
                        <>
                          <p className="mt-0.5 text-[11px] text-[var(--muted)] leading-relaxed">
                            {def.flavour}
                          </p>
                          {unlockedAt && (
                            <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                              {new Date(unlockedAt).toLocaleDateString()}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="border-t border-[var(--border)] px-5 py-4">
          {importError && (
            <p className="mb-2 text-xs text-[var(--danger)]">{importError}</p>
          )}
          {importOk && (
            <p className="mb-2 text-xs text-[var(--accent)]">Profile imported and merged ✓</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-primary flex-1"
              onClick={() => exportProfile()}
            >
              Export JSON
            </button>
            <label className="btn flex-1 cursor-pointer text-center">
              Import JSON
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => void handleImport(e)}
              />
            </label>
          </div>
          <p className="mt-2 text-[10px] text-[var(--muted)]">
            Export downloads your profile as JSON. Import merges a saved profile — higher XP and union of achievements always win.
          </p>
        </div>
      </div>
    </div>
  );
}
