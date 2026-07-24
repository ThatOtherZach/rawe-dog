/**
 * Atomized generation pipeline:
 *   load library once → select (Pass 1) → four parallel per-document drafts
 *   → verification pass → targeted repair (max one round) → QA report.
 */

import {
  buildSelectionSystemPrompt,
  buildSelectionUserMessage,
  buildDraftSystemPrompt,
  buildDraftUserMessage,
  buildVerificationSystemPrompt,
  buildVerificationUserMessage,
  buildSpineBlock,
  buildRepairBlock,
} from "./prompt.js";
import { chatStructured, getModelForStage } from "./xai.js";
import {
  buildSelectionSchema,
  DRAFT_SCHEMA,
  VERIFICATION_SCHEMA,
} from "./schemas.js";
import {
  normalizePass1,
  normalizeDraft,
  normalizeVerifier,
  DOC_KEYS,
  DOC_FIELDS,
  DOC_LABELS,
  type ApplicationKit,
  type Pass1Selection,
  type DocKey,
  type DraftOutput,
  type VerifierOutput,
} from "./parse-kit.js";
import {
  loadRunContext,
  listExperienceOptions,
  buildExperienceCatalog,
  resolveLeadsStrict,
  tryResolveSelection,
  applyResolutionToSelection,
  catalogLabel,
  refsToTitles,
  masterForSelection,
  masterForDrafting,
  masterForVerification,
  packLeadsFull,
  packLeadsCompact,
  packSupportingCatalog,
  templatesForModel,
  type RunContext,
  type ExperienceOption,
  type ResolvedSelection,
} from "./context-pack.js";
import { cleanDocumentMarkdown, sanitizeDashPunctuation } from "./clean-md.js";
import {
  buildQaReport,
  docsNeedingRepair,
  type QaReport,
  type QaFinding,
} from "./verify.js";

export type GenerateInput = {
  jobPosting: string;
  company?: string;
  targetTitle?: string;
  notes?: string;
  /** Catalog IDs (preferred); library file IDs or titles also accepted. */
  overrideLeads?: string[];
  skipPass1?: boolean;
};

export type Pass1Stats = {
  pass1Chars: number;
  skippedPass1: boolean;
  retried: boolean;
  selectionModel: string;
};

export type GenerateStats = {
  pass1Chars: number;
  pass2Chars: number;
  verifyChars: number;
  draftChars: Partial<Record<DocKey, number>>;
  leadCount: number;
  experienceTotal: number;
  skippedPass1: boolean;
  pass1Retried: boolean;
  pass2Retried: boolean;
  repairedDocuments: DocKey[];
  repairFailures: string[];
  models: { selection: string; drafting: string; verification: string };
  durationMs: number;
};

export type GenerateProgressEvent =
  | { type: "status"; stage: string; message: string }
  | {
      type: "pass1";
      selection: Pass1Selection;
      experienceOptions: ExperienceOption[];
      stats: Pass1Stats;
      warning?: string;
    }
  | { type: "draft"; doc: DocKey; markdown: string; sourcesUsed: string[] }
  | { type: "qa"; report: QaReport }
  | { type: "repair"; doc: DocKey; markdown: string }
  | {
      type: "done";
      kit: ApplicationKit;
      selection: Pass1Selection;
      experienceOptions: ExperienceOption[];
      qaReport: QaReport;
      stats: GenerateStats;
    }
  | { type: "error"; error: string };

export type GenerateResult = {
  kit: ApplicationKit;
  selection: Pass1Selection;
  experienceOptions: ExperienceOption[];
  qaReport: QaReport;
  stats: GenerateStats;
};

type Emit = (event: GenerateProgressEvent) => void;

/* ---------------------------------------------------------------------- */
/* Stage: selection (Pass 1)                                               */
/* ---------------------------------------------------------------------- */

