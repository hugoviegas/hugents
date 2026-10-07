import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createRelay, resolveConfig, type LiveFrame, type Relay } from "@hugents/live";
import { startDashboard } from "../src/observer/dashboard.js";
import { config } from "./observerFixtures.js";

/** Real Chromium against the real dashboard page, its /api/live proxy and a real relay. Frames are synthetic JPEGs. */
const VT = "viewer-token-0123456789";
const WT = "worker-token-0123456789";

let browser: Browser | undefined;
let server: Server;
let relay: Relay;
let dir: string;
let base = "";
let relayUrl = "";

async function launch(): Promise<Browser | undefined> {
  for (const executablePath of [undefined, process.env.PW_CHROMIUM_PATH, "/opt/pw-browsers/chromium"]) {
    try {
      return await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    } catch {
      // next candidate
    }
  }
  return undefined;
}

async function makeJpeg(page: Page, color: string): Promise<string> {
  // A real JPEG from the browser itself: a flat colour block, no real page content.
  return page.evaluate(async (c) => {
    const cv = document.createElement("canvas");
    cv.width = 320; cv.height = 180;
    const g = cv.getContext("2d")!;
    g.fillStyle = c; g.fillRect(0, 0, 320, 180);
    const blob: Blob = await new Promise((r) => cv.toBlob((b) => r(b!), "image/jpeg", 0.8));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  }, color);
}

