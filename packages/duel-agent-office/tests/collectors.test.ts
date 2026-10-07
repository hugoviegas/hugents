import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { attachCollectors } from "../src/browser/collectors.js";
import { createRunDir } from "../src/storage/artifacts.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-collectors-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const lines = async (file: string) =>
  (await readFile(file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("collectors", () => {
  it("records only errors and failed requests, with secrets and query strings removed", async () => {
    const run = await createRunDir(dir, "s");
    const page = new EventEmitter();
    attachCollectors(page as unknown as Page, "player-alpha", run, ["topsecret-pass"]);

    page.emit("console", { type: () => "log", text: () => "ignored", location: () => ({ url: "" }) });
    page.emit("console", {
      type: () => "error",
      text: () => "auth failed for topsecret-pass",
      location: () => ({ url: "https://x.vercel.app/a.js?token=abc" }),
    });
    page.emit("pageerror", new Error("Uncaught: boom owner@example.com"));
    page.emit("requestfailed", {
      method: () => "GET",
      url: () => "https://db.example.com/r.json?auth=SECRETVALUE",
      failure: () => ({ errorText: "net::ERR_FAILED" }),
    });
    page.emit("response", { status: () => 200, url: () => "https://ok", request: () => ({ method: () => "GET" }) });
    page.emit("response", {
      status: () => 403,
      url: () => "https://api.example.com/x?key=SECRETVALUE",
      request: () => ({ method: () => "POST" }),
    });
    await settle();

    const consoleLines = await lines(run.console);
    const networkLines = await lines(run.networkFailures);
    expect(consoleLines).toHaveLength(2);
    expect(networkLines).toHaveLength(2);
    expect(networkLines[1]).toMatchObject({ kind: "http-error", status: 403, url: "https://api.example.com/x" });

    const everything = JSON.stringify([consoleLines, networkLines]);
    for (const leak of ["topsecret-pass", "SECRETVALUE", "owner@example.com", "token=abc"]) {
      expect(everything).not.toContain(leak);
    }
  });
});