async function runSelectionStage(
  ctx: RunContext,
  input: GenerateInput,
  emit?: Emit
): Promise<{ selection: Pass1Selection; stats: Pass1Stats; warning?: string }> {
  const job = input.jobPosting?.trim();
  if (!job) throw new Error("Job posting is required.");

  if (input.skipPass1 && input.overrideLeads?.length) {
    let selection = normalizePass1({
      targetTitle: input.targetTitle || "",
      company: input.company || "",
      leadExperienceIds: input.overrideLeads,
      supportingExperienceIds: [],
      keywordsToHit: [],
      rationale: "Manual selection (Pass 1 skipped).",
    });
    const resolved = tryResolveSelection(ctx.experiences, selection);
    selection = applyResolutionToSelection(selection, resolved);
    return {
      selection,
      stats: {
        pass1Chars: 0,
        skippedPass1: true,
        retried: false,
        selectionModel: "manual",
      },
      warning: resolved.unmatched.length
        ? `Some manual selections didn't match library files: ${resolved.unmatched.join(", ")}.`
        : undefined,
    };
  }

  emit?.({ type: "status", stage: "pass1", message: "Selecting experiences (Pass 1)…" });

  const schema = buildSelectionSchema(ctx.experiences.map((e) => e.catalogId));
  const { data, content, meta } = await chatStructured<Pass1Selection>({
    stage: "selection",
    system: buildSelectionSystemPrompt(ctx.customAddon),
    user: buildSelectionUserMessage({
      jobPosting: job,
      company: input.company,
      targetTitle: input.targetTitle,
      notes: input.notes,
      masterProfile: masterForSelection(ctx.master),
      experienceCatalog: buildExperienceCatalog(ctx.experiences),
    }),
    schemaName: "experience_selection",
    schema,
    maxTokens: 1536,
    temperature: 0.2,
  });

  let selection = normalizePass1(data);
  selection.leadExperienceIds = selection.leadExperienceIds.slice(0, 3);
  if (!selection.targetTitle) selection.targetTitle = input.targetTitle || "";
  if (!selection.company) selection.company = input.company || "";

  const resolved = tryResolveSelection(ctx.experiences, selection);
  selection = applyResolutionToSelection(selection, resolved);

  const warning = !resolved.leads.length
    ? "The model's selection didn't match any experience files. Pick lead experiences manually, then write the kit."
    : resolved.unmatched.length
      ? `Some selections didn't match library files and were dropped: ${resolved.unmatched.join(", ")}.`
      : undefined;

  return {
    selection,
    stats: {
      pass1Chars: content.length,
      skippedPass1: false,
      retried: meta.retried || meta.jsonRepaired,
      selectionModel: meta.model,
    },
    warning,
  };
}

/* ---------------------------------------------------------------------- */
/* Stage: per-document drafts (parallel)                                   */
/* ---------------------------------------------------------------------- */

const DRAFT_TOKENS: Record<DocKey, number> = {
  resume: 3072,
  coverLetter: 2048,
  alignmentNotes: 3072,
  starPrep: 3072,
};

function cleanDoc(doc: DocKey, markdown: string): string {
  const cleaned = cleanDocumentMarkdown(markdown);
  return doc === "resume" || doc === "coverLetter"
    ? sanitizeDashPunctuation(cleaned)
    : cleaned;
}

type DraftCallResult = {
  doc: DocKey;
  markdown: string;
  sourcesUsed: string[];
  chars: number;
  retried: boolean;
};

function evidenceForDoc(
  doc: DocKey,
  ctx: RunContext,
  resolved: ResolvedSelection
): { master: string; leads: string; supporting?: string } {
  const leadsFull = packLeadsFull(resolved.leads);
  const supporting = packSupportingCatalog(resolved.supporting) || undefined;
  switch (doc) {
    case "resume":
      return { master: masterForDrafting(ctx.master, 12000), leads: leadsFull, supporting };
    case "coverLetter":
      // The cover letter needs depth on leads, not breadth — skip supporting.
      return { master: masterForDrafting(ctx.master, 8000), leads: leadsFull };
    case "alignmentNotes":
      return { master: masterForDrafting(ctx.master, 10000), leads: leadsFull, supporting };
    case "starPrep":
      return { master: masterForDrafting(ctx.master, 6000), leads: leadsFull, supporting };
  }
}

