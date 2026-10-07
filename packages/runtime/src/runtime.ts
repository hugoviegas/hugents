import path from "node:path";
import { createSanitizer, type Manifest, type Sanitizer } from "@hugents/core";
import { ROOM_CODE_RULE } from "@hugents/generator";
import { ArtifactRegistry } from "./artifacts.js";
import { BoardService } from "./boards.js";
import { inspect } from "./inspect.js";
import { FileStore, createDb, type Db } from "./persist.js";
import { AgentRegistry } from "./registry.js";
import { AgentRunner } from "./runner.js";
import { ToolRegistry } from "./tools.js";
import { DbDraftRepository, registerWorkflowTools } from "./workflow/tools.js";

export interface RuntimeOptions {
  /** Data folder (JSON collections + `artifacts/objects`). Omit for an in-memory runtime. */
  dir?: string;
  /** Project manifest for the workflow tools. Needed only when a run-creator task or a run executes. */
  manifest?: Manifest;
  importRoots?: readonly string[];
  now?: () => Date;
  newId?: (prefix: string) => string;
  env?: Readonly<Record<string, string | undefined>>;
  maxConcurrency?: number;
  /** Extra tools to register next to the workflow tools. */
  extraTools?: (tools: ToolRegistry) => void;
}

export type Runtime = Awaited<ReturnType<typeof openRuntime>>;

/** Opens (or reloads) a runtime. Tasks interrupted by a previous stop end `failed` with `interrupted`. */
export async function openRuntime(options: RuntimeOptions = {}) {
  const now = options.now ?? (() => new Date());
  const db: Db = createDb(options.dir);
  const store = new FileStore(db);
  const sanitizer: Sanitizer = createSanitizer([ROOM_CODE_RULE]);
  const drafts = new DbDraftRepository(db);
  const nowIso = () => now().toISOString();
  const workflowDeps = () => {
    if (!options.manifest) throw new Error("a project manifest is required for this step");
    return { manifest: options.manifest, drafts, store, sanitizer, now: nowIso };
  };
  const tools = registerWorkflowTools(new ToolRegistry(), workflowDeps);
  options.extraTools?.(tools);

  const ids = options.newId ? { newId: options.newId } : {};
  const artifacts = new ArtifactRegistry({
    db,
    ...(options.dir ? { root: path.join(options.dir, "artifacts") } : {}),
    importRoots: options.importRoots ?? [],
    now,
    ...ids,
  });
  const registry = new AgentRegistry({ db, tools, now });
  const boards = new BoardService({ db, artifacts, sanitizer, now, policyOf: (id, v) => registry.policyOf(id, v), ...ids });
  const runner = new AgentRunner({
    db,
    store,
    sanitizer,
    registry,
    tools,
    artifacts,
    boards,
    now,
    ...ids,
    ...(options.env ? { env: options.env } : {}),
    ...(options.maxConcurrency ? { maxConcurrency: options.maxConcurrency } : {}),
  });
  const interrupted = await runner.recoverInterrupted();

  return {
    db,
    store,
    sanitizer,
    drafts,
    tools,
    artifacts,
    registry,
    boards,
    runner,
    interrupted,
    manifest: options.manifest,
    now,
    workflowDeps,
    inspect: () => inspect({ registry, runner, boards }),
  };
}
