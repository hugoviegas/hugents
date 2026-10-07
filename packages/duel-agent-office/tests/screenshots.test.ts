import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTask, type TaskDeps } from "../src/office/agents.js";
import type { OfficeEvent, TaskOutcome } from "../src/office/contract.js";
import type { Inference } from "../src/office/inference.js";
import { openMetrics } from "../src/office/metrics.js";
import { openBudget } from "../src/office/provider/budget.js";
import { createReportChain } from "../src/office/provider/chain.js";
import { loadProviderConfig } from "../src/office/provider/config.js";
import { geminiProvider, type GeminiClientLike } from "../src/office/provider/gemini.js";
import { ollamaProvider } from "../src/office/provider/ollama.js";
import type { ImagePart, ReportProvider } from "../src/office/provider/types.js";
import { pickScreenshots, readApprovedImages, type ToolDeps } from "../src/office/tools.js";

const RUN = "2026-10-06T20-00-00-000Z-explore-screens";
const KEY = "AIzaSy-test-key-not-real-0123456789";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A distinctive payload per file so a leaked byte is easy to spot. */
const png = (marker: string, size = 600) => Buffer.concat([PNG_SIGNATURE, Buffer.from(marker.padEnd(size, "~"))]);
const b64 = (marker: string, size?: number) => png(marker, size).toString("base64");

const GOOD = {
  verdict: "issues",
  summary: "The menu is readable but one control is small.",
  findings: [{ severity: "low", category: "touch-target", assessment: "A control looks under 44 px.", area: "alpha/03-menu.png" }],
  repeatedProblems: [],
  nextSteps: ["Enlarge the control."],
};
const okAnswer = async () => ({ text: JSON.stringify(GOOD), usageMetadata: { totalTokenCount: 900 } });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-shots-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type Params = Parameters<GeminiClientLike["models"]["generateContent"]>[0];
function fakeClient(handler: (p: Params) => Promise<{ text?: string; usageMetadata?: { totalTokenCount?: number } }> = okAnswer) {
  const calls: Params[] = [];
  const client: GeminiClientLike = { models: { generateContent: async (p) => (calls.push(p), handler(p)) } };
  return { client, calls };
}
const apiError = (status: number) => Object.assign(new Error("x"), { status, name: "ApiError" });

/** A run whose events reference `referenced` screenshots; `extra` files exist on disk but nothing references them. */
async function makeRun(referenced: Record<string, Buffer>, extra: Record<string, Buffer> = {}) {
  const root = path.join(dir, "runs", RUN);
  await mkdir(path.join(root, "alpha"), { recursive: true });
  await mkdir(path.join(root, "bravo"), { recursive: true });
  await writeFile(path.join(root, "summary.json"), JSON.stringify({ runId: RUN, scenario: "explore-screens", status: "completed", durationMs: 20_000, result: { screens: [{ screen: "menu", ok: true }] } }));
  const events = Object.keys(referenced).map((rel, i) =>
    JSON.stringify({ at: `2026-10-06T20:00:${String(i).padStart(2, "0")}.000Z`, runId: RUN, agent: "player-alpha", status: "working", scenario: "explore-screens", activity: "step", artifactPath: rel }),
  );
  await writeFile(path.join(root, "events.jsonl"), `${events.join("\n")}\n`);
  await writeFile(path.join(root, "console.jsonl"), "");
  await writeFile(path.join(root, "network-failures.jsonl"), "");
  for (const [rel, bytes] of Object.entries({ ...referenced, ...extra })) await writeFile(path.join(root, ...rel.split("/")), bytes);
}

const tools = (): ToolDeps => ({ artifactsDir: dir, secrets: () => [KEY] });
const SIX = Object.fromEntries(["01-login-screen", "02-logged-in", "03-menu", "04-missions", "05-shop", "06-profile", "07-leaderboard"].map((n) => [`alpha/${n}.png`, png(n)]));

