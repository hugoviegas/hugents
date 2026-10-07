import { createServer, type Server } from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InMemoryStore, createSanitizer, parseManifest, type Manifest } from "@hugents/core";
import {
  InMemoryDraftRepository,
  createPlaywrightExecutor,
  enqueueApprovedDraft,
  hashSpec,
  placeholderLoginAdapter,
  runDraftTask,
  runSpec,
  type ExecutorConfig,
  type LoginAdapter,
} from "../src/index.js";
import { approveDraft } from "../src/admin.js";
import { NOW, wrap } from "./fixtures.js";

const CREDENTIAL = "QA-credential-value-12345";
const FAKE_EMAIL = "player@example.test";
const FAKE_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123";
const FAKE_ROOM = "room code ABCD12";
const FAKE_URL = "https://real-looking.example.test/secret/path";

const PAGE = `<!doctype html><html><body>
<main>
  <label>Account <input aria-label="Account" /></label>
  <button id="signin" onclick="document.getElementById('app').hidden=false">Sign in</button>
  <div id="app" hidden>
    <h1>Welcome</h1>
    <button onclick="document.getElementById('msg').textContent='Saved'">Save</button>
    <p id="msg"></p>
    <p>Contact ${FAKE_EMAIL} token ${FAKE_TOKEN} ${FAKE_ROOM} ${FAKE_URL}</p>
    <button onclick="fetch('http://localhost:1/outside').catch(()=>{});fetch(location.origin.replace('localhost','127.0.0.1')+'/x').catch(()=>{})">Ping</button>
    <button onclick="window.open('/', '_blank'); window.open('/', '_blank'); window.open('/', '_blank')">Popups</button>
    <input aria-label="Name" />
  </div>
</main></body></html>`;

let server: Server;
let origin = "";
let manifest: Manifest;
const HIDDEN_HOST_HIT: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.headers.host?.startsWith("127.0.0.1")) HIDDEN_HOST_HIT.push(req.url ?? "");
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
  if (!parsed.ok) throw new Error("fixture manifest");
  manifest = parsed.manifest;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const config = (over: Partial<ExecutorConfig> = {}): ExecutorConfig => ({
  manifest,
  targetUrl: origin,
  accountVariable: "QA_ACCOUNT_A",
  env: { QA_ACCOUNT_A: CREDENTIAL },
  login: placeholderLoginAdapter,
  limits: { testTimeoutMs: 8000, runTimeoutMs: 20000, assertionTimeoutMs: 1500 },
  ...over,
});

const test1 = (body: string) =>
  wrap(`await page.getByRole("button", { name: "Sign in" }).click();\n${body}`);

const tmpEntries = (root: string) => readdirSync(root).filter((n) => n.startsWith("hugents-run-"));

