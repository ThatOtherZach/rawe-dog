import {
  listExperienceFiles,
  readLibraryFileBuffer,
  type LibraryFileMeta,
} from "./library.js";
import {
  compactExperience,
  compactMasterProfile,
  compactTemplate,
  normalizeMarkdown,
  packLeadExperience,
  extractTitle,
} from "./normalize-md.js";
import { fileToModelText } from "./pdf-text.js";
import type { Pass1Selection } from "./parse-kit.js";

export type LoadedDoc = {
  meta: LibraryFileMeta;
  text: string;
  title: string;
};

async function loadSlotSingle(
  slot:
    | "master-profile"
    | "system-instructions"
    | "resume-template"
    | "cover-template"
): Promise<LoadedDoc | null> {
  const hit = readLibraryFileBuffer(slot);
  if (!hit) return null;
  const raw = await fileToModelText(
    hit.buffer,
    hit.meta.kind,
    hit.meta.originalName
  );
  const text = hit.meta.kind === "pdf" ? raw : normalizeMarkdown(raw);
  return {
    meta: hit.meta,
    text,
    title: extractTitle(text, hit.meta.originalName),
  };
}

export async function loadMasterProfile(): Promise<LoadedDoc | null> {
  return loadSlotSingle("master-profile");
}

export async function loadSystemAddon(): Promise<string | undefined> {
  const doc = await loadSlotSingle("system-instructions");
  return doc?.text;
}

export async function loadTemplates(): Promise<{
  resume: LoadedDoc | null;
  cover: LoadedDoc | null;
}> {
  const [resume, cover] = await Promise.all([
    loadSlotSingle("resume-template"),
    loadSlotSingle("cover-template"),
  ]);
  return { resume, cover };
}

export async function loadAllExperiences(): Promise<LoadedDoc[]> {
  const files = listExperienceFiles();
  const out: LoadedDoc[] = [];
  for (const meta of files) {
    const hit = readLibraryFileBuffer("experience", meta.id);
    if (!hit) continue;
    const raw = await fileToModelText(
      hit.buffer,
      hit.meta.kind,
      hit.meta.originalName
    );
    const text = hit.meta.kind === "pdf" ? raw : normalizeMarkdown(raw);
    out.push({
      meta: hit.meta,
      text,
      title: extractTitle(text, hit.meta.originalName),
    });
  }
  return out;
}

export function masterForPass1(master: LoadedDoc): string {
  return compactMasterProfile(master.text, 9000);
}

export function masterForPass2(master: LoadedDoc): string {
  return compactMasterProfile(master.text, 12000);
}

export function templatesForModel(resume: LoadedDoc, cover: LoadedDoc) {
  return {
    resume: compactTemplate(resume.text, 3500),
    cover: compactTemplate(cover.text, 2500),
  };
}

export function buildExperienceCatalog(experiences: LoadedDoc[]): string {
  return experiences
    .map((e) =>
      compactExperience(e.text, e.meta.originalName, {
        summaryChars: 450,
        starChars: 2000,
        skillsChars: 450,
      })
    )
    .join("\n\n---\n\n");
}

function matchExperience(
  experiences: LoadedDoc[],
  name: string
): LoadedDoc | undefined {
  const n = name.toLowerCase().trim();
  return experiences.find((e) => {
    return (
      e.title.toLowerCase().includes(n) ||
      n.includes(e.title.toLowerCase()) ||
      e.meta.originalName.toLowerCase().includes(n) ||
      n.includes(
        e.meta.originalName.toLowerCase().replace(/\.(md|pdf|txt)$/i, "")
      )
    );
  });
}

export function resolveLeads(
  experiences: LoadedDoc[],
  selection: Pass1Selection,
  overrideLeads?: string[]
): { leads: LoadedDoc[]; supporting: LoadedDoc[] } {
  const leads: LoadedDoc[] = [];
  const supporting: LoadedDoc[] = [];

  const leadNames =
    overrideLeads && overrideLeads.length
      ? overrideLeads
      : selection.leadExperiences;

  for (const name of leadNames) {
    const hit = matchExperience(experiences, name);
    if (hit && !leads.includes(hit)) leads.push(hit);
  }
  for (const name of selection.supportingExperiences) {
    const hit = matchExperience(experiences, name);
    if (hit && !leads.includes(hit) && !supporting.includes(hit)) {
      supporting.push(hit);
    }
  }

  // Fallback: if no leads matched, take all experiences as supporting
  if (!leads.length) {
    experiences.forEach((e) => {
      if (!supporting.includes(e)) supporting.push(e);
    });
  }

  return { leads, supporting };
}

export function packLeadsForPass2(leads: LoadedDoc[]): string {
  return leads.map((e) => packLeadExperience(e)).join("\n\n---\n\n");
}

export function packSupportingCatalog(supporting: LoadedDoc[]): string {
  if (!supporting.length) return "";
  return supporting
    .map((e) =>
      compactExperience(e.text, e.meta.originalName, {
        summaryChars: 300,
        starChars: 500,
        skillsChars: 200,
      })
    )
    .join("\n\n---\n\n");
}

export function listExperienceOptions(
  experiences: LoadedDoc[]
): { id: string; title: string; fileName: string }[] {
  return experiences.map((e) => ({
    id: e.meta.id,
    title: e.title,
    fileName: e.meta.originalName,
  }));
}
