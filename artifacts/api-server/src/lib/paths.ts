import path from "path";
import { existsSync, mkdirSync } from "fs";

/** App data lives under artifacts/api-server/data (cwd = artifacts/api-server in dev). */
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

/** Optional framework prompts directory — graceful fallback if missing. */
export function getFrameworkPromptsDir(): string {
  return path.join(process.cwd(), "prompts");
}
