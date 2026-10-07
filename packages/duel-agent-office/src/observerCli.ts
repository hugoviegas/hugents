import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadObserverConfig, ObserverConfigError } from "./observer/config.js";
import { formatSummary, observe, ObserverInputError } from "./observer/scan.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Deliberately no dotenv: the observer never reads `.env` (it holds QA credentials).
async function main(argv: string[]): Promise<number> {
  const flagValue = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes("--run") && !flagValue("--run")) {
    console.error("--run needs a run directory");
    return 64;
  }
  let config;
  try {
    config = loadObserverConfig(process.env, path.join(ROOT, "artifacts"), {
      ...(argv.includes("--report-aborted") ? { reportAborted: true } : {}),
    });
  } catch (error) {
    console.error(error instanceof ObserverConfigError ? error.message : "Invalid observer configuration");
    return 64;
  }
  try {
    const result = await observe(config, { runDir: flagValue("--run"), dryRun: argv.includes("--dry-run") });
    console.log(formatSummary(result));
    return 0;
  } catch (error) {
    console.error(error instanceof ObserverInputError ? error.message : "Observer failed unexpectedly");
    return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  () => {
    console.error("Observer failed unexpectedly");
    process.exit(1);
  },
);
