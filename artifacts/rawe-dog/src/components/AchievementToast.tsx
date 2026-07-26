/**
 * AchievementToast — bottom-right achievement notification layer.
 *
 * Listens for "rawedog:achievement" events, queues them, and shows one at a
 * time with a 4-second auto-dismiss.  Renders fixed, above the XP widget.
 */
import { useEffect, useRef, useState } from "react";
import type { AchievementRecord } from "../lib/xpStore";

type ToastEntry = AchievementRecord & { toastId: number };

let _toastSeq = 0;

export function AchievementToast() {
  const [queue, setQueue] = useState<ToastEntry[]>([]);
  const [visible, setVisible] = useState<ToastEntry | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drain queue: pop next when nothing is visible
  useEffect(() => {
    if (visible !== null) return;
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setVisible(next);
    timerRef.current = setTimeout(() => {
      setVisible(null);
      timerRef.current = null;
    }, 4_000);
  }, [visible, queue]);

  // Listen for unlock events
  useEffect(() => {
    const handler = (e: Event) => {
      const achievement = (e as CustomEvent<{ achievement: AchievementRecord }>).detail
        .achievement;
      const entry: ToastEntry = { ...achievement, toastId: ++_toastSeq };
      setQueue((q) => [...q, entry]);
    };
    window.addEventListener("rawedog:achievement", handler);
    return () => window.removeEventListener("rawedog:achievement", handler);
  }, []);

  function dismiss() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(null);
  }

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-24 right-4 z-50 w-80 animate-[slideUp_0.25s_ease-out]"
      style={{
        animation: "slideUp 0.25s ease-out",
      }}
    >
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-[#0e1820] p-3 shadow-xl shadow-black/40">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-2xl leading-none">{visible.icon}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">
              Achievement unlocked
            </p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--text)]">{visible.name}</p>
            <p className="mt-0.5 text-xs text-[var(--muted)] leading-relaxed">{visible.flavour}</p>
          </div>
          <button
            className="shrink-0 text-[var(--muted)] opacity-60 hover:opacity-100"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
