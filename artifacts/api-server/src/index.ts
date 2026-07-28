import app from "./app";
import { logger } from "./lib/logger";
import { scrubLegacyAiCredentials } from "./lib/settings";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// One-time migration: remove any legacy user-pasted AI key/endpoint from
// settings.json — AI credentials are per-session now and never touch disk.
if (scrubLegacyAiCredentials()) {
  logger.info("Removed legacy AI credentials from settings.json (per-session keys now)");
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
