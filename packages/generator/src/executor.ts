import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import type { Manifest } from "@hugents/core";
import type { ReasonCode } from "./contracts.js";
import {
  createExpect,
  createSeedModule,
  DEFAULT_LIMITS,
  HarnessError,
  RunBudget,
  wrapPage,
  type HarnessLimits,
  type RawPage,
} from "./harness.js";
import { assertAllowedTarget, TargetBlockedError } from "./manifest.js";
import { openSeededPage, SeedError } from "./seed.js";
import type { SpecExecutor } from "./queue.js";
import { validateSpec } from "./validator.js";

/**
 * Project-specific login steps. Receives the page and the credential. It must not return, log or store the
 * credential. Adapters are trusted code written by the project owner, not generated.
 */
export type LoginAdapter = (page: RawPage & { goto(url: string): Promise<unknown> }, credential: string) => Promise<void>;

/** For fixtures only: fills a labelled account field and presses a "Sign in" button. No real selectors. */
export const placeholderLoginAdapter: LoginAdapter = async (page, credential) => {
  const page_ = page as unknown as { getByLabel(l: string): { fill(v: string): Promise<void> }; getByRole(r: string, o: object): { click(): Promise<void> } };
  await page_.getByLabel("Account").fill(credential);
  await page_.getByRole("button", { name: "Sign in" }).click();
};

/** What the executor needs from a browser. `playwright-core`'s chromium satisfies it. */
export interface BrowserLike {
  newContext(options: Record<string, unknown>): Promise<ContextLike>;
  close(): Promise<void>;
}
export interface ContextLike {
  route(url: string, handler: (route: RouteLike) => unknown): Promise<void>;
  on(event: "page", handler: (page: { close(): Promise<void>; on(event: "close", h: () => void): unknown }) => void): void;
  newPage(): Promise<PageHandle>;
  setDefaultTimeout(ms: number): void;
  close(): Promise<void>;
}
export interface RouteLike {
  request(): { url(): string };
  abort(code?: string): Promise<void>;
  continue(): Promise<void>;
}
export type PageHandle = RawPage & { goto(url: string): Promise<unknown>; close(): Promise<void> };

export interface ExecutorConfig {
  manifest: Manifest;
  /** From the run task, never from the spec. Checked against the manifest before any navigation. */
  targetUrl: string;
  /** Name of the environment variable holding the QA account. Must be listed in the manifest. */
  accountVariable: string;
  env: Readonly<Record<string, string | undefined>>;
  login: LoginAdapter;
  limits?: Partial<HarnessLimits>;
  /** Defaults to launching headless chromium from `playwright-core`. Injectable for tests. */
  launch?: (tmpDir: string) => Promise<BrowserLike>;
  /** Where temporary directories are created. Defaults to the OS temp directory. */
  tmpRoot?: string;
}

export interface RunResult {
  passed: boolean;
  /** Reason codes only. Never page text, URLs or error messages. */
  reasons: ReasonCode[];
  /** Requests to hosts outside the allowlist that were aborted. */
  blockedRequests: number;
  tests: number;
}

async function defaultLaunch(tmpDir: string): Promise<BrowserLike> {
  const { chromium } = await import("playwright-core");
  return (await chromium.launch({ headless: true, downloadsPath: tmpDir })) as unknown as BrowserLike;
}

function toReason(err: unknown): ReasonCode {
  if (err instanceof HarnessError) return err.code;
  if (err instanceof SeedError) return err.code;
  if (err instanceof TargetBlockedError) return "target-blocked";
  return "spec-error";
}

/**
 * Runs an approved spec in a restricted harness. The spec text is the only thing it takes from the draft. Each run
 * has a fresh browser context with no stored state, no downloads, no permissions and no service workers, and its own
 * temporary directory, removed at the end. Output is reason codes and counts only.
 *
 * Known limit: the spec runs inside this process (in a `vm` context with no globals). A synchronous infinite loop is
 * stopped only in the first synchronous segment of a test, so the local worker should run this in a child process it can
 * kill. Playwright waits and the harness limits are enforced with timers as usual.
 */
