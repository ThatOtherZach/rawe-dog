/**
 * One-shot import from Employment vault into web/data/library.
 * Usage: node scripts/seed-library.mjs "G:/Proton/My files/Obsidian/CoreKB/Employment"
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libraryRoot = path.join(__dirname, "..", "data", "library");
const vault = process.argv.slice(2).join(" ").trim();

if (!vault) {
  console.error("Usage: node scripts/seed-library.mjs <EmploymentVaultPath>");
  process.exit(1);
}
console.log("Vault:", vault);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function kindFromName(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".txt")) return "text";
  return "other";
}

function putSlot(slot, multi, sources) {
  const dir = path.join(libraryRoot, slot);
  ensureDir(dir);
  // clear previous
  for (const f of fs.readdirSync(dir)) {
    fs.unlinkSync(path.join(dir, f));
  }
  const metas = [];
  for (const src of sources) {
    if (!fs.existsSync(src)) {
      console.warn("Missing:", src);
      continue;
    }
    const originalName = path.basename(src);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const storedName = `${id}-${originalName}`;
    const buf = fs.readFileSync(src);
    fs.writeFileSync(path.join(dir, storedName), buf);
    metas.push({
      id,
      slot,
      originalName,
      storedName,
      size: buf.length,
      updatedAt: new Date().toISOString(),
      mimeType: "application/octet-stream",
      kind: kindFromName(originalName),
    });
    if (!multi) break;
  }
  fs.writeFileSync(
    path.join(dir, "_meta.json"),
    JSON.stringify(metas, null, 2)
  );
  console.log(slot, "→", metas.map((m) => m.originalName).join(", ") || "(none)");
}

const expDir = path.join(vault, "Workplace Experience Summaries");
const expFiles = fs.existsSync(expDir)
  ? fs
      .readdirSync(expDir)
      .filter((f) => f.toLowerCase().endsWith(".md"))
      .map((f) => path.join(expDir, f))
  : [];

putSlot("master-profile", false, [path.join(vault, "Master Profile.md")]);
putSlot("system-instructions", false, [
  path.join(vault, "ChatGPT Resume Builder Instructions.md"),
]);
putSlot("experience", true, expFiles);
putSlot("resume-template", false, [
  path.join(vault, "Templates", "Resume Template.md"),
]);
putSlot("cover-template", false, [
  path.join(vault, "Templates", "Cover Letter Template.md"),
]);

console.log("Library seed complete.");
