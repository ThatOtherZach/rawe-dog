import {
  listExperienceFiles,
  readLibraryFileBuffer,
  libraryReadiness,
  type LibraryFileMeta,
} from "./library.js";
import {
  compactExperience,
  compactMasterProfile,
  compactTemplate,
  normalizeMarkdown,
  packFullExperience,
  extractTitle,
} from "./normalize-md.js";
import { fileToModelText } from "./pdf-text.js";
import type { Pass1Selection } from "./parse-kit.js";

export type LoadedDoc = {
  meta: LibraryFileMeta;
  text: string;
  title: string;
};

/** Experience doc with a stable, model-friendly catalog ID (E1, E2, …). */
export type ExperienceDoc = LoadedDoc & { catalogId: string };

export type ExperienceOption = {
  id: string;
  catalogId: string;
  title: string;
  fileName: string;
};

/** Everything a full generation run needs — loaded and parsed exactly once. */
export type RunContext = {
  master: LoadedDoc;
  customAddon?: string;
  templates: { resume: LoadedDoc; cover: LoadedDoc };
  experiences: ExperienceDoc[];
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

/**
 * Assign stable catalog IDs. Library file IDs start with an upload timestamp,
 * so sorting by them gives a chronological, stable ordering: an experience
 * keeps its catalog ID as long as earlier files are not deleted.
 */
export function assignCatalogIds(experiences: LoadedDoc[]): ExperienceDoc[] {
  return [...experiences]
    .sort((a, b) => a.meta.id.localeCompare(b.meta.id))
    .map((e, i) => ({ ...e, catalogId: `E${i + 1}` }));
}

/** Load + parse every library file exactly once for a run. */
export async function loadRunContext(): Promise<RunContext> {
  const readiness = libraryReadiness();
  if (!readiness.ready) {
    throw new Error(
      "Library incomplete. Upload Master Profile, at least one experience file, and resume + cover templates."
    );
  }

  const [master, customAddon, templates, rawExperiences] = await Promise.all([
    loadMasterProfile(),
    loadSystemAddon(),
    loadTemplates(),
    loadAllExperiences(),
  ]);

  if (!master) throw new Error("Master Profile missing.");
  if (!templates.resume || !templates.cover) {
    throw new Error("Resume and cover templates are required.");
  }
  if (!rawExperiences.length) throw new Error("No experience files loaded.");

  return {
    master,
    customAddon,
    templates: { resume: templates.resume, cover: templates.cover },
    experiences: assignCatalogIds(rawExperiences),
  };
}

export function catalogLabel(e: ExperienceDoc): string {
  return `[${e.catalogId}] ${e.title} (${e.meta.originalName})`;
}

export function listExperienceOptions(
  experiences: ExperienceDoc[]
): ExperienceOption[] {
  return experiences.map((e) => ({
    id: e.meta.id,
    catalogId: e.catalogId,
    title: e.title,
    fileName: e.meta.originalName,
  }));
}

/** Compact catalog for the selection stage — every entry headed by its ID. */
export function buildExperienceCatalog(experiences: ExperienceDoc[]): string {
  return experiences
    .map((e) => compactExperience(e.text, { label: catalogLabel(e), maxChars: 2400 }))
    .join("\n\n---\n\n");
}

/* ---------------------------------------------------------------------- */
/* Selection resolution (strict, ID-first)                                 */
/* ---------------------------------------------------------------------- */

function fuzzyTitleMatch(
  experiences: ExperienceDoc[],
  name: string
): ExperienceDoc | undefined {
  const n = name.toLowerCase().trim();
  if (!n) return undefined;
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

/** Resolve one reference: catalog ID → library file ID → legacy title match. */
export function resolveExperienceRef(
  experiences: ExperienceDoc[],
  ref: string
): ExperienceDoc | undefined {
  const r = (ref || "").trim();
  if (!r) return undefined;
  const byCatalogId = experiences.find(
    (e) => e.catalogId.toLowerCase() === r.toLowerCase()
  );
  if (byCatalogId) return byCatalogId;
  const byLibraryId = experiences.find((e) => e.meta.id === r);
  if (byLibraryId) return byLibraryId;
  return fuzzyTitleMatch(experiences, r);
}

export type ResolvedSelection = {
  leads: ExperienceDoc[];
  supporting: ExperienceDoc[];
  unmatched: string[];
};

/** Non-throwing resolution — used to fill display titles + warn in Pass 1. */
export function tryResolveSelection(
  experiences: ExperienceDoc[],
  selection: Pass1Selection,
  overrideLeads?: string[]
): ResolvedSelection {
  const leadRefs =
    overrideLeads && overrideLeads.length
      ? overrideLeads
      : selection.leadExperienceIds.length
        ? selection.leadExperienceIds
        : selection.leadExperiences; // legacy title-based clients
  const supportingRefs = selection.supportingExperienceIds.length
    ? selection.supportingExperienceIds
    : selection.supportingExperiences;

  const leads: ExperienceDoc[] = [];
  const supporting: ExperienceDoc[] = [];
  const unmatched: string[] = [];

  for (const ref of leadRefs) {
    const hit = resolveExperienceRef(experiences, ref);
    if (hit && !leads.includes(hit)) leads.push(hit);
    else if (!hit) unmatched.push(ref);
  }
  for (const ref of supportingRefs) {
    const hit = resolveExperienceRef(experiences, ref);
    if (hit && !leads.includes(hit) && !supporting.includes(hit)) {
      supporting.push(hit);
    } else if (!hit) {
      unmatched.push(ref);
    }
  }

  return { leads, supporting, unmatched };
}

/**
 * Strict resolution before drafting: zero matched leads is a hard, clearly
 * explained error — never a silent fallback to an ungrounded kit.
 */
export function resolveLeadsStrict(
  experiences: ExperienceDoc[],
  selection: Pass1Selection,
  overrideLeads?: string[]
): ResolvedSelection {
  const resolved = tryResolveSelection(experiences, selection, overrideLeads);
  if (!resolved.leads.length) {
    const requested = (
      overrideLeads?.length
        ? overrideLeads
        : selection.leadExperienceIds.length
          ? selection.leadExperienceIds
          : selection.leadExperiences
    )
      .filter(Boolean)
      .join(", ");
    const available = experiences.map((e) => catalogLabel(e)).join("; ");
    throw new Error(
      `Experience selection matched no library files (requested: ${requested || "nothing"}). ` +
        `Available experiences: ${available}. Re-run selection or pick lead experiences manually.`
    );
  }
  return resolved;
}

/** Write resolved catalog IDs + display titles back onto the selection. */
export function applyResolutionToSelection(
  selection: Pass1Selection,
  resolved: ResolvedSelection
): Pass1Selection {
  return {
    ...selection,
    leadExperienceIds: resolved.leads.map((e) => e.catalogId),
    supportingExperienceIds: resolved.supporting.map((e) => e.catalogId),
    leadExperiences: resolved.leads.map((e) => e.title),
    supportingExperiences: resolved.supporting.map((e) => e.title),
  };
}

/** Map catalog IDs (or refs) to display titles, dropping unknowns. */
export function refsToTitles(
  experiences: ExperienceDoc[],
  refs: string[]
): string[] {
  const titles: string[] = [];
  for (const ref of refs) {
    const hit = resolveExperienceRef(experiences, ref);
    const title = hit ? hit.title : "";
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

/* ---------------------------------------------------------------------- */
/* Per-stage evidence packing                                              */
/* ---------------------------------------------------------------------- */

export function masterForSelection(master: LoadedDoc): string {
  return compactMasterProfile(master.text, 9000);
}

export function masterForDrafting(master: LoadedDoc, maxChars = 12000): string {
  return compactMasterProfile(master.text, maxChars);
}

export function masterForVerification(master: LoadedDoc): string {
  return compactMasterProfile(master.text, 8000);
}

export function templatesForModel(resume: LoadedDoc, cover: LoadedDoc) {
  return {
    resume: compactTemplate(resume.text, 3500),
    cover: compactTemplate(cover.text, 2500),
  };
}

/** Full lead evidence for drafting (per-lead cap keeps prompts bounded). */
export function packLeadsFull(leads: ExperienceDoc[]): string {
  return leads
    .map((e) => packFullExperience(catalogLabel(e), e.text))
    .join("\n\n---\n\n");
}

/** Compact lead evidence for the verification stage. */
export function packLeadsCompact(leads: ExperienceDoc[], perLead = 3200): string {
  return leads
    .map((e) => compactExperience(e.text, { label: catalogLabel(e), maxChars: perLead }))
    .join("\n\n---\n\n");
}

export function packSupportingCatalog(supporting: ExperienceDoc[]): string {
  if (!supporting.length) return "";
  return supporting
    .map((e) => compactExperience(e.text, { label: catalogLabel(e), maxChars: 1000 }))
    .join("\n\n---\n\n");
}
