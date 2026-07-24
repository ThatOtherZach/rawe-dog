import {
  buildSystemPrompt,
  buildPass1SystemPrompt,
  buildPass1UserMessage,
  buildPass2UserMessage,
} from "./prompt";
import { chatJsonParsed } from "./xai";
import {
  normalizePass1,
  normalizeKit,
  type ApplicationKit,
  type Pass1Selection,
} from "./parse-kit";
import {
  loadMasterProfile,
  loadSystemAddon,
  loadTemplates,
  loadAllExperiences,
  buildExperienceCatalog,
  resolveLeads,
  packLeadsForPass2,
  packSupportingCatalog,
  masterForPass1,
  masterForPass2,
  templatesForModel,
  listExperienceOptions,
  type LoadedDoc,
} from "./context-pack";
import { libraryReadiness } from "./library";
import { cleanDocumentMarkdown } from "./clean-md";

export type GenerateInput = {
  jobPosting: string;
  company?: string;
  targetTitle?: string;
  notes?: string;
  /** If set, skip pass 1 and use these lead titles/file names. */
  overrideLeads?: string[];
  /** If true and overrideLeads set, skip pass 1 entirely. */
  skipPass1?: boolean;
};

export type GenerateProgressEvent =
  | { type: "status"; stage: string; message: string }
  | {
      type: "pass1";
      selection: Pass1Selection;
      experienceOptions: { id: string; title: string; fileName: string }[];
      stats: { pass1Chars: number; skippedPass1: boolean; retried: boolean };
    }
  | {
      type: "done";
      kit: ApplicationKit;
      selection: Pass1Selection;
      stats: {
        pass1Chars: number;
        pass2Chars: number;
        leadCount: number;
        experienceTotal: number;
        skippedPass1: boolean;
        pass1Retried: boolean;
        pass2Retried: boolean;
      };
    }
  | { type: "error"; error: string };

export type GenerateResult = {
  kit: ApplicationKit;
  selection: Pass1Selection;
  experienceOptions: { id: string; title: string; fileName: string }[];
  stats: {
    pass1Chars: number;
    pass2Chars: number;
    leadCount: number;
    experienceTotal: number;
    skippedPass1: boolean;
    pass1Retried: boolean;
    pass2Retried: boolean;
  };
};

type Emit = (event: GenerateProgressEvent) => void;

function cleanKit(kit: ApplicationKit): ApplicationKit {
  return {
    ...kit,
    resumeMarkdown: cleanDocumentMarkdown(kit.resumeMarkdown),
    coverLetterMarkdown: cleanDocumentMarkdown(kit.coverLetterMarkdown),
    alignmentNotesMarkdown: cleanDocumentMarkdown(kit.alignmentNotesMarkdown),
    starPrepMarkdown: cleanDocumentMarkdown(kit.starPrepMarkdown),
  };
}

async function loadContext() {
  const readiness = libraryReadiness();
  if (!readiness.ready) {
    throw new Error(
      "Library incomplete. Upload Master Profile, at least one experience file, and resume + cover templates."
    );
  }

  const [master, customAddon, templates, experiences] = await Promise.all([
    loadMasterProfile(),
    loadSystemAddon(),
    loadTemplates(),
    loadAllExperiences(),
  ]);

  if (!master) throw new Error("Master Profile missing.");
  if (!templates.resume || !templates.cover) {
    throw new Error("Resume and cover templates are required.");
  }
  if (!experiences.length) throw new Error("No experience files loaded.");

  return { master, customAddon, templates, experiences };
}

export async function runPass1Only(
  input: GenerateInput,
  emit?: Emit
): Promise<{
  selection: Pass1Selection;
  experienceOptions: { id: string; title: string; fileName: string }[];
  stats: { pass1Chars: number; skippedPass1: boolean; retried: boolean };
}> {
  const job = input.jobPosting?.trim();
  if (!job) throw new Error("Job posting is required.");

  emit?.({
    type: "status",
    stage: "load",
    message: "Loading library…",
  });

  const { master, customAddon, experiences } = await loadContext();
  const catalog = buildExperienceCatalog(experiences);
  const options = listExperienceOptions(experiences);

  if (input.skipPass1 && input.overrideLeads?.length) {
    const selection = normalizePass1({
      targetTitle: input.targetTitle || "",
      company: input.company || "",
      leadExperiences: input.overrideLeads,
      supportingExperiences: [],
      keywordsToHit: [],
      rationale: "User selected lead experiences.",
    });
    const result = {
      selection,
      experienceOptions: options,
      stats: { pass1Chars: 0, skippedPass1: true, retried: false },
    };
    emit?.({ type: "pass1", ...result });
    return result;
  }

  if (experiences.length <= 2) {
    const selection = normalizePass1({
      targetTitle: input.targetTitle || "",
      company: input.company || "",
      leadExperiences: experiences.map((e) => e.title),
      supportingExperiences: [],
      keywordsToHit: [],
      rationale: "Few experience files; using all as lead context.",
    });
    const result = {
      selection,
      experienceOptions: options,
      stats: { pass1Chars: 0, skippedPass1: true, retried: false },
    };
    emit?.({ type: "pass1", ...result });
    return result;
  }

  emit?.({
    type: "status",
    stage: "pass1",
    message: "Pass 1: selecting lead experiences…",
  });

  const system = buildPass1SystemPrompt(customAddon);
  const pass1User = buildPass1UserMessage({
    jobPosting: job,
    company: input.company,
    targetTitle: input.targetTitle,
    notes: input.notes,
    masterProfile: masterForPass1(master),
    experienceCatalog: catalog,
  });
  const pass1Chars = system.length + pass1User.length;

  const { data, retried } = await chatJsonParsed<Partial<Pass1Selection>>({
    system,
    user: pass1User,
    maxTokens: 1200,
    temperature: 0.2,
  });

  const selection = normalizePass1(data);
  if (input.company && !selection.company) selection.company = input.company;
  if (input.targetTitle && !selection.targetTitle) {
    selection.targetTitle = input.targetTitle;
  }

  const result = {
    selection,
    experienceOptions: options,
    stats: { pass1Chars, skippedPass1: false, retried },
  };
  emit?.({ type: "pass1", ...result });
  return result;
}

