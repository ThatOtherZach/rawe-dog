import {
  buildSystemPrompt,
  buildPass1SystemPrompt,
  buildPass1UserMessage,
  buildPass2UserMessage,
} from "./prompt.js";
import { chatJsonParsed } from "./xai.js";
import {
  normalizePass1,
  normalizeKit,
  type ApplicationKit,
  type Pass1Selection,
} from "./parse-kit.js";
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
} from "./context-pack.js";
import { libraryReadiness } from "./library.js";
import { cleanDocumentMarkdown } from "./clean-md.js";

export type GenerateInput = {
  jobPosting: string;
  company?: string;
  targetTitle?: string;
  notes?: string;
  overrideLeads?: string[];
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

  emit?.({ type: "status", stage: "load", message: "Loading library…" });

  const { master, customAddon, experiences } = await loadContext();
  const catalog = buildExperienceCatalog(experiences);
  const options = listExperienceOptions(experiences);

  if (input.skipPass1 && input.overrideLeads?.length) {
    const selection: Pass1Selection = {
      targetTitle: input.targetTitle || "",
      company: input.company || "",
      leadExperiences: input.overrideLeads,
      supportingExperiences: [],
      keywordsToHit: [],
      rationale: "Manual override — skip pass 1.",
    };
    return { selection, experienceOptions: options, stats: { pass1Chars: 0, skippedPass1: true, retried: false } };
  }

  emit?.({ type: "status", stage: "pass1", message: "Selecting experiences (Pass 1)…" });

  const system = buildPass1SystemPrompt(customAddon);
  const user = buildPass1UserMessage({
    jobPosting: job,
    company: input.company,
    targetTitle: input.targetTitle,
    notes: input.notes,
    masterProfile: masterForPass1(master),
    experienceCatalog: catalog,
  });

  const { data, content, retried } = await chatJsonParsed<Pass1Selection>({
    system,
    user,
    maxTokens: 2048,
  });

  const selection = normalizePass1(data);
  return {
    selection,
    experienceOptions: options,
    stats: { pass1Chars: content.length, skippedPass1: false, retried },
  };
}

export async function runPass2(
  input: GenerateInput,
  selection: Pass1Selection,
  emit?: Emit
): Promise<{
  kit: ApplicationKit;
  selection: Pass1Selection;
  stats: { pass2Chars: number; leadCount: number; pass2Retried: boolean };
}> {
  emit?.({ type: "status", stage: "pass2", message: "Writing application kit (Pass 2)…" });

  const { master, customAddon, templates, experiences } = await loadContext();
  const { leads, supporting } = resolveLeads(experiences, selection, input.overrideLeads);
  const leadsFull = packLeadsForPass2(leads);
  const supportingCatalog = packSupportingCatalog(supporting);
  const tmpl = templatesForModel(templates.resume!, templates.cover!);

  const system = buildSystemPrompt(customAddon);
  const user = buildPass2UserMessage({
    jobPosting: input.jobPosting,
    company: input.company,
    targetTitle: input.targetTitle,
    notes: input.notes,
    masterProfile: masterForPass2(master),
    resumeTemplate: tmpl.resume,
    coverTemplate: tmpl.cover,
    selectionJson: JSON.stringify(selection, null, 2),
    leadExperiencesFull: leadsFull,
    supportingCatalog,
  });

  const { data, content, retried } = await chatJsonParsed<ApplicationKit>({
    system,
    user,
    maxTokens: 8192,
  });

  const kit = cleanKit(normalizeKit(data));
  return {
    kit,
    selection,
    stats: { pass2Chars: content.length, leadCount: leads.length, pass2Retried: retried },
  };
}

export async function generateApplicationKit(
  input: GenerateInput,
  emit?: Emit
): Promise<GenerateResult> {
  const pass1Result = await runPass1Only(input, emit);
  const pass2Result = await runPass2(input, pass1Result.selection, emit);

  const result: GenerateResult = {
    kit: pass2Result.kit,
    selection: pass2Result.selection,
    experienceOptions: pass1Result.experienceOptions,
    stats: {
      pass1Chars: pass1Result.stats.pass1Chars,
      pass2Chars: pass2Result.stats.pass2Chars,
      leadCount: pass2Result.stats.leadCount,
      experienceTotal: pass1Result.experienceOptions.length,
      skippedPass1: pass1Result.stats.skippedPass1,
      pass1Retried: pass1Result.stats.retried,
      pass2Retried: pass2Result.stats.pass2Retried,
    },
  };

  emit?.({ type: "done", ...result });
  return result;
}
