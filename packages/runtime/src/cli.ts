#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseManifest, type Manifest } from "@hugents/core";
import { parseAgentPackage } from "./agent.js";
import { ARTIFACT_KINDS, type ArtifactKind } from "./artifacts.js";
import type { Actor } from "./boards.js";
import { RuntimeError } from "./errors.js";
import { loadAgentPackage, readAgentDir, toBundle, writeAgentDir } from "./registry.js";
import { openRuntime } from "./runtime.js";
import { approveRun, executeRun } from "./workflow/runs.js";

/**
 * Local admin CLI. Whoever runs it on this machine is the admin (`--as`, default `hugo`): there is no remote surface,
 * so no identity check beyond the operating-system user. Output is JSON with ids, versions, states and reason codes.
 */
const USAGE = `hugents-agents <command> [options]

  validate <dir|bundle.json>            validate an agent package, print id, version and hash or reason codes
  import <dir|bundle.json>              validate and register a package (needs a new version for changed content)
  export <id> <version> <out>           write a registered version to a directory, or to <out>.json as a bundle
  list                                  registered agents and versions
  inspect                               admin view: agents, tasks, board items (references and codes only)
  artifact-add <kind> <mime> <file>     register a report/screenshot/log from an --import-root folder
  run <agentId> [input.json]            submit and run a task on the newest version (--artifact <id> repeatable)
  transition <itemId> <to> <rev>        move a board item as the admin (approve, reject, dismiss, ...)
  sweep                                 apply artifact retention
  demo                                  run the fixture workflow end to end (in memory unless --data is given)

options: --data <dir> (default .hugents/runtime)  --as <admin id>  --import-root <dir>  --manifest <file>`;

const AGENTS_DIR = fileURLToPath(new URL("../agents/", import.meta.url));

function admin(id: string): Actor {
  return { kind: "human", id, role: "admin", capabilities: ["config:mutate", "approval:grant"] };
}

async function loadManifest(file?: string): Promise<Manifest | undefined> {
  if (!file) return undefined;
  const r = parseManifest(await readFile(file, "utf8"));
  if (!r.ok) throw new RuntimeError("invalid-value", `manifest:${r.issues[0]?.code}`);
  return r.manifest;
}

const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      data: { type: "string", default: path.join(".hugents", "runtime") },
      as: { type: "string", default: "hugo" },
      "import-root": { type: "string", multiple: true },
      manifest: { type: "string" },
      artifact: { type: "string", multiple: true },
      reason: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...args] = positionals;
  if (!command || values.help) return console.log(USAGE), command ? 0 : 1;

  if (command === "demo") return demo(values.data === path.join(".hugents", "runtime") ? undefined : values.data);

  const rt = await openRuntime({ dir: values.data, importRoots: values["import-root"] ?? [], manifest: await loadManifest(values.manifest) });
  switch (command) {
    case "validate": {
      const r = parseAgentPackage(await loadAgentPackage(need(args[0])), rt.tools);
      print(r.ok ? { ok: true, id: r.agent.manifest.id, version: r.agent.manifest.version, contentHash: r.agent.contentHash } : { ok: false, issues: r.issues });
      return r.ok ? 0 : 2;
    }
    case "import": {
      const { agent, created } = await rt.registry.register(await loadAgentPackage(need(args[0])), admin(values.as));
      print({ id: agent.manifest.id, version: agent.manifest.version, contentHash: agent.contentHash, created });
      return 0;
    }
    case "export": {
      const [id, version, out] = [need(args[0]), need(args[1]), need(args[2])];
      const stored = await rt.registry.stored(id, version);
      if (!stored) throw new RuntimeError("agent-not-registered");
      if (out.endsWith(".json")) await writeFile(out, toBundle(stored), { flag: "wx" });
      else await writeAgentDir(stored, out);
      print({ id, version, contentHash: stored.contentHash, out });
      return 0;
    }
    case "list":
      print(await rt.registry.list());
      return 0;
    case "inspect":
      print(await rt.inspect());
      return 0;
    case "artifact-add": {
      const kind = need(args[0]) as ArtifactKind;
      if (!ARTIFACT_KINDS.includes(kind)) throw new RuntimeError("artifact-kind-not-allowed");
      print(await rt.artifacts.importFile(path.resolve(need(args[2])), { kind, mime: need(args[1]), origin: { kind: "import", actorId: values.as } }));
      return 0;
    }
    case "run": {
      const agentId = need(args[0]);
      const version = (await rt.registry.versions(agentId)).at(-1);
      if (!version) throw new RuntimeError("agent-not-registered");
      const input = args[1] ? JSON.parse(await readFile(args[1], "utf8")) : {};
      const artifacts = await Promise.all((values.artifact ?? []).map((id) => rt.artifacts.ref(id)));
      const task = await rt.runner.submit({ agentId, agentVersion: version, input, artifacts }, admin(values.as));
      const done = await rt.runner.execute(task.id);
      print((await rt.inspect()).tasks.find((t) => t.id === done.id));
      return done.state === "succeeded" ? 0 : 3;
    }
    case "transition": {
      const [itemId, to, rev] = [need(args[0]), need(args[1]), Number(need(args[2]))];
      const item = await rt.boards.transition(itemId, to, admin(values.as), { expectedRev: rev, ...(values.reason ? { reason: values.reason } : {}) });
      print({ id: item.id, board: item.board, state: item.state, rev: item.rev, approvedBy: item.approval?.by });
      return 0;
    }
    case "sweep":
      print({ expired: await rt.artifacts.sweep() });
      return 0;
    default:
      console.error(USAGE);
      return 1;
  }
}

