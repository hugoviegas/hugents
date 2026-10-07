import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANUAL_HINT, syncPreview } from "./preview/syncPreview.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;

/** `shell` is only for the Windows `vercel.cmd` shim; paths with spaces must go through a shell-less call. */
function run(file: string, args: string[], cwd: string, shell = false): Promise<string> {
  return new Promise((resolve, reject) => {
    // Fixed arguments only (the optional branch is validated); stderr is discarded so no URL is echoed.
    execFile(file, args, { cwd, shell, timeout: 60_000, maxBuffer: 5_000_000 }, (error, stdout) =>
      error ? reject(new Error("command failed")) : resolve(stdout),
    );
  });
}

async function main(argv: string[]): Promise<number> {
  const branchFlag = argv.indexOf("--branch");
  const branch = branchFlag >= 0 ? argv[branchFlag + 1] : undefined;
  if (branch !== undefined && !BRANCH.test(branch)) {
    console.error("--branch must be a plain branch name.");
    return 64;
  }

  // The Vercel project link (.vercel/project.json) lives in the app folder or the repo root.
  const candidates = [path.resolve(ROOT, "..", "duelo"), path.resolve(ROOT, "..")];
  const project = candidates.find((dir) => existsSync(path.join(dir, ".vercel", "project.json")));
  if (!project) {
    console.error(MANUAL_HINT);
    return 1;
  }

  const args = ["ls", "--environment", "preview", "--status", "READY", "--format", "json"];
  if (branch) args.push("-m", `githubCommitRef=${branch}`);

  const result = await syncPreview({
    listPreviews: () => run("vercel", args, project, process.platform === "win32"),
    readEnv: () => readFile(ENV_PATH, "utf8").catch(() => null),
    writeEnv: (content) => writeFile(ENV_PATH, content),
    envIsIgnored: async () => {
      await run("git", ["check-ignore", "-q", ENV_PATH], ROOT);
      return true;
    },
  });
  console.log(result.ok ? "GAME_BASE_URL updated in duel-agent-office/.env (value not shown)." : result.message);
  return result.ok ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  () => {
    console.error(MANUAL_HINT);
    process.exit(1);
  },
);