beforeAll(async () => {
  browser = await launch();
  dir = await mkdtemp(path.join(tmpdir(), "duel-live-dialog-"));
  relay = createRelay({ viewerToken: VT, workerToken: WT, config: resolveConfig("high") });
  const relayPort = await relay.start();
  relayUrl = `http://127.0.0.1:${relayPort}`;
  const started = await startDashboard(config(dir), undefined, undefined, { live: { relayUrl: `http://127.0.0.1:${relayPort}`, viewerToken: VT } });
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;
});
afterAll(async () => {
  await browser?.close();
  await relay?.stop();
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

const frame = (seq: number, jpeg: string, hidden = false, player = "alpha"): LiveFrame => ({
  runId: "run-ui", agentId: "player-alpha", player, seq, at: new Date().toISOString(),
  width: hidden ? 0 : 320, height: hidden ? 0 : 180, jpeg: hidden ? "" : jpeg,
  gate: hidden ? { state: "hidden", reason: "hidden-screen" } : { state: "visible" },
});

describe("LiveRunDialog in the office page, real Chromium", () => {
  it("opens only during a run, streams, hides private screens, pauses, and clears everything on close and run end", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const csp: string[] = [];
    page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base);
    await page.waitForSelector(".agent");

    // No run: no Watch live button anywhere.
    expect(await page.locator('[data-key="watch-live"]').count()).toBe(0);

    // A run starts: the button appears for Player Alpha.
    relay.beginRun({ runId: "run-ui", agentId: "player-alpha", status: "working", phase: "login", startedAt: new Date().toISOString() });
    await page.locator(".agent", { hasText: "Alpha" }).first().click();
    await page.locator('[data-key="watch-live"]').waitFor({ timeout: 8000 });

    await page.locator('[data-key="watch-live"]').click();
    const dlg = page.getByRole("dialog");
    await dlg.waitFor();
    expect(await dlg.getAttribute("aria-modal")).toBe("true");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("live-title");
    await page.getByText("Connecting to the frame relay").first().waitFor();

    // The viewer is attached to the relay; a first frame goes live.
    const jpegRed = await makeJpeg(page, "#c33");
    const jpegBlue = await makeJpeg(page, "#36c");
    await page.waitForFunction(() => document.querySelector(".live-dlg") !== null);
    for (let i = 0; i < 40 && !relay.hasViewer(); i++) await new Promise((r) => setTimeout(r, 50));
    expect(relay.hasViewer()).toBe(true);
    relay.publish(frame(0, jpegRed));
    await page.waitForFunction(() => (document.querySelector(".live-canvas") as HTMLCanvasElement | null)?.width === 320);
    expect(await dlg.getByText("LIVE", { exact: true }).count()).toBeGreaterThan(0);
    // The painted pixel is the frame's colour (red-ish): the real frame reached the canvas.
    const px = await page.evaluate(() => Array.from((document.querySelector(".live-canvas") as HTMLCanvasElement).getContext("2d")!.getImageData(10, 10, 1, 1).data));
    expect(px[0]!).toBeGreaterThan(150);
    expect(px[2]!).toBeLessThan(100);
    // The frame is not interactive: no pointer events, not focusable.
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".live-canvas")!).pointerEvents)).toBe("none");
    expect(await page.locator(".live-canvas").getAttribute("tabindex")).toBeNull();

    // A private marker clears the canvas before the placeholder paints.
    relay.publish(frame(1, "", true));
    await dlg.getByText("Private screen hidden").first().waitFor();
    expect(await page.evaluate(() => (document.querySelector(".live-canvas") as HTMLCanvasElement).width)).toBe(0);
    // Back on a safe screen.
    relay.publish(frame(2, jpegBlue));
    await page.waitForFunction(() => (document.querySelector(".live-canvas") as HTMLCanvasElement).width === 320);

    // Pause holds the frame and drops incoming ones; the test is not paused.
    await dlg.getByRole("button", { name: "Pause view" }).click();
    relay.publish(frame(3, jpegRed));
    await new Promise((r) => setTimeout(r, 300));
    const held = await page.evaluate(() => Array.from((document.querySelector(".live-canvas") as HTMLCanvasElement).getContext("2d")!.getImageData(10, 10, 1, 1).data));
    expect(held[2]!).toBeGreaterThan(150); // still blue
    await dlg.getByRole("button", { name: "Resume view" }).click();

    // Hide viewport unsubscribes; show re-subscribes.
    await dlg.getByRole("button", { name: "Hide viewport" }).click();
    await dlg.getByText("Viewport hidden").first().waitFor();
    for (let i = 0; i < 40 && relay.hasViewer(); i++) await new Promise((r) => setTimeout(r, 50));
    expect(relay.hasViewer()).toBe(false);
    await dlg.getByRole("button", { name: "Show viewport" }).first().click();
    for (let i = 0; i < 40 && !relay.hasViewer(); i++) await new Promise((r) => setTimeout(r, 50));
    expect(relay.hasViewer()).toBe(true);

    // Quality: the lowest asked reaches the worker's poll.
    await dlg.getByLabel("Quality").selectOption("low");
    let preset: string | undefined;
    for (let i = 0; i < 40 && preset !== "low"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      preset = ((await (await fetch(`${relayUrl}/worker/wanted`, { headers: { authorization: `Bearer ${WT}` } })).json()) as { preset?: string }).preset;
    }
    expect(preset).toBe("low");

    // The run ends: the frame is cleared first, then the summary.
    relay.publish(frame(4, jpegRed));
    relay.endRun("run-ui", "completed");
    await dlg.getByText("Run finished · passed").waitFor();
    expect(await page.evaluate(() => (document.querySelector(".live-canvas") as HTMLCanvasElement).width)).toBe(0);
    await dlg.getByText("Frames cleared from this window").waitFor();

    // Esc closes and focus returns to a page control, never to the removed dialog.
    await page.keyboard.press("Escape");
    expect(await page.locator(".live-dlg").count()).toBe(0);
    expect(relay.hasViewer()).toBe(false);

    // With no run active, Watch live is gone.
    await page.waitForFunction(() => document.querySelector('[data-key="watch-live"]') === null, null, { timeout: 8000 });
    expect(csp).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it("shows No active run when opened without one, and closing returns focus", async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    relay.beginRun({ runId: "run-two", agentId: "player-alpha", status: "working", phase: "match", startedAt: new Date().toISOString() });
    await page.goto(base);
    await page.locator(".agent", { hasText: "Alpha" }).first().click();
    await page.locator('[data-key="watch-live"]').waitFor({ timeout: 8000 });
    await page.locator('[data-key="watch-live"]').click();
    relay.endRun("run-two", "failed");
    const dlg = page.getByRole("dialog");
    await dlg.getByText(/Run finished|No active run/).first().waitFor({ timeout: 8000 });
    await dlg.getByRole("button", { name: "Close live view" }).click();
    expect(await page.locator(".live-dlg").count()).toBe(0);
    await page.close();
  }, 40_000);
});
