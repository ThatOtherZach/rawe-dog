import path from "path";
import { existsSync, mkdirSync } from "fs";

/** App data lives under web/data (gitignored). */
export function getDataRoot(): string {
  const root = path.join(process.cwd(), "data");
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

export function getSettingsPath(): string {
  return path.join(getDataRoot(), "settings.json");
}

export function getLibraryRoot(): string {
  const root = path.join(getDataRoot(), "library");
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

/** Framework prompts live one level up from web/ in the monorepo. */
export function getFrameworkPromptsDir(): string {
  return path.join(process.cwd(), "..", "prompts");
}