describe("restricted executor", () => {
  it("runs a passing spec against the fixture page", async () => {
    const r = await runSpec(test1(`await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
await page.getByRole("button", { name: "Save" }).click();
await expect(page.getByText("Saved")).toBeVisible();`), config());
    expect(r).toMatchObject({ passed: true, reasons: [], tests: 1 });
  });

  it("reports a failing assertion with a code and no page text", async () => {
    const r = await runSpec(test1(`await expect(page.getByText("Never shown")).toBeVisible();`), config());
    expect(r.passed).toBe(false);
    expect(r.reasons).toEqual(["assertion-failed"]);
    expect(JSON.stringify(r)).not.toMatch(/Welcome|Never shown/);
  });

  it("refuses a blocked or unlisted target before launching a browser", async () => {
    const launch = vi.fn();
    for (const targetUrl of ["http://localhost:1", "https://prod.example.test"]) {
      const r = await runSpec(wrap(""), config({ targetUrl, launch }));
      expect(r.reasons).toEqual(["target-blocked"]);
    }
    expect(launch).not.toHaveBeenCalled();
  });

  it("aborts and counts requests outside the allowlist", async () => {
    const r = await runSpec(test1(`await page.getByRole("button", { name: "Ping" }).click();
await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
await expect(page.getByText("Saved")).toBeHidden();`), config());
    expect(r.blockedRequests).toBeGreaterThan(0);
    expect(r.reasons).toContain("network-blocked");
    expect(HIDDEN_HOST_HIT).toEqual([]);
  });

  it("fails a test that exceeds the per-test timeout and closes the browser", async () => {
    const close = vi.fn();
    const r = await runSpec(
      test1(`await expect(page.getByText("Waiting")).toBeVisible();`),
      config({ limits: { testTimeoutMs: 300, assertionTimeoutMs: 60_000 }, launch: wrapLaunch(close) }),
    );
    expect(r.reasons).toContain("run-timeout");
    expect(r.passed).toBe(false);
    expect(close).toHaveBeenCalled();
  });

  it("fails a test that exceeds the action limit", async () => {
    const r = await runSpec(
      test1(`for (let i = 0; i < 20; i++) { await page.getByRole("button", { name: "Save" }).click(); }`),
      config({ limits: { maxActions: 5, testTimeoutMs: 8000, assertionTimeoutMs: 1500 } }),
    );
    expect(r.reasons).toEqual(["action-limit"]);
  });

  it("fails when more pages are open than the limit", async () => {
    const r = await runSpec(
      test1(`await page.getByRole("button", { name: "Popups" }).click();\nawait expect(page.getByText("Saved")).toBeHidden();`),
      config({ limits: { maxPages: 1, testTimeoutMs: 8000, assertionTimeoutMs: 1500 } }),
    );
    expect(r.reasons).toContain("page-limit");
    expect(r.passed).toBe(false);
  });

  it("stops a forbidden API at the wrapper even when the validator is bypassed", async () => {
    // Calls the module-level pieces directly, as the executor would after a validator miss.
    const { createExpect, createSeedModule, RunBudget, wrapPage, DEFAULT_LIMITS } = await import("../src/harness.js");
    const budget = new RunBudget(DEFAULT_LIMITS);
    budget.startTest();
    const raw = { getByRole: () => ({}) , getByLabel: () => ({}), getByText: () => ({}), getByTestId: () => ({}) } as never;
    const page = wrapPage(raw, budget, DEFAULT_LIMITS) as Record<string, unknown>;
    for (const prop of ["goto", "evaluate", "context", "locator", "route", "keyboard"]) {
      expect(() => page[prop]).toThrow(/api-not-allowed/);
    }
    expect(() => {
      page.extra = 1;
    }).toThrow(/api-not-allowed/);
    void createExpect;
    void createSeedModule;
  });

  it("rejects a spec the validator rejects, before launching a browser", async () => {
    const launch = vi.fn();
    const r = await runSpec(wrap(`await page.goto("https://example.test");`), config({ launch }));
    expect(r.passed).toBe(false);
    expect(r.reasons).toContain("hardcoded-url");
    expect(launch).not.toHaveBeenCalled();
  });

  it("never exposes the credential, and keeps seeded page text out of results", async () => {
    const sinks: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void sinks.push(a.map(String).join(" "))),
    );
    const thrownLogin: LoginAdapter = async (_p, credential) => {
      throw new Error(`login rejected ${credential}`);
    };
    const results = [
      await runSpec(test1(`await expect(page.getByText("Contact")).toBeVisible();`), config()),
      await runSpec(test1(`await expect(page.getByText("nothing")).toBeVisible();`), config()),
      await runSpec(wrap(""), config({ login: thrownLogin })),
    ];
    spies.forEach((s) => s.mockRestore());
    const all = JSON.stringify(results) + sinks.join("\n");
    expect(results[2]!.reasons).toEqual(["login-failed"]);
    for (const secret of [CREDENTIAL, FAKE_EMAIL, FAKE_TOKEN, "ABCD12", FAKE_URL]) expect(all).not.toContain(secret);
  });

  it("removes temporary files and closes the browser after pass, fail, timeout and crash", async () => {
    const root = await mkdtemp(join(tmpdir(), "hugents-test-root-"));
    const close = vi.fn();
    const base = { tmpRoot: root, launch: wrapLaunch(close) };
    await runSpec(test1(`await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();`), config(base));
    await runSpec(test1(`await expect(page.getByText("x")).toBeVisible();`), config(base));
    await runSpec(test1(`await expect(page.getByText("x")).toBeVisible();`), config({ ...base, limits: { testTimeoutMs: 200, assertionTimeoutMs: 60_000 } }));
    await runSpec(wrap(""), config({ ...base, login: async () => { throw new Error("crash"); } }));
    const crashed = await runSpec(wrap(""), config({ tmpRoot: root, launch: async () => { throw new Error("no browser"); } }));
    expect(crashed.reasons).toEqual(["browser-failed"]);
    expect(close).toHaveBeenCalledTimes(4);
    expect(tmpEntries(root)).toEqual([]);
    expect(existsSync(root)).toBe(true);
    await rm(root, { recursive: true });
  });

  it("shares no cookies or storage between two runs", async () => {
    const setStorage = test1(`await page.getByRole("textbox", { name: "Name" }).fill("kept");`);
    // The page writes nothing itself, so seed state through a login adapter that uses the raw page.
    const writer: LoginAdapter = async (p, c) => {
      await placeholderLoginAdapter(p, c);
      await (p as unknown as { evaluate(f: string): Promise<void> }).evaluate("localStorage.setItem('k','v'); document.cookie='a=b'");
    };
    let seen: string | undefined;
    const reader: LoginAdapter = async (p) => {
      seen = await (p as unknown as { evaluate(f: string): Promise<string> }).evaluate("localStorage.getItem('k') + '|' + document.cookie");
    };
    await runSpec(setStorage, config({ login: writer }));
    await runSpec(wrap(""), config({ login: reader }));
    expect(seen).toBe("null|");
  });
});

