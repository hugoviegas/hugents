import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, fileLayoutStore, validateLayout, type OfficeLayout } from "../src/office/layout.js";
import { startDashboard } from "../src/observer/dashboard.js";
import { config } from "./observerFixtures.js";

let dir: string;
let server: Server | undefined;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-layout-"));
});
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  await rm(dir, { recursive: true, force: true });
});

const withProps = (props: unknown[]) => ({ version: 1, props });
const desk = (over: Record<string, unknown> = {}) => ({ id: "desk-9", type: "desk", x: 3, y: 0, rot: 0, material: "wood", n: 9, ...over });

describe("office layout", () => {
  it("accepts the default layout", () => {
    expect(validateLayout(DEFAULT_LAYOUT)).toEqual({ ok: true, layout: DEFAULT_LAYOUT });
  });

  it("refuses props outside the room, overlapping props and duplicate desks or agents", () => {
    const base = DEFAULT_LAYOUT.props;
    const cases: [unknown, string][] = [
      [withProps([...base, desk({ x: 8 })]), "outside the room"],
      [withProps([...base, desk({ x: 1, y: 2 })]), "overlaps"],
      [withProps([...base, desk({ n: 1 })]), "own number"],
      [withProps([...base, desk({ agent: "explorer" })]), "only one desk"],
      [withProps([...base, desk({ agent: "someone-else" })]), "only one desk"],
      [withProps([...base, { id: "plant-9", type: "plant", x: 3, y: 0, rot: 0, material: "wood", agent: "explorer" }]), "Only desks"],
      [withProps([...base, { id: "lamp-1", type: "lamp", x: 3, y: 0, rot: 0, material: "wood" }]), "Unknown prop type"],
      [withProps([...base, desk({ rot: 45 })]), "Rotation"],
      [withProps([...base, desk({ material: "gold" })]), "Unknown material"],
      [withProps([...base, desk({ id: "desk-1" })]), "own id"],
      [withProps(Array.from({ length: 41 }, (_, i) => ({ id: `p-${i}`, type: "rug", x: 0, y: 0, rot: 0, material: "wood" }))), "at most"],
      [{ version: 2, props: [] }, "Not a layout"],
    ];
    for (const [input, error] of cases) {
      const result = validateLayout(input);
      expect(result.ok, error).toBe(false);
      if (!result.ok) expect(result.error.toLowerCase()).toContain(error.toLowerCase());
    }
  });

  it("lets rugs lie under other props and swaps the footprint when rotated", () => {
    const rugUnderDesk = withProps([{ id: "rug-1", type: "rug", x: 1, y: 2, rot: 0, material: "wood" }, desk({ x: 1, y: 2 })]);
    expect(validateLayout(rugUnderDesk).ok).toBe(true);
    // Rotated, a desk is 2 wide and 3 deep: x 8 fits (8..9), y 6 does not (6..8).
    expect(validateLayout(withProps([desk({ x: 8, y: 0, rot: 90 })])).ok).toBe(true);
    expect(validateLayout(withProps([desk({ x: 0, y: 6, rot: 90 })])).ok).toBe(false);
  });

  it("keeps only known fields, so nothing else can ride along in a saved layout", () => {
    const result = validateLayout(withProps([{ ...desk(), permissions: "admin", script: "x" }]));
    expect(result.ok && result.layout.props[0]).toEqual(desk());
  });

  it("falls back to the default layout when the file is missing or invalid, and refuses saves in read-only mode", async () => {
    const file = path.join(dir, "office", "layout.json");
    const store = fileLayoutStore({ file, readonly: false });
    expect(await store.get()).toEqual(DEFAULT_LAYOUT);
    const moved: OfficeLayout = { version: 1, props: DEFAULT_LAYOUT.props.map((p) => (p.id === "cabinet-1" ? { ...p, x: 9, y: 7 } : p)) };
    expect((await store.save(moved)).status).toBe(200);
    expect(await store.get()).toEqual(moved);
    await writeFile(file, "{ broken");
    expect(await store.get()).toEqual(DEFAULT_LAYOUT);
    expect((await fileLayoutStore({ file, readonly: true }).save(moved)).status).toBe(403);
  });
});

describe("dashboard layout endpoint", () => {
  function post(port: number, body: string, headers: Record<string, string>) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/api/layout", method: "POST", headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let text = "";
        res.on("data", (c: Buffer) => (text += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      });
      req.on("error", reject);
      req.end(body);
    });
  }

  it("saves a valid same-origin layout and serves it in the state", async () => {
    const file = path.join(dir, "office", "layout.json");
    const started = await startDashboard(config(dir), undefined, fileLayoutStore({ file, readonly: false }));
    server = started.server;
    const { port } = started;
    const json = { "content-type": "application/json", origin: `http://127.0.0.1:${port}` };
    const layout = { version: 1, props: [desk({ agent: "explorer" })] };

    expect((await post(port, JSON.stringify(layout), { ...json, origin: "http://evil.example.com" })).status).toBe(403);
    expect((await post(port, JSON.stringify({ version: 1, props: [desk({ x: 9 })] }), json)).status).toBe(400);
    expect((await post(port, JSON.stringify(layout), json)).status).toBe(200);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(layout);

    const state = await new Promise<string>((resolve) => {
      request({ host: "127.0.0.1", port, path: "/api/state", headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let text = "";
        res.on("data", (c: Buffer) => (text += c.toString()));
        res.on("end", () => resolve(text));
      }).end();
    });
    expect((JSON.parse(state) as { layout: unknown }).layout).toEqual(layout);
  });
});
