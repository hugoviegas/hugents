import { existsSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseManifest, type Manifest } from "@hugents/core";
import { createPlaywrightExecutor, placeholderLoginAdapter, type BrowserLike } from "@hugents/generator";
import { approveRun, executeRun } from "../src/index.js";
import { hugo, makeRuntime, registerFixtures, reviewer } from "./helpers.js";

/**
 * Browser-backed smoke test of the whole flow: the run creator's spec runs in the restricted executor against a local
 * fixture page. Uses the Chromium that matches playwright-core when installed; otherwise any Playwright-installed
 * Chromium (`HUGENTS_CHROMIUM_PATH` overrides). Skips, saying so, when none launches.
 */
const PAGE = `<!doctype html><html><body><main>
  <label>Account <input aria-label="Account" /></label>
  <button onclick="document.getElementById('app').hidden=false">Sign in</button>
  <div id="app" hidden><h1>Welcome</h1><button>Save</button></div>
</main></body></html>`;

function candidates(): (string | undefined)[] {
  const out: (string | undefined)[] = [process.env.HUGENTS_CHROMIUM_PATH, undefined];
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "ms-playwright") : path.join(process.env.HOME ?? "", ".cache", "ms-playwright"));
  if (existsSync(root)) {
    for (const dir of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      for (const exe of ["chrome-win/chrome.exe", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        if (existsSync(path.join(root, dir, exe))) out.push(path.join(root, dir, exe));
      }
    }
  }
  return out.filter((c, i) => i === 1 || c);
}

let launcher: ((tmp: string) => Promise<BrowserLike>) | undefined;
let server: Server;
let manifest: Manifest;
let origin = "";

beforeAll(async () => {
  const { chromium } = await import("playwright-core");
  for (const exe of candidates()) {
    try {
      const b = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
      await b.close();
      launcher = async (tmp) => (await chromium.launch({ headless: true, downloadsPath: tmp, ...(exe ? { executablePath: exe } : {}) })) as unknown as BrowserLike;
      break;
    } catch {
      // try the next one
    }
  }
  server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  origin = `http://localhost:${port}`;
  const parsed = parseManifest({
    projectId: "example-project",
    allowedTargetUrlPattern: `^http://localhost:${port}$`,
    blockedTargets: ["prod"],
    testAccountVariableNames: ["QA_ACCOUNT_A"],
    screens: [{ id: "screen-one", hidden: false }],
    forbiddenActions: ["delete account"],
  });
  if (!parsed.ok) throw new Error("manifest");
  manifest = parsed.manifest;
}, 60_000);

afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function flow(elements: { role: string; name: string }[]) {
  const rt = await makeRuntime({ manifest });
  await registerFixtures(rt);
  const report = await rt.artifacts.register({ kind: "report", mime: "text/markdown", data: "- [high] Save shows no confirmation (screen: screen-one)", origin: { kind: "import", actorId: "hugo" } });
  const run = async (agentId: string, input: unknown, artifacts: unknown[] = []) =>
    rt.runner.execute((await rt.runner.submit({ agentId, agentVersion: "1.0.0", input, artifacts }, hugo)).id);
  await run("design-critic", {}, [report]);
  const problem = (await rt.boards.list("problems"))[0]!;
  await run("test-planner", { problemItemId: problem.id });
  const s = (await rt.boards.list("run-suggestions"))[0]!;
  await rt.boards.transition(s.id, "approved", reviewer, { expectedRev: s.rev });
  await run("run-creator", { suggestionItemId: s.id, elements });
  const item = (await rt.boards.list("approved-runs"))[0]!;
  await approveRun(rt, item.id, reviewer, item.rev);
  const executor = createPlaywrightExecutor({
    manifest,
    targetUrl: origin,
    accountVariable: "QA_ACCOUNT_A",
    env: { QA_ACCOUNT_A: "synthetic-qa-credential" },
    login: placeholderLoginAdapter,
    limits: { testTimeoutMs: 10_000, runTimeoutMs: 20_000, assertionTimeoutMs: 2_000 },
    launch: launcher!,
  });
  const finished = await executeRun(rt, item.id, executor);
  await run("issue-reviewer", { runItemId: finished.id });
  const evidence = JSON.parse((await (await rt.artifacts.resolve(finished.artifacts.find((a) => a.kind === "run-evidence")!)).read()).toString());
  return { finished, evidence, issue: (await rt.boards.list("issue-drafts"))[0]! };
}

describe("workflow with a real local browser", () => {
  it("runs the approved spec in Chromium: passes when the screen matches, fails with a code when it does not", async (ctx) => {
    if (!launcher) {
      console.warn("[flow.chromium] no Chromium could be launched; run `npx playwright-core install chromium-headless-shell` or set HUGENTS_CHROMIUM_PATH");
      ctx.skip();
    }
    const good = await flow([{ role: "heading", name: "Welcome" }, { role: "button", name: "Save" }]);
    expect(good.finished.state).toBe("passed");
    expect(good.evidence).toMatchObject({ passed: true, executed: true });
    expect(good.issue.payload.outcome).toBe("passed");
    expect(String(good.issue.payload.title)).toMatch(/^Not reproduced: /);

    const bad = await flow([{ role: "heading", name: "Welcome" }, { role: "button", name: "Missing button" }]);
    expect(bad.finished.state).toBe("failed");
    expect(bad.evidence.reasons).toContain("assertion-failed");
    expect(JSON.stringify(bad.evidence)).not.toContain("synthetic-qa-credential");
    expect(bad.issue.payload.outcome).toBe("failed");
  }, 90_000);
});