function need(v: string | undefined): string {
  if (!v) throw new RuntimeError("missing-field", "argument");
  return v;
}

/** The fixture flow with synthetic inputs and a stand-in executor. No browser, network or credentials. */
async function demo(dir?: string): Promise<number> {
  const parsed = parseManifest({
    projectId: "example-project",
    allowedTargetUrlPattern: "^https://qa-[a-z0-9-]+\\.example\\.test$",
    blockedTargets: ["prod"],
    testAccountVariableNames: ["QA_ACCOUNT_A"],
    screens: [{ id: "screen-one", hidden: false }],
    forbiddenActions: ["delete account"],
  });
  if (!parsed.ok) return 1;
  const rt = await openRuntime({ ...(dir ? { dir } : {}), manifest: parsed.manifest });
  const hugo = admin("hugo");
  const reviewer = admin("reviewer");
  for (const id of ["design-critic", "test-planner", "run-creator", "issue-reviewer"]) {
    await rt.registry.register(await readAgentDir(path.join(AGENTS_DIR, id)), hugo);
  }
  const run = async (agentId: string, input: unknown, artifacts: unknown[] = []) => {
    const version = (await rt.registry.versions(agentId)).at(-1)!;
    return rt.runner.execute((await rt.runner.submit({ agentId, agentVersion: version, input, artifacts }, hugo)).id);
  };
  const report = await rt.artifacts.register({
    kind: "report",
    mime: "text/markdown",
    data: "# Design critic\n\n- [high] Reward button overlaps the footer (screen: screen-one)\n",
    origin: { kind: "import", actorId: "hugo" },
  });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("synthetic")]);
  const shot = await rt.artifacts.register({ kind: "screenshot", mime: "image/png", data: png, origin: { kind: "import", actorId: "hugo" } });

  await run("design-critic", {}, [report, shot]);
  const problem = (await rt.boards.list("problems"))[0]!;
  await run("test-planner", { problemItemId: problem.id });
  const suggestion = (await rt.boards.list("run-suggestions"))[0]!;
  await rt.boards.transition(suggestion.id, "approved", reviewer, { expectedRev: suggestion.rev, reason: "demo approval" });
  await run("run-creator", { suggestionItemId: suggestion.id, elements: [{ role: "button", name: "Collect reward" }] });
  const item = (await rt.boards.list("approved-runs"))[0]!;
  await approveRun(rt, item.id, reviewer, item.rev);
  const finished = await executeRun(rt, item.id, async () => ({ passed: false, reasons: ["assertion-failed"] }));
  await run("issue-reviewer", { runItemId: finished.id });
  const view = await rt.inspect();
  print({ boards: view.boards, tasks: view.tasks.map((t) => ({ agent: `${t.agentId}@${t.agentVersion}`, state: t.state, output: t.outputSummary })) });
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    // reason codes only; never a stack, path or value
    console.error(JSON.stringify(err instanceof RuntimeError ? { error: err.code, path: err.path } : { error: "failed" }));
    process.exit(2);
  },
);