describe("runDraftTask with the executor", () => {
  function setup() {
    const store = new InMemoryStore();
    const drafts = new InMemoryDraftRepository();
    const sanitizer = createSanitizer();
    return { store, drafts, sanitizer, manifest, now: () => NOW };
  }
  const spec = () => test1(`await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();`);

  async function approvedDraft(d: ReturnType<typeof setup>, text: string) {
    const draft = {
      id: "draft-1", requestId: "1", plan: "", spec: text, validation: { ok: true, issues: [] },
      status: "draft" as const, contentHash: hashSpec(text), reasons: [],
    };
    const approved = approveDraft(draft, { id: "admin", role: "admin" }, manifest, NOW);
    await d.drafts.save(approved);
    return approved;
  }

  it("runs an approved draft end to end and records ordered events with codes only", async () => {
    const d = setup();
    const approved = await approvedDraft(d, spec());
    const task = await enqueueApprovedDraft(d.store, approved, NOW);
    const done = await runDraftTask({ ...d, executor: createPlaywrightExecutor(config()) }, task);
    expect(done?.status).toBe("passed");
    const events = await d.store.listEvents(`run-${approved.id}`);
    expect(events.map((e) => e.label)).toEqual(["test draft: approved", "test draft: running", "test draft: completed"]);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
    const all = JSON.stringify([events, done]);
    for (const secret of [CREDENTIAL, FAKE_EMAIL, FAKE_TOKEN, origin]) expect(all).not.toContain(secret);
  });

  it("records the reason code on a failing run", async () => {
    const d = setup();
    const approved = await approvedDraft(d, test1(`await expect(page.getByText("zzz")).toBeVisible();`));
    const task = await enqueueApprovedDraft(d.store, approved, NOW);
    const done = await runDraftTask({ ...d, executor: createPlaywrightExecutor(config()) }, task);
    expect(done).toMatchObject({ status: "failed", reasons: ["assertion-failed"] });
    const events = await d.store.listEvents(`run-${approved.id}`);
    expect(events.at(-1)?.label).toBe("test draft: failed (assertion-failed)");
  });

  it("does not run, and never launches a browser, when the spec was altered after approval", async () => {
    const d = setup();
    const approved = await approvedDraft(d, spec());
    const task = await enqueueApprovedDraft(d.store, approved, NOW);
    await d.drafts.save({ ...approved, spec: approved.spec.replace("Welcome", "Changed") });
    const launch = vi.fn();
    const done = await runDraftTask({ ...d, executor: createPlaywrightExecutor(config({ launch })) }, task);
    expect(done?.status).toBe("approved");
    expect(launch).not.toHaveBeenCalled();
  });
});

/** Wraps the real launcher so the test can see `close` calls. */
function wrapLaunch(close: () => void) {
  return async (tmp: string) => {
    const { chromium } = await import("playwright-core");
    const real = await chromium.launch({ headless: true, downloadsPath: tmp });
    return {
      newContext: (o: Record<string, unknown>) => real.newContext(o as never) as never,
      close: async () => {
        close();
        await real.close();
      },
    };
  };
}
