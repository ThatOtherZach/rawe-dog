import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const settingsPath = path.join(dataDir, "settings.json");

// Read key from argv[2] or XAI_API_KEY env — never log the raw key
const key = (process.argv[2] || process.env.XAI_API_KEY || "").trim();
const model = process.env.XAI_MODEL || "grok-4.5";

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(
  settingsPath,
  JSON.stringify({ apiKey: key, model }, null, 2),
  "utf8"
);
console.log(
  key
    ? `Settings written (key length ${key.length}, model ${model})`
    : `Settings written with empty key (model ${model})`
);
