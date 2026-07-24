import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from "fs";
import path from "path";
import { getLibraryRoot } from "./paths.js";

export const LIBRARY_SLOTS = [
  "master-profile",
  "system-instructions",
  "experience",
  "resume-template",
  "cover-template",
] as const;

export type LibrarySlot = (typeof LIBRARY_SLOTS)[number];

export type LibraryFileMeta = {
  id: string;
  slot: LibrarySlot;
  originalName: string;
  storedName: string;
  size: number;
  updatedAt: string;
  mimeType: string;
  kind: "markdown" | "pdf" | "text" | "other";
};

const MULTI_SLOTS: LibrarySlot[] = ["experience"];

export function isMultiSlot(slot: LibrarySlot): boolean {
  return MULTI_SLOTS.includes(slot);
}

export function isValidSlot(slot: string): slot is LibrarySlot {
  return (LIBRARY_SLOTS as readonly string[]).includes(slot);
}

function slotDir(slot: LibrarySlot): string {
  const dir = path.join(getLibraryRoot(), slot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function metaPath(slot: LibrarySlot): string {
  return path.join(slotDir(slot), "_meta.json");
}

function loadMeta(slot: LibrarySlot): LibraryFileMeta[] {
  const p = metaPath(slot);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")) as LibraryFileMeta[];
  } catch {
    return [];
  }
}

function saveMeta(slot: LibrarySlot, files: LibraryFileMeta[]): void {
  writeFileSync(metaPath(slot), JSON.stringify(files, null, 2), "utf8");
}

function kindFromName(name: string): LibraryFileMeta["kind"] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".txt")) return "text";
  return "other";
}

function safeBaseName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\- ()[\]]+/g, "_").slice(0, 120);
}

export async function saveUpload(
  slotRaw: string,
  filename: string,
  buffer: Buffer,
  mimeType: string
): Promise<LibraryFileMeta> {
  if (!isValidSlot(slotRaw)) throw new Error("Invalid slot");
  const slot = slotRaw as LibrarySlot;
  const kind = kindFromName(filename);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ext = path.extname(filename) || ".bin";
  const storedName = `${id}${ext}`;
  const dir = slotDir(slot);
  const filePath = path.join(dir, storedName);

  writeFileSync(filePath, buffer);

  const stat = statSync(filePath);
  const meta: LibraryFileMeta = {
    id,
    slot,
    originalName: safeBaseName(filename),
    storedName,
    size: stat.size,
    updatedAt: new Date().toISOString(),
    mimeType,
    kind,
  };

  // For single-slot slots, replace existing
  const existing = loadMeta(slot);
  const updated = isMultiSlot(slot)
    ? [...existing, meta]
    : [meta];

  // Clean up replaced files
  if (!isMultiSlot(slot)) {
    for (const old of existing) {
      const oldPath = path.join(dir, old.storedName);
      if (existsSync(oldPath)) unlinkSync(oldPath);
    }
  }

  saveMeta(slot, updated);
  return meta;
}

export function deleteLibraryFile(slotRaw: string, id: string): boolean {
  if (!isValidSlot(slotRaw)) return false;
  const slot = slotRaw as LibrarySlot;
  const existing = loadMeta(slot);
  const target = existing.find((f) => f.id === id);
  if (!target) return false;

  const dir = slotDir(slot);
  const filePath = path.join(dir, target.storedName);
  if (existsSync(filePath)) unlinkSync(filePath);

  saveMeta(slot, existing.filter((f) => f.id !== id));
  return true;
}

export function listLibrary(): Record<string, LibraryFileMeta[]> {
  const out: Record<string, LibraryFileMeta[]> = {};
  for (const slot of LIBRARY_SLOTS) {
    out[slot] = loadMeta(slot);
  }
  return out;
}

export function libraryReadiness() {
  const files = listLibrary();
  const masterProfile = (files["master-profile"] || []).length > 0;
  const systemInstructions = (files["system-instructions"] || []).length > 0;
  const experienceCount = (files["experience"] || []).length;
  const resumeTemplate = (files["resume-template"] || []).length > 0;
  const coverTemplate = (files["cover-template"] || []).length > 0;
  const ready = masterProfile && experienceCount > 0 && resumeTemplate && coverTemplate;

  return {
    ready,
    masterProfile,
    systemInstructions,
    experienceCount,
    resumeTemplate,
    coverTemplate,
  };
}

export function readLibraryFileBuffer(
  slot: LibrarySlot,
  id?: string
): { meta: LibraryFileMeta; buffer: Buffer } | null {
  const files = loadMeta(slot);
  const meta = id ? files.find((f) => f.id === id) : files[0];
  if (!meta) return null;

  const dir = slotDir(slot);
  const p = path.join(dir, meta.storedName);
  if (!existsSync(p)) return null;
  return { meta, buffer: readFileSync(p) };
}

export function listExperienceFiles(): LibraryFileMeta[] {
  return loadMeta("experience");
}

export function getFilePath(slot: LibrarySlot, storedName: string): string {
  return path.join(slotDir(slot), storedName);
}

export function fileExistsOnDisk(slot: LibrarySlot, storedName: string): boolean {
  return existsSync(path.join(slotDir(slot), storedName));
}

export function readRawTextIfPossible(
  slot: LibrarySlot,
  meta: LibraryFileMeta
): string | null {
  if (meta.kind === "pdf") return null;
  const p = path.join(slotDir(slot), meta.storedName);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

export function assertDataWritable(): { ok: boolean; path: string } {
  const root = getLibraryRoot();
  try {
    mkdirSync(root, { recursive: true });
    const test = path.join(root, ".write-test");
    writeFileSync(test, "ok");
    unlinkSync(test);
    return { ok: true, path: root };
  } catch {
    return { ok: false, path: root };
  }
}

export function slotLabel(slot: LibrarySlot): string {
  const labels: Record<LibrarySlot, string> = {
    "master-profile": "Master Profile",
    "system-instructions": "System instructions (custom addons)",
    experience: "Workplace experience",
    "resume-template": "Resume template (MD or PDF)",
    "cover-template": "Cover letter template (MD or PDF)",
  };
  return labels[slot];
}