export async function runPass2(
  input: GenerateInput,
  selection: Pass1Selection,
  emit?: Emit
): Promise<GenerateResult> {
  const job = input.jobPosting?.trim();
  if (!job) throw new Error("Job posting is required.");

  emit?.({
    type: "status",
    stage: "load",
    message: "Loading evidence for Pass 2…",
  });

  const { master, customAddon, templates, experiences } = await loadContext();
  const options = listExperienceOptions(experiences);

  const { leads, supporting } = resolveLeads(
    experiences,
    selection,
    input.overrideLeads
  );

  // Reflect final leads on selection for UI
  const finalSelection: Pass1Selection = {
    ...selection,
    leadExperiences: leads.map((l) => l.title),
  };

  const leadPack = packLeadsForPass2(leads, selection.keywordsToHit);
  const supportPack = packSupportingCatalog(supporting);
  const tpls = templatesForModel(
    templates.resume as LoadedDoc,
    templates.cover as LoadedDoc
  );

  emit?.({
    type: "status",
    stage: "pass2",
    message: `Pass 2: writing kit from ${leads.map((l) => l.title).join(", ")}…`,
  });

  const system = buildSystemPrompt(customAddon);
  const pass2User = buildPass2UserMessage({
    jobPosting: job,
    company: input.company || selection.company,
    targetTitle: input.targetTitle || selection.targetTitle,
    notes: input.notes,
    masterProfile: masterForPass2(master),
    resumeTemplate: tpls.resume,
    coverTemplate: tpls.cover,
    selectionJson: JSON.stringify(finalSelection, null, 2),
    leadExperiencesFull: leadPack,
    supportingCatalog: supportPack || undefined,
  });
  const pass2Chars = system.length + pass2User.length;

  const { data, retried } = await chatJsonParsed<Partial<ApplicationKit>>({
    system,
    user: pass2User,
    maxTokens: 8192,
    temperature: 0.35,
  });

  let kit = cleanKit(normalizeKit(data));
  if (!kit.meta.leadExperiences.length) {
    kit.meta.leadExperiences = leads.map((l) => l.title);
  }
  if (!kit.meta.sourcesUsed.length) {
    kit.meta.sourcesUsed = leads.map((l) => l.title);
  }
  if (!kit.meta.rationale) kit.meta.rationale = selection.rationale;

  // Append grounding footer to alignment if missing sources mention
  if (
    kit.alignmentNotesMarkdown &&
    !/source/i.test(kit.alignmentNotesMarkdown)
  ) {
    kit = {
      ...kit,
      alignmentNotesMarkdown:
        kit.alignmentNotesMarkdown +
        `\n\n## Sources used\n${kit.meta.sourcesUsed.map((s) => `- ${s}`).join("\n")}`,
    };
  }

  const result: GenerateResult = {
    kit,
    selection: finalSelection,
    experienceOptions: options,
    stats: {
      pass1Chars: 0,
      pass2Chars,
      leadCount: leads.length,
      experienceTotal: experiences.length,
      skippedPass1: false,
      pass1Retried: false,
      pass2Retried: retried,
    },
  };

  emit?.({
    type: "done",
    kit: result.kit,
    selection: result.selection,
    stats: result.stats,
  });

  return result;
}

/** One-shot full generate (pass1 + pass2), used by simple POST and smoke tests. */
export async function generateApplicationKit(
  input: GenerateInput,
  emit?: Emit
): Promise<GenerateResult> {
  try {
    const pass1 = await runPass1Only(input, emit);
    const pass2 = await runPass2(
      {
        ...input,
        overrideLeads:
          input.overrideLeads?.length
            ? input.overrideLeads
            : pass1.selection.leadExperiences,
      },
      pass1.selection,
      emit
    );

    return {
      ...pass2,
      stats: {
        ...pass2.stats,
        pass1Chars: pass1.stats.pass1Chars,
        skippedPass1: pass1.stats.skippedPass1,
        pass1Retried: pass1.stats.retried,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit?.({ type: "error", error: message });
    throw err;
  }
}