describe("screenshot settings", () => {
  const active = { GEMINI_ENABLED: "true", GEMINI_API_KEY: KEY, GEMINI_MODEL: "gemini-3.5-flash-lite" };

  it("keeps screenshots away from Gemini unless GEMINI_SEND_SCREENSHOTS is true", () => {
    expect(loadProviderConfig(active).gemini?.sendScreenshots).toBe(false);
    expect(loadProviderConfig({ ...active, GEMINI_SEND_SCREENSHOTS: "false" }).gemini?.sendScreenshots).toBe(false);
    expect(loadProviderConfig({ ...active, GEMINI_SEND_SCREENSHOTS: "true" }).gemini?.sendScreenshots).toBe(true);
    const typo = loadProviderConfig({ ...active, GEMINI_SEND_SCREENSHOTS: "yes" });
    expect(typo.gemini?.sendScreenshots).toBe(false); // a typo never turns it on
    expect(typo.warnings.join(" ")).toContain("GEMINI_SEND_SCREENSHOTS must be true or false");
    // the flag alone does nothing while Gemini is not active
    expect(loadProviderConfig({ GEMINI_SEND_SCREENSHOTS: "true" }).gemini).toBeUndefined();
    expect(loadProviderConfig({ ...active, GEMINI_ENABLED: "false", GEMINI_SEND_SCREENSHOTS: "true" }).gemini).toBeUndefined();
  });

  it("limits the count and the size of each screenshot", () => {
    expect(loadProviderConfig({}).images).toEqual({ max: 4, maxBytes: 1_500_000 });
    expect(loadProviderConfig({ GEMINI_MAX_SCREENSHOTS: "2", GEMINI_MAX_SCREENSHOT_BYTES: "200000" }).images).toEqual({ max: 2, maxBytes: 200_000 });
    const bad = loadProviderConfig({ GEMINI_MAX_SCREENSHOTS: "99", GEMINI_MAX_SCREENSHOT_BYTES: "5" });
    expect(bad.images).toEqual({ max: 4, maxBytes: 1_500_000 });
    expect(bad.warnings).toHaveLength(2);
  });
});

describe("approved screenshots only", () => {
  it("picks an even spread and never the login/splash shot", () => {
    const names = Object.keys(SIX);
    expect(pickScreenshots(names, 3)).toEqual(["alpha/02-logged-in.png", "alpha/05-shop.png", "alpha/07-leaderboard.png"]);
    expect(pickScreenshots(names, 20)).not.toContain("alpha/01-login-screen.png");
    expect(pickScreenshots(names, 1)).toHaveLength(1);
  });

  it("loads only what passes every check: name, regular file, size, PNG signature, count", async () => {
    await makeRun(
      { "alpha/03-menu.png": png("menu"), "alpha/04-big.png": png("big", 5_000), "alpha/05-fake.png": Buffer.from("not a png at all"), "alpha/06-empty.png": Buffer.alloc(0), "alpha/07-ok.png": png("ok") },
      { "alpha/99-unreferenced.png": png("unreferenced") },
    );
    const approved = ["alpha/03-menu.png", "alpha/04-big.png", "alpha/05-fake.png", "alpha/06-empty.png", "alpha/07-ok.png", "../../.env", "alpha/trace.zip", "carol/01-x.png", "alpha/sub/01-x.png"];
    const images = await readApprovedImages(tools(), RUN, approved, { max: 9, maxBytes: 2_000 });
    expect(images.map((i) => i.name)).toEqual(["alpha/03-menu.png", "alpha/07-ok.png"]);
    expect(images[0]).toMatchObject({ mimeType: "image/png", data: b64("menu") });
    expect((await readApprovedImages(tools(), RUN, approved, { max: 1, maxBytes: 2_000 })).length).toBe(1);
    expect(await readApprovedImages(tools(), "not-a-run-id", approved, { max: 9, maxBytes: 2_000 })).toEqual([]);
  });
});

