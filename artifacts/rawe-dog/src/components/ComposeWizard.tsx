import { useState } from "react";
import { Link } from "wouter";
import { MarkdownView } from "./MarkdownView";

export type ComposeSlot = "master-profile" | "system-instructions" | "experience";

type Question = {
  prompt: string;
  hint?: string;
  placeholder?: string;
  multiline?: boolean;
  optional?: boolean;
};

const QUESTION_SETS: Record<ComposeSlot, Question[]> = {
  "master-profile": [
    {
      prompt: "Your name, email, phone, and city",
      placeholder: "Jane Doe · jane@… · +1 555… · Toronto, Canada",
    },
    {
      prompt: "Links — LinkedIn, portfolio, GitHub",
      placeholder: "linkedin.com/in/… (or 'none')",
      optional: true,
    },
    {
      prompt: "What do you do, and how long have you done it?",
      hint: "A couple of first-person sentences on what you're known for.",
      multiline: true,
    },
    {
      prompt: "Which job titles are you targeting?",
      hint: "Most-wanted first, 1-3 titles.",
      placeholder: "Backend Engineer, Platform Engineer",
    },
    {
      prompt: "Where are you based, and where are you authorized to work?",
      hint: "Include visa status if relevant.",
    },
    {
      prompt: "Remote, hybrid, or on-site? Would you relocate?",
    },
    {
      prompt: "Your strongest skills and the tools you actually use",
      hint: "Strongest first. Honest beats long.",
      multiline: true,
    },
    {
      prompt: "Constraints: salary floor, notice period, deal-breakers",
      placeholder: "e.g. CAD 120k floor · 4 weeks notice · no on-call (or 'none')",
      optional: true,
    },
  ],
  "system-instructions": [
    {
      prompt: "How should your applications sound?",
      hint: "Voice and tone rules — e.g. plain and direct, no buzzwords.",
      multiline: true,
      optional: true,
    },
    {
      prompt: "What should every resume and cover letter emphasize?",
      hint: "1-3 themes.",
      optional: true,
    },
    {
      prompt: "Anything the model must never claim about you?",
      placeholder: "e.g. never call me 'senior' — I apply as mid-level",
      optional: true,
    },
    {
      prompt: "Formatting quirks?",
      placeholder: "e.g. British spelling — I apply in the UK (or 'skip')",
      optional: true,
    },
  ],
  experience: [
    {
      prompt: "Company name, industry, and rough size",
      placeholder: "Acme Corp — logistics SaaS, ~200 people",
    },
    {
      prompt: "Your exact job title",
    },
    {
      prompt: "Start and end dates",
      placeholder: "Mar 2019 – Jun 2022 (or '– present')",
    },
    {
      prompt: "What was the role?",
      hint: "Your scope, who you worked with, what you owned. 2-4 sentences.",
      multiline: true,
    },
    {
      prompt: "2-4 wins — WITH numbers",
      hint: "Kit verification checks resume claims against these, so quantify honestly. One win per line.",
      placeholder: "Cut deploy time from 45 min to 8 by …",
      multiline: true,
    },
    {
      prompt: "Tech and tools you truly used in this role",
    },
  ],
};

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

type Phase = "questions" | "composing" | "review" | "saving" | "roleSaved";

