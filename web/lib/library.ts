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
import { getLibraryRoot } from "./paths";

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

export function listLibrary(): Record<LibrarySlot, LibraryFileMeta[]> {
  const out = {} as Record<LibrarySlot, LibraryFileMeta[]>;
  for (const slot of LIBRARY_SLOTS) {
    out[slot] = loadMeta(slot);
  }
  return out;
}

export function libraryReadiness() {
  const lib = listLibrary();
  const experienceCount = lib.experience.length;
  return {
    masterProfile: lib["master-profile"].length > 0,
    systemInstructions: lib["system-instructions"].length > 0,
    experienceCount,
    resumeTemplate: lib["resume-template"].length > 0,
    coverTemplate: lib["cover-template"].length > 0,
    ready:
      lib["master-profile"].length > 0 &&
      experienceCount >= 1 &&
      lib["resume-template"].length > 0 &&
      lib["cover-template"].length > 0,
    files: lib,
  };
}

export async function saveUpload(
  slot: LibrarySlot,
  originalName: string,
  buffer: Buffer,
  mimeType: string
): Promise<LibraryFileMeta> {
  const kind = kindFromName(originalName);
  if (kind === "other") {
    throw new Error("Only .md, .txt, or .pdf files are accepted.");
  }

  const dir = slotDir(slot);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const storedName = `${id}-${safeBaseName(originalName)}`;
  const fullPath = path.join(dir, storedName);
  writeFileSync(fullPath, buffer);

  const meta: LibraryFileMeta = {
    id,
    slot,
    originalName,
    storedName,
    size: buffer.length,
    updatedAt: new Date().toISOString(),
    mimeType: mimeType || "application/octet-stream",
    kind,
  };

  let files = loadMeta(slot);
  if (!isMultiSlot(slot)) {
    // Replace: delete previous physical files
    for (const f of files) {
      const p = path.join(dir, f.storedName);
      if (existsSync(p)) unlinkSync(p);
    }
    files = [meta];
  } else {
    files.push(meta);
  }
  saveMeta(slot, files);
  return meta;
}

export function deleteLibraryFile(slot: LibrarySlot, id: string): boolean {
  const dir = slotDir(slot);
  const files = loadMeta(slot);
  const target = files.find((f) => f.id === id);
  if (!target) return false;
  const p = path.join(dir, target.storedName);
  if (existsSync(p)) unlinkSync(p);
  saveMeta(
    slot,
    files.filter((f) => f.id !== id)
  );
  return true;
}

export function readLibraryFileBuffer(
  slot: LibrarySlot,
  id?: string
): { meta: LibraryFileMeta; buffer: Buffer } | null {
  const files = loadMeta(slot);
  const meta = id ? files.find((f) => f.id === id) : files[0];
  if (!meta) return null;
  const p = path.join(slotDir(slot), meta.storedName);
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
