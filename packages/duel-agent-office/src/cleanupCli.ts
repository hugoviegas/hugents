import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  applyCleanup,
  CleanupConfigError,
  formatCleanupResult,
  parseCleanupConfig,
  planCleanup,
  scanRuns,
} from "./storage/cleanup.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(argv: string[]): Promise<number> {
  loadDotenv({ quiet: true });
  let config;
  try {
    config = parseCleanupConfig(process.env);
  } catch (error) {
    console.error(error instanceof CleanupConfigError ? error.message : "Invalid cleanup configuration");
    return 64;
  }
  const dryRun = argv.includes("--dry-run");
  const artifactsDir = path.join(ROOT, "artifacts");
  const runs = await scanRuns(artifactsDir);
  const plan = planCleanup(runs, config);
  console.log(formatCleanupResult(await applyCleanup(artifactsDir, plan, runs.length, config, dryRun)));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  () => {
    console.error("Cleanup failed unexpectedly");
    process.exit(1);
  },
);