async function draftDocument(args: {
  ctx: RunContext;
  input: GenerateInput;
  selection: Pass1Selection;
  resolved: ResolvedSelection;
  doc: DocKey;
  repair?: { findings: QaFinding[]; previousMarkdown: string };
}): Promise<DraftCallResult> {
  const { ctx, input, selection, resolved, doc, repair } = args;
  const spine = buildSpineBlock({
    selection,
    leadLabels: resolved.leads.map(catalogLabel),
    supportingLabels: resolved.supporting.map(catalogLabel),
  });
  const tmpl = templatesForModel(ctx.templates.resume, ctx.templates.cover);
  const evidence = evidenceForDoc(doc, ctx, resolved);

  const user = buildDraftUserMessage(doc, {
    jobPosting: input.jobPosting,
    company: input.company,
    targetTitle: input.targetTitle,
    notes: input.notes,
    spine,
    masterProfile: evidence.master,
    resumeTemplate: doc === "resume" ? tmpl.resume : undefined,
    coverTemplate: doc === "coverLetter" ? tmpl.cover : undefined,
    leadEvidence: evidence.leads,
    supportingCatalog: evidence.supporting,
    repairBlock: repair
      ? buildRepairBlock({
          docLabel: DOC_LABELS[doc],
          findings: repair.findings,
          previousMarkdown: repair.previousMarkdown,
        })
      : undefined,
  });

  const { data, content, meta } = await chatStructured<DraftOutput>({
    stage: "drafting",
    system: buildDraftSystemPrompt(doc, ctx.customAddon),
    user,
    schemaName: `draft_${doc.toLowerCase()}`,
    schema: DRAFT_SCHEMA,
    maxTokens: DRAFT_TOKENS[doc] + (repair ? 512 : 0),
    temperature: repair ? 0.2 : 0.35,
  });

  const draft = normalizeDraft(data);
  if (!draft.markdown.trim()) {
    throw new Error(`${DOC_LABELS[doc]} draft came back empty.`);
  }

  return {
    doc,
    markdown: cleanDoc(doc, draft.markdown),
    sourcesUsed: draft.sourcesUsed,
    chars: content.length,
    retried: meta.retried || meta.jsonRepaired,
  };
}

async function runDraftStage(
  ctx: RunContext,
  input: GenerateInput,
  selectionIn: Pass1Selection,
  emit?: Emit
): Promise<{
  kit: ApplicationKit;
  selection: Pass1Selection;
  resolved: ResolvedSelection;
  draftChars: Partial<Record<DocKey, number>>;
  anyRetried: boolean;
}> {
  // Strict ID-based resolution: zero matched leads → clear error, no fallback.
  const resolved = resolveLeadsStrict(ctx.experiences, selectionIn, input.overrideLeads);
  const selection = applyResolutionToSelection(selectionIn, resolved);

  emit?.({
    type: "status",
    stage: "drafting",
    message: `Drafting 4 documents in parallel (${resolved.leads.length} lead experience${
      resolved.leads.length === 1 ? "" : "s"
    })…`,
  });

  const tasks = DOC_KEYS.map((doc) =>
    draftDocument({ ctx, input, selection, resolved, doc }).then((r) => {
      emit?.({ type: "draft", doc, markdown: r.markdown, sourcesUsed: r.sourcesUsed });
      return r;
    })
  );

  const settled = await Promise.allSettled(tasks);
  const results: DraftCallResult[] = [];
  const failures: string[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      results.push(s.value);
    } else {
      const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
      failures.push(`${DOC_LABELS[DOC_KEYS[i]]}: ${reason}`);
    }
  });
  if (failures.length) {
    throw new Error(
      `Draft stage failed for ${failures.length} document(s) — ${failures.join(" | ")}`
    );
  }

  const byDoc = new Map<DocKey, DraftCallResult>(results.map((r) => [r.doc, r]));
  const sourceIds = [...new Set(results.flatMap((r) => r.sourcesUsed))];
  const sourceTitles = refsToTitles(ctx.experiences, sourceIds);

  const kit: ApplicationKit = {
    meta: {
      targetTitle: selection.targetTitle || input.targetTitle || "",
      company: selection.company || input.company || "",
      leadExperiences: resolved.leads.map((l) => l.title),
      rationale: selection.rationale,
      sourcesUsed: sourceTitles.length ? sourceTitles : resolved.leads.map((l) => l.title),
    },
    resumeMarkdown: byDoc.get("resume")!.markdown,
    coverLetterMarkdown: byDoc.get("coverLetter")!.markdown,
    alignmentNotesMarkdown: byDoc.get("alignmentNotes")!.markdown,
    starPrepMarkdown: byDoc.get("starPrep")!.markdown,
  };

  const draftChars: Partial<Record<DocKey, number>> = {};
  for (const r of results) draftChars[r.doc] = r.chars;

  return {
    kit,
    selection,
    resolved,
    draftChars,
    anyRetried: results.some((r) => r.retried),
  };
}