export async function runSpec(spec: string, config: ExecutorConfig): Promise<RunResult> {
  const limits: HarnessLimits = { ...DEFAULT_LIMITS, ...config.limits };
  const result: RunResult = { passed: false, reasons: [], blockedRequests: 0, tests: 0 };
  const finish = (reasons: ReasonCode[]): RunResult => {
    result.reasons = [...new Set(reasons)];
    result.passed = reasons.length === 0 && result.tests > 0;
    return result;
  };

  // Second check, next to `assertRunnable`: the harness never trusts that its caller validated.
  const validation = validateSpec(spec, config.manifest);
  if (!validation.ok) return finish([...new Set(validation.issues.map((i) => i.code))]);
  try {
    assertAllowedTarget(config.targetUrl, config.manifest);
  } catch {
    return finish(["target-blocked"]);
  }
  if (!config.manifest.testAccountVariableNames.includes(config.accountVariable)) return finish(["account-not-in-manifest"]);
  if (!config.env[config.accountVariable]) return finish(["account-missing"]);

  const budget = new RunBudget(limits);
  const expectFn = createExpect(budget, limits);
  const seed = createSeedModule(expectFn);
  const dir = await mkdtemp(join(config.tmpRoot ?? tmpdir(), "hugents-run-"));
  let browser: BrowserLike | undefined;
  let timer: NodeJS.Timeout | undefined;
  const reasons: ReasonCode[] = [];

  try {
    const compiled = ts.transpileModule(spec, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    await writeFile(join(dir, "generated.spec.js"), compiled, "utf8");

    // No globals: no process, require, fetch, timers or console. `require` resolves the seed module only.
    const sandbox = vm.createContext(
      {
        exports: {},
        require: (name: string) => {
          if (name !== "hugents-seed") throw new HarnessError("disallowed-import");
          return seed.module;
        },
      },
      { codeGeneration: { strings: false, wasm: false } },
    );
    try {
      vm.runInContext(compiled, sandbox, { timeout: 1000, filename: "generated.spec.js" });
    } catch (err) {
      return finish([toReason(err)]);
    }
    result.tests = seed.tests.length;
    if (result.tests === 0) return finish(["no-tests"]);

    try {
      browser = await (config.launch ?? defaultLaunch)(dir);
    } catch {
      return finish(["browser-failed"]);
    }

    const context = await browser.newContext({
      acceptDownloads: false,
      permissions: [],
      serviceWorkers: "block",
      storageState: undefined,
      recordVideo: undefined,
    });
    context.setDefaultTimeout(limits.assertionTimeoutMs);
    // Counts pages open at the same time. A page over the limit (for example a popup) is closed and fails the run.
    let openPages = 0;
    context.on("page", (p) => {
      p.on("close", () => openPages--);
      if (++openPages > limits.maxPages) {
        reasons.push("page-limit");
        void p.close().catch(() => undefined);
      }
    });
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      let allowed = url === "about:blank";
      if (!allowed) {
        try {
          assertAllowedTarget(url, config.manifest);
          allowed = true;
        } catch {
          allowed = false;
        }
      }
      if (allowed) await route.continue();
      else {
        result.blockedRequests++;
        await route.abort("blockedbyclient");
      }
    });

    // One deadline for the whole run. On expiry the browser is closed, which also unblocks any pending wait.
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => resolve("deadline"), limits.runTimeoutMs);
    });

    const runTests = async (): Promise<void> => {
      for (const t of seed.tests) {
        budget.startTest();
        const raw = await context.newPage();
        let testTimer: NodeJS.Timeout | undefined;
        try {
          const seeded = await openSeededPage({
            manifest: config.manifest,
            targetUrl: config.targetUrl,
            accountVariable: config.accountVariable,
            env: config.env,
            page: raw,
            login: async (p, credential) => {
              try {
                await config.login(p, credential);
              } catch {
                throw new HarnessError("login-failed");
              }
            },
          });
          const fixtures = { page: wrapPage(seeded, budget, limits) };
          const timeout = new Promise<never>((_, reject) => {
            testTimer = setTimeout(() => reject(new HarnessError("run-timeout")), limits.testTimeoutMs);
          });
          const body = async () => {
            for (const hook of seed.hooks) await callInVm(sandbox, hook, fixtures, limits);
            await callInVm(sandbox, t.fn, fixtures, limits);
          };
          await Promise.race([body(), timeout]);
        } finally {
          clearTimeout(testTimer);
          budget.aborted = true;
          await raw.close().catch(() => undefined);
          budget.aborted = false;
        }
      }
    };

    const outcome = await Promise.race([runTests().then(() => "done" as const), deadline]).catch((err: unknown) => {
      reasons.push(toReason(err));
      return "failed" as const;
    });
    if (outcome === "deadline") reasons.push("run-time-limit");
    if (result.blockedRequests > 0) reasons.push("network-blocked");
    // network-blocked is reported next to pass or fail; it does not by itself fail a run.
    const failing = reasons.filter((r) => r !== "network-blocked");
    result.reasons = [...new Set(reasons)];
    result.passed = failing.length === 0 && outcome === "done";
    return result;
  } catch (err) {
    return finish([toReason(err) === "spec-error" ? "browser-failed" : toReason(err)]);
  } finally {
    clearTimeout(timer);
    budget.aborted = true;
    await browser?.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

/** Calls a spec function inside its vm context so a synchronous runaway at the start of a test is interrupted. */
async function callInVm(sandbox: vm.Context, fn: unknown, fixtures: unknown, limits: HarnessLimits): Promise<void> {
  const ctx = sandbox as Record<string, unknown>;
  ctx.__fn = fn;
  ctx.__fixtures = fixtures;
  try {
    const out = vm.runInContext("__fn(__fixtures)", sandbox, { timeout: Math.min(limits.testTimeoutMs, 5000) });
    await out;
  } finally {
    delete ctx.__fn;
    delete ctx.__fixtures;
  }
}

/**
 * `SpecExecutor` for `runDraftTask`, built per run task: the target and the account come from the task and the
 * manifest, the spec text from the approved draft.
 */
export function createPlaywrightExecutor(config: ExecutorConfig): SpecExecutor {
  return async (spec) => {
    const r = await runSpec(spec, config);
    return { passed: r.passed, reasons: r.reasons, blockedRequests: r.blockedRequests };
  };
}