describe("gemini provider and screenshots", () => {
  const input = () => ({ agent: "design-critic" as const, run: { id: RUN }, observer: { available: true, findings: [], repeated: [], ignoredNetworkFailures: 0 }, recordCounts: { events: 1, console: 0, networkFailures: 0 }, screenshotRefs: [] });
  const images: ImagePart[] = [
    { name: "alpha/03-menu.png", mimeType: "image/png", data: b64("MENU-BYTES") },
    { name: "alpha/04-missions.png", mimeType: "image/png", data: b64("MISSIONS-BYTES") },
  ];
  const budgetFile = () => path.join(dir, "usage.json");
  const make = async (client: GeminiClientLike, sendImages: boolean, limits = { perRun: 5, perDayPerModel: 50 }) =>
    geminiProvider({ apiKey: KEY, models: ["m1", "m2"], timeoutMs: 1_000, maxOutputTokens: 256, budget: await openBudget(budgetFile(), limits), client, sendImages, retryDelayMs: 0, sleep: async () => undefined });

  it("sends nothing, and makes no request at all, for a screenshot review when the flag is off", async () => {
    const { client, calls } = fakeClient();
    for (const provider of [await make(client, false), geminiProvider({ apiKey: KEY, models: ["m1"], timeoutMs: 1_000, maxOutputTokens: 1, budget: await openBudget(budgetFile(), { perRun: 5, perDayPerModel: 50 }), client })]) {
      const result = await provider.generate(input(), { runKey: RUN, images });
      expect(result).toMatchObject({ attempts: [{ provider: "gemini", status: "disabled" }], tokens: 0 });
      expect(result.report).toBeUndefined();
    }
    expect(calls).toHaveLength(0);
    await expect(readFile(budgetFile(), "utf8")).rejects.toThrow(); // nothing was counted either
  });

  it("attaches exactly the given screenshots as PNG inline data when the flag is on", async () => {
    const { client, calls } = fakeClient();
    const result = await (await make(client, true)).generate(input(), { runKey: RUN, images });
    expect(result).toMatchObject({ imagesSent: 2, tokens: 900, attempts: [{ provider: "gemini", model: "m1", status: "ok" }] });
    const contents = calls[0]!.contents as { role: string; parts: Record<string, unknown>[] }[];
    expect(contents).toHaveLength(1);
    expect(contents[0]!.parts).toHaveLength(3);
    expect((contents[0]!.parts[0] as { text: string }).text).toContain('"attachedScreenshots":["alpha/03-menu.png","alpha/04-missions.png"]');
    expect(contents[0]!.parts.slice(1)).toEqual(images.map((i) => ({ inlineData: { mimeType: "image/png", data: i.data } })));
    expect(JSON.stringify(calls[0]!.config)).not.toContain("MENU-BYTES");
  });

  it("does not add images to a request that has none", async () => {
    const { client, calls } = fakeClient();
    const result = await (await make(client, true)).generate(input(), { runKey: RUN });
    expect(typeof calls[0]!.contents).toBe("string");
    expect(result.imagesSent).toBeUndefined();
  });

  it("counts an image request in the per-run and per-day budgets like any other", async () => {
    const { client, calls } = fakeClient();
    const provider = await make(client, true, { perRun: 1, perDayPerModel: 50 });
    expect((await provider.generate(input(), { runKey: RUN, images })).report).toBeTruthy();
    const second = await provider.generate(input(), { runKey: RUN, images });
    expect(second.attempts[0]?.status).toBe("budget-run");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(await readFile(budgetFile(), "utf8"))).toMatchObject({ models: { m1: 1 }, runs: { [RUN]: 1 } });

    const daily = await make(fakeClient().client, true, { perRun: 50, perDayPerModel: 1 }); // m1 already used once today
    expect((await daily.generate(input(), { runKey: `${RUN}-b`, images })).attempts.map((a) => a.status)).toEqual(["budget-daily", "ok"]);
  });
});