/* ---------------------------------------------------------------------- */
/* Stage: verification                                                     */
/* ---------------------------------------------------------------------- */

async function runVerificationStage(
  ctx: RunContext,
  input: GenerateInput,
  selection: Pass1Selection,
  resolved: ResolvedSelection,
  kit: ApplicationKit,
  emit?: Emit
): Promise<{ verifier: VerifierOutput | null; chars: number; unavailableReason?: string }> {
  emit?.({
    type: "status",
    stage: "verifying",
    message: "Verifying kit (grounding, consistency, form, keywords)…",
  });

  try {
    const { data, content } = await chatStructured<VerifierOutput>({
      stage: "verification",
      system: buildVerificationSystemPrompt(),
      user: buildVerificationUserMessage({
        spine: buildSpineBlock({
          selection,
          leadLabels: resolved.leads.map(catalogLabel),
          supportingLabels: resolved.supporting.map(catalogLabel),
        }),
        jobPosting: input.jobPosting,
        masterProfile: masterForVerification(ctx.master),
        leadEvidence: packLeadsCompact(resolved.leads),
        documents: {
          resume: kit.resumeMarkdown,
          coverLetter: kit.coverLetterMarkdown,
          alignmentNotes: kit.alignmentNotesMarkdown,
          starPrep: kit.starPrepMarkdown,
        },
      }),
      schemaName: "kit_verification",
      schema: VERIFICATION_SCHEMA,
      maxTokens: 3072,
      temperature: 0.1,
    });
    return { verifier: normalizeVerifier(data), chars: content.length };
  } catch (err) {
    // A finished kit is still valuable if the verifier call hiccups:
    // degrade to automated checks and say so in the QA report.
    return {
      verifier: null,
      chars: 0,
      unavailableReason: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ---------------------------------------------------------------------- */
/* Stage: targeted repair (max one round)                                  */
/* ---------------------------------------------------------------------- */

async function runRepairStage(
  ctx: RunContext,
  input: GenerateInput,
  selection: Pass1Selection,
  resolved: ResolvedSelection,
  kit: ApplicationKit,
  report: QaReport,
  emit?: Emit
): Promise<{
  kit: ApplicationKit;
  repaired: DocKey[];
  chars: number;
  anyRetried: boolean;
  failures: string[];
}> {
  const docs = docsNeedingRepair(report.findings);
  if (!docs.length) {
    return { kit, repaired: [], chars: 0, anyRetried: false, failures: [] };
  }

  emit?.({
    type: "status",
    stage: "repairing",
    message: `Repairing flagged document(s): ${docs.map((d) => DOC_LABELS[d]).join(", ")}…`,
  });

  const tasks = docs.map((doc) =>
    draftDocument({
      ctx,
      input,
      selection,
      resolved,
      doc,
      repair: {
        findings: report.findings.filter(
          (f) => f.document === doc && f.severity !== "info"
        ),
        previousMarkdown: String(kit[DOC_FIELDS[doc]] || ""),
      },
    }).then((r) => {
      emit?.({ type: "repair", doc, markdown: r.markdown });
      return r;
    })
  );

  const settled = await Promise.allSettled(tasks);
  const next: ApplicationKit = { ...kit };
  const repaired: DocKey[] = [];
  const failures: string[] = [];
  let chars = 0;
  let anyRetried = false;

  settled.forEach((s, i) => {
    const doc = docs[i];
    if (s.status === "fulfilled") {
      next[DOC_FIELDS[doc]] = s.value.markdown;
      repaired.push(doc);
      chars += s.value.chars;
      anyRetried = anyRetried || s.value.retried;
    } else {
      // Keep the original document; the finding stays open in the report.
      const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
      failures.push(`${DOC_LABELS[doc]}: ${reason}`);
    }
  });

  return { kit: next, repaired, chars, anyRetried, failures };
}

/* ---------------------------------------------------------------------- */
/* Pipeline assembly                                                       */
/* ---------------------------------------------------------------------- */

async function finishKitPipeline(args: {
  ctx: RunContext;
  options: ExperienceOption[];
  input: GenerateInput;
  selection: Pass1Selection;
  pass1Stats: Pass1Stats;
  emit?: Emit;
  t0: number;
}): Promise<GenerateResult> {
  const { ctx, options, input, emit, t0 } = args;

  const drafts = await runDraftStage(ctx, input, args.selection, emit);
  const ver = await runVerificationStage(
    ctx,
    input,
    drafts.selection,
    drafts.resolved,
    drafts.kit,
    emit
  );

  let report = buildQaReport({
    kit: drafts.kit,
    selection: drafts.selection,
    verifier: ver.verifier,
    repairedDocuments: [],
    verifierUnavailableReason: ver.unavailableReason,
  });
  emit?.({ type: "qa", report });

  const rep = await runRepairStage(
    ctx,
    input,
    drafts.selection,
    drafts.resolved,
    drafts.kit,
    report,
    emit
  );

  let kit = rep.kit;
  if (rep.repaired.length) {
    report = buildQaReport({
      kit,
      selection: drafts.selection,
      verifier: ver.verifier,
      repairedDocuments: rep.repaired,
      verifierUnavailableReason: ver.unavailableReason,
    });
    emit?.({ type: "qa", report });
  }

  const pass2Chars =
    Object.values(drafts.draftChars).reduce((a, b) => a + (b || 0), 0) + rep.chars;

  const stats: GenerateStats = {
    pass1Chars: args.pass1Stats.pass1Chars,
    pass2Chars,
    verifyChars: ver.chars,
    draftChars: drafts.draftChars,
    leadCount: drafts.resolved.leads.length,
    experienceTotal: ctx.experiences.length,
    skippedPass1: args.pass1Stats.skippedPass1,
    pass1Retried: args.pass1Stats.retried,
    pass2Retried: drafts.anyRetried || rep.anyRetried,
    repairedDocuments: rep.repaired,
    repairFailures: rep.failures,
    models: {
      selection: args.pass1Stats.selectionModel,
      drafting: getModelForStage("drafting"),
      verification: getModelForStage("verification"),
    },
    durationMs: Date.now() - t0,
  };

  const result: GenerateResult = {
    kit,
    selection: drafts.selection,
    experienceOptions: options,
    qaReport: report,
    stats,
  };
  emit?.({ type: "done", ...result });
  return result;
}

/* ---------------------------------------------------------------------- */
/* Public entry points                                                     */
/* ---------------------------------------------------------------------- */

/** Pass 1 only — used by the two-step UI flow. */
export async function runSelectionOnly(
  input: GenerateInput,
  emit?: Emit
): Promise<{
  selection: Pass1Selection;
  experienceOptions: ExperienceOption[];
  stats: Pass1Stats;
  warning?: string;
}> {
  const ctx = await loadRunContext();
  const options = listExperienceOptions(ctx.experiences);
  const sel = await runSelectionStage(ctx, input, emit);
  emit?.({
    type: "pass1",
    selection: sel.selection,
    experienceOptions: options,
    stats: sel.stats,
    warning: sel.warning,
  });
  return {
    selection: sel.selection,
    experienceOptions: options,
    stats: sel.stats,
    warning: sel.warning,
  };
}

/** Drafts + verify + repair from a provided selection (Pass 2 flow). */
export async function runKitFromSelection(
  input: GenerateInput,
  rawSelection: Partial<Pass1Selection>,
  emit?: Emit
): Promise<GenerateResult> {
  const t0 = Date.now();
  if (!input.jobPosting?.trim()) throw new Error("Job posting is required.");
  const ctx = await loadRunContext(); // library parsed once for this run
  const options = listExperienceOptions(ctx.experiences);
  const selection = normalizePass1(rawSelection);
  return finishKitPipeline({
    ctx,
    options,
    input,
    selection,
    pass1Stats: {
      pass1Chars: 0,
      skippedPass1: true,
      retried: false,
      selectionModel: "provided",
    },
    emit,
    t0,
  });
}

/** Full pipeline: selection → drafts → verification → repair. */
export async function generateApplicationKit(
  input: GenerateInput,
  emit?: Emit
): Promise<GenerateResult> {
  const t0 = Date.now();
  if (!input.jobPosting?.trim()) throw new Error("Job posting is required.");
  const ctx = await loadRunContext(); // library parsed once for the entire run
  const options = listExperienceOptions(ctx.experiences);

  const sel = await runSelectionStage(ctx, input, emit);
  emit?.({
    type: "pass1",
    selection: sel.selection,
    experienceOptions: options,
    stats: sel.stats,
    warning: sel.warning,
  });

  return finishKitPipeline({
    ctx,
    options,
    input,
    selection: sel.selection,
    pass1Stats: sel.stats,
    emit,
    t0,
  });
}