export function ComposeWizard({
  slot,
  slotTitle,
  hasExisting,
  hasApiKey,
  onClose,
  onSaved,
}: {
  slot: ComposeSlot;
  slotTitle: string;
  hasExisting: boolean;
  hasApiKey: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const questions = QUESTION_SETS[slot];
  const [phase, setPhase] = useState<Phase>("questions");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [composed, setComposed] = useState<string | null>(null);
  const [tweak, setTweak] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  const q = questions[step];
  const answered = answers.some((a) => a.trim());
  const canAdvance = q ? (q.optional ? true : answers[step].trim().length > 0) : false;
  const isLast = step === questions.length - 1;

  function setAnswer(value: string) {
    setAnswers((prev) => prev.map((a, i) => (i === step ? value : a)));
  }

  async function compose(tweakNote?: string) {
    setPhase("composing");
    setError(null);
    try {
      const payload = {
        slot,
        answers: questions.map((question, i) => ({
          question: question.prompt,
          answer: answers[i].trim(),
        })),
        ...(tweakNote && tweakNote.trim() ? { tweakNote: tweakNote.trim() } : {}),
      };
      const res = await fetch("/api/library/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { markdown?: string; error?: string };
      if (!res.ok) throw new Error(json.error || "Compose failed");
      setComposed(json.markdown || "");
      setTweak("");
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Keep the previous draft if a regenerate failed; otherwise back to questions.
      setPhase(composed ? "review" : "questions");
    }
  }

  function fileName(): string {
    if (slot === "master-profile") return "Master-Profile.md";
    if (slot === "system-instructions") return "System-Instructions.md";
    const title = answers[1] || "";
    const company = (answers[0] || "").split(/[,(—–-]/)[0];
    const slug = slugify(`${title} ${company}`);
    return `${slug || "experience-role"}.md`;
  }

  async function accept() {
    if (!composed) return;
    if (
      slot !== "experience" &&
      hasExisting &&
      !window.confirm(`Replace your current ${slotTitle} file with this one?`)
    ) {
      return;
    }
    setPhase("saving");
    setError(null);
    try {
      const file = new File([composed], fileName(), { type: "text/markdown" });
      const form = new FormData();
      form.set("slot", slot);
      form.set("file", file);
      const res = await fetch("/api/library", { method: "POST", body: form });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Save failed");
      await onSaved();
      if (slot === "experience") {
        setSavedCount((c) => c + 1);
        setPhase("roleSaved");
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("review");
    }
  }

  function startNextRole() {
    setAnswers(questions.map(() => ""));
    setComposed(null);
    setTweak("");
    setError(null);
    setStep(0);
    setPhase("questions");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      data-testid="compose-wizard"
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <h3 className="mr-auto font-semibold">
            Compose: {slotTitle}
            {slot === "experience" && savedCount > 0 && (
              <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                {savedCount} role{savedCount > 1 ? "s" : ""} saved
              </span>
            )}
          </h3>
          <button className="btn" onClick={onClose} data-testid="compose-close">
            Close
          </button>
        </div>

        {slot === "experience" && phase === "questions" && step === 0 && (
          <p className="mb-3 text-xs text-[var(--muted)]">
            One role at a time — start with your OLDEST role. Catalog IDs (E1,
            E2, …) follow save order.
          </p>
        )}

        {error && (
          <div
            className="mb-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[#2a1414] px-3 py-2 text-sm text-[var(--danger)]"
            data-testid="compose-error"
          >
            {error}
          </div>
        )}

        {!hasApiKey ? (
          <div className="py-6 text-sm text-[var(--muted)]" data-testid="compose-no-key">
            The quiz composes your document with your configured model, and no
            API key is set yet.{" "}
            <Link href="/settings" className="text-[var(--accent)] underline">
              Add your key in Settings
            </Link>{" "}
            first, then come back.
          </div>
        ) : phase === "questions" && q ? (
          <div>
            <div className="mb-1 text-xs text-[var(--muted)]">
              Question {step + 1} of {questions.length}
              {q.optional ? " · optional" : ""}
            </div>
            <div className="mb-1 font-medium" data-testid="compose-question">
              {q.prompt}
            </div>
            {q.hint && (
              <p className="mb-2 text-xs text-[var(--muted)]">{q.hint}</p>
            )}
            {q.multiline ? (
              <textarea
                className="input w-full"
                rows={5}
                value={answers[step]}
                placeholder={q.placeholder || ""}
                onChange={(e) => setAnswer(e.target.value)}
                data-testid="compose-input"
                autoFocus
              />
            ) : (
              <input
                className="input w-full"
                value={answers[step]}
                placeholder={q.placeholder || ""}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !canAdvance) return;
                  // Mirror the button gating: composing needs ≥1 answered question.
                  if (isLast) {
                    if (answered) void compose();
                  } else {
                    setStep((s) => s + 1);
                  }
                }}
                data-testid="compose-input"
                autoFocus
              />
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                className="btn"
                disabled={step === 0}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                data-testid="compose-back"
              >
                Back
              </button>
              {isLast ? (
                <button
                  className="btn btn-primary"
                  disabled={!canAdvance || !answered}
                  onClick={() => void compose()}
                  data-testid="compose-submit"
                >
                  Compose
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  disabled={!canAdvance}
                  onClick={() => setStep((s) => s + 1)}
                  data-testid="compose-next"
                >
                  Next
                </button>
              )}
              {isLast && !answered && (
                <span className="text-xs text-[var(--muted)]">
                  Answer at least one question to compose.
                </span>
              )}
            </div>
          </div>
        ) : phase === "composing" ? (
          <div className="py-8 text-center text-sm text-[var(--muted)]" data-testid="compose-busy">
            Composing with your model…
          </div>
        ) : phase === "saving" ? (
          <div className="py-8 text-center text-sm text-[var(--muted)]">Saving…</div>
        ) : phase === "roleSaved" ? (
          <div className="py-4" data-testid="compose-role-saved">
            <p className="mb-4 text-sm">
              Role saved ✓ — it's in your library now. Add another role?
            </p>
            <div className="flex gap-2">
              <button
                className="btn btn-primary"
                onClick={startNextRole}
                data-testid="compose-add-role"
              >
                Add another role
              </button>
              <button className="btn" onClick={onClose} data-testid="compose-done">
                Done
              </button>
            </div>
          </div>
        ) : phase === "review" && composed != null ? (
          <div>
            <p className="mb-2 text-xs text-[var(--muted)]">
              Review the draft. Nothing is saved until you accept.
            </p>
            <div
              className="mb-3 max-h-[45vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[#0c0e13] p-4"
              data-testid="compose-review"
            >
              <MarkdownView source={composed} />
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                className="btn btn-primary"
                onClick={() => void accept()}
                data-testid="compose-accept"
              >
                Accept &amp; save{slot === "experience" ? " this role" : ""}
              </button>
              <button
                className="btn"
                onClick={() => setPhase("questions")}
                data-testid="compose-edit-answers"
              >
                Back to questions
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input min-w-0 flex-1"
                value={tweak}
                placeholder="Optional: what should change? e.g. 'shorter, punchier wins'"
                onChange={(e) => setTweak(e.target.value)}
                data-testid="compose-tweak"
              />
              <button
                className="btn"
                onClick={() => void compose(tweak)}
                data-testid="compose-regenerate"
              >
                Regenerate
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