describe("design-critic end to end", () => {
  const fakeInference = (vision: boolean) => {
    const requests: { images?: string[] }[] = [];
    const inference: Inference = { vision, complete: async (r) => (requests.push(r), { text: JSON.stringify({ ...GOOD, findings: [{ ...GOOD.findings[0], area: "local" }] }), tokens: 17 }) };
    return { inference, requests };
  };

  async function critic(opts: { remote: boolean; vision: boolean; gemini?: (p: Params) => Promise<{ text?: string; usageMetadata?: { totalTokenCount?: number } }>; max?: number; agent?: "design-critic" | "qa-analyst" }) {
    await makeRun(SIX, { "alpha/99-unreferenced.png": png("UNREFERENCED") });
    const g = fakeClient(opts.gemini);
    const o = fakeInference(opts.vision);
    const budget = await openBudget(path.join(dir, "office", "provider-usage.json"), { perRun: 5, perDayPerModel: 50 });
    const providers: ReportProvider[] = [
      geminiProvider({ apiKey: KEY, models: ["gemini-3.5-flash-lite"], timeoutMs: 1_000, maxOutputTokens: 256, budget, client: g.client, sendImages: opts.remote, retryDelayMs: 0, sleep: async () => undefined }),
      ollamaProvider(o.inference, "llama3.2:latest", "llama3.2-vision"),
    ];
    const events: OfficeEvent[] = [];
    const deps: TaskDeps = {
      tools: tools(),
      inference: o.inference,
      metrics: await openMetrics(path.join(dir, "office", "metrics.json")),
      emit: (e) => events.push(e),
      reporter: createReportChain({ providers, secrets: () => [KEY] }),
      screenshots: { max: opts.max ?? 4, maxBytes: 100_000, remote: opts.remote },
    };
    const outcome: TaskOutcome = await runTask(deps, { taskId: "t1", agentId: opts.agent ?? "design-critic", title: `review ${RUN}` });
    return { outcome, events, gemini: g, ollama: o };
  }
  const reportOf = async (outcome: TaskOutcome) => readFile(path.join(dir, outcome.reportPath!), "utf8");
  const everything = async (r: Awaited<ReturnType<typeof critic>>) =>
    JSON.stringify([r.events, r.outcome, await reportOf(r.outcome), await readFile(path.join(dir, "office", "provider-usage.json"), "utf8").catch(() => "")]);

  it("WITHOUT the flag and without a local vision model no model is called and no image byte leaves", async () => {
    const r = await critic({ remote: false, vision: false });
    expect(r.gemini.calls).toHaveLength(0);
    expect(r.ollama.requests).toHaveLength(0);
    expect(r.outcome).toMatchObject({ status: "completed", usedFallback: true, tokensUsed: 0 });
    expect(r.outcome.provider).toBeUndefined();
    expect(await reportOf(r.outcome)).toContain("Design checklist (no vision model");
  });

  it("WITHOUT the flag, a local vision model sees the screenshots but not one image byte reaches the Gemini client", async () => {
    const r = await critic({ remote: false, vision: true });
    expect(r.gemini.calls).toHaveLength(0); // not even a text-only request
    expect(r.ollama.requests).toHaveLength(1);
    expect(r.ollama.requests[0]!.images).toHaveLength(4);
    expect(r.outcome.provider).toMatchObject({ used: "ollama", model: "llama3.2-vision", imagesSent: 4 });
    expect(r.outcome.provider?.attempts[0]).toEqual({ provider: "gemini", status: "disabled" });
    expect(JSON.stringify(r.gemini.calls)).not.toMatch(/inlineData|iVBOR/);
  });

  it("WITH the flag, Gemini gets only approved, in-limit PNGs: at most the count cap, never the unreferenced one", async () => {
    const r = await critic({ remote: true, vision: false, gemini: okAnswer, max: 3 });
    expect(r.gemini.calls).toHaveLength(1);
    const parts = (r.gemini.calls[0]!.contents as { parts: { inlineData?: { data: string } }[] }[])[0]!.parts;
    const sent = parts.filter((p) => p.inlineData).map((p) => p.inlineData!.data);
    expect(sent).toEqual([b64("02-logged-in"), b64("05-shop"), b64("07-leaderboard")]);
    expect(sent).not.toContain(b64("UNREFERENCED"));
    expect(sent).not.toContain(b64("01-login-screen"));
    expect(r.outcome.provider).toMatchObject({ used: "gemini", model: "gemini-3.5-flash-lite", imagesSent: 3 });
    expect(r.outcome.tokensUsed).toBe(900);
    const report = await reportOf(r.outcome);
    expect(report).toContain("[low] touch-target"); // a screenshot review keeps its own findings
    expect(report).toContain("gemini (gemini-3.5-flash-lite), 3 screenshot(s) sent");
    expect(report).toContain("## Screenshots (3 of 7 were reviewed by the provider above)");
    expect(report).not.toContain("screenshots not analysed");
  });

  it("falls back to the local vision model when Gemini is out of quota, and counts the request", async () => {
    const r = await critic({ remote: true, vision: true, gemini: async () => Promise.reject(apiError(429)) });
    expect(r.outcome.provider?.attempts.map((a) => `${a.provider}:${a.status}`)).toEqual(["gemini:rate-limit", "ollama:ok"]);
    expect(r.ollama.requests[0]!.images).toHaveLength(4);
    expect(JSON.parse(await readFile(path.join(dir, "office", "provider-usage.json"), "utf8"))).toMatchObject({ models: { "gemini-3.5-flash-lite": 1 } });
  });

  it("never lets image bytes into events, outcomes, reports or budget files", async () => {
    const r = await critic({ remote: true, vision: true, gemini: okAnswer });
    const text = await everything(r);
    for (const marker of ["iVBOR", "02-logged-in~~", b64("04-missions").slice(0, 40)]) expect(text).not.toContain(marker);
    expect(await readdir(path.join(dir, "office"))).toEqual(expect.arrayContaining(["metrics.json", "provider-usage.json"]));
  });

  it("never attaches screenshots for the other agents, even with the flag on", async () => {
    const r = await critic({ remote: true, vision: true, gemini: okAnswer, agent: "qa-analyst" });
    expect(typeof r.gemini.calls[0]!.contents).toBe("string");
    expect(JSON.stringify(r.gemini.calls)).not.toMatch(/inlineData|iVBOR/);
    expect(r.ollama.requests.every((q) => !q.images)).toBe(true);
  });
});

describe("only one module builds image parts", () => {
  it("keeps `inlineData` inside provider/gemini.ts", async () => {
    const hits: string[] = [];
    const walk = async (rel: string) => {
      for (const entry of await readdir(path.join(process.cwd(), rel), { withFileTypes: true })) {
        const next = `${rel}/${entry.name}`;
        if (entry.isDirectory()) await walk(next);
        else if (entry.name.endsWith(".ts") && /inlineData/.test(await readFile(path.join(process.cwd(), next), "utf8"))) hits.push(next);
      }
    };
    await walk("src");
    expect(hits).toEqual(["src/office/provider/gemini.ts"]);
  });
});
