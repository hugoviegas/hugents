import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createRelay, resolveConfig, type LiveFrame, type Relay, type LiveStage } from "@hugents/live";
import { startLiveView, type LivePlayer } from "../src/live/liveView.js";

/**
 * Real Chromium, real page.screencast, real loopback relay. The pages are synthetic: a moving box and made-up text.
 * The private page carries a fake e-mail and room code that must never reach a visible frame.
 */
const VT = "viewer-token-0123456789";
const WT = "worker-token-0123456789";
const PAGE = (screen: string, text: string) =>
  `<!doctype html><body data-screen="${screen}" style="margin:0;font:20px sans-serif"><p>${text}</p>
   <div id="b" style="position:absolute;top:80px;left:0;width:60px;height:60px;background:#36c"></div>
   <script>let x=0;setInterval(()=>{x=(x+7)%300;document.getElementById('b').style.left=x+'px'},30)</script></body>`;

let browser: Browser | undefined;
let fixture: http.Server;
let fixtureUrl = "";
let relay: Relay;
let relayUrl = "";

async function launch(): Promise<Browser | undefined> {
  const tries = [undefined, process.env.PW_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter((p, i) => i === 0 || p);
  for (const executablePath of tries) {
    try {
      return await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

beforeAll(async () => {
  browser = await launch();
  fixture = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(req.url === "/private" ? PAGE("private", "tester@example.invalid ROOMCODE-1234") : PAGE("home", "synthetic home screen"));
  });
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  fixtureUrl = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  relay = createRelay({ viewerToken: VT, workerToken: WT, config: resolveConfig("high") });
  relayUrl = `http://127.0.0.1:${await relay.start()}`;
});
afterAll(async () => {
  await browser?.close();
  await relay?.stop();
  fixture?.close();
});

function viewer() {
  const frames: LiveFrame[] = [];
  const ctl = new AbortController();
  void (async () => {
    const res = await fetch(`${relayUrl}/viewer/stream?player=alpha`, { headers: { authorization: `Bearer ${VT}` }, signal: ctl.signal });
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (block.startsWith("event: frame")) frames.push(JSON.parse(block.split("data: ")[1]!) as LiveFrame);
      }
    }
  })().catch(() => undefined);
  return { frames, close: () => ctl.abort() };
}
const until = async (cond: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 40));
  }
};

describe("live view with real Chromium", () => {
  it("streams real JPEG frames, hides a private screen, and stops capture when the viewer leaves", async (ctx) => {
    if (!browser) return ctx.skip();
    const context = await browser.newContext({ viewport: { width: 400, height: 300 } });
    const page: Page = await context.newPage();
    await page.goto(fixtureUrl);
    const player: LivePlayer = {
      label: "alpha",
      page,
      inPrivateStep: false,
      isSafeToCapture: async () => (await page.getAttribute("body", "data-screen")) === "home",
    };
    const stages: LiveStage[] = [];
    const settings = { relayUrl, workerToken: WT, agentId: "player-alpha", config: resolveConfig("high", { maxFps: 8 }), pollMs: 50 };
    const live = await startLiveView({ settings, runId: "run-chromium", players: [player], onEvent: (s) => stages.push(s) });
    expect(live).toBeDefined();

    // No viewer yet: nothing is captured.
    await new Promise((r) => setTimeout(r, 300));
    expect(stages).not.toContain("stream-start");

    const v = viewer();
    await until(() => v.frames.some((f) => f.gate.state === "visible"));
    const first = v.frames.find((f) => f.gate.state === "visible")!;
    const bytes = Buffer.from(first.jpeg, "base64");
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]); // a real JPEG from the browser
    expect(first.width).toBeGreaterThan(0);
    expect(first.width).toBeLessThanOrEqual(resolveConfig("high").maxWidth);

    // A private screen: frames become placeholders without pixels, and stay so.
    await page.goto(`${fixtureUrl}/private`);
    await until(() => v.frames.some((f) => f.gate.state === "hidden"));
    const mark = v.frames.length;
    await until(() => v.frames.length >= mark + 4);
    const after = v.frames.slice(v.frames.findIndex((f) => f.gate.state === "hidden"));
    expect(after.every((f) => f.gate.state === "hidden" && f.jpeg === "")).toBe(true);
    expect(JSON.stringify(after)).not.toMatch(/ROOMCODE|example\.invalid/);
    expect(stages).toContain("gate-blocked");

    // A login step blacks out even a screen that would be safe, and releases afterwards.
    await page.goto(fixtureUrl);
    await until(() => v.frames[v.frames.length - 1]?.gate.state === "visible");
    player.inPrivateStep = true;
    player.onPrivateStep?.(true);
    await until(() => v.frames[v.frames.length - 1]?.gate.state === "hidden");
    player.inPrivateStep = false;
    player.onPrivateStep?.(false);
    await until(() => v.frames[v.frames.length - 1]?.gate.state === "visible");

    // Closing the popup (viewer leaves) stops capture.
    v.close();
    await until(() => stages.includes("viewer-disconnected") && stages.includes("stream-end"));

    await live!.stop("completed");
    expect(relay.hasViewer()).toBe(false);
    const status = await (await fetch(`${relayUrl}/viewer/status`, { headers: { authorization: `Bearer ${VT}` } })).json();
    expect(status).toMatchObject({ run: null, players: [], lastRun: { status: "completed" } });
    await context.close();
  }, 30_000);
});
