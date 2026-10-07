import { describe, expect, it } from "vitest";
import { createFrameGate } from "../src/gate.js";
import { manifest } from "./helpers.js";

describe("frame gate", () => {
  it("blocks every screen listed as hidden", async () => {
    for (const s of manifest.screens.filter((x) => x.hidden)) {
      const gate = createFrameGate(manifest, async () => s.id);
      expect(await gate.decide()).toEqual({ state: "hidden", reason: "hidden-screen" });
    }
  });
  it("releases a visible screen", async () => {
    expect(await createFrameGate(manifest, async () => "home").decide()).toEqual({ state: "visible" });
  });
  it("fails closed when the screen is unknown, unlisted or the resolver throws", async () => {
    expect(await createFrameGate(manifest, async () => undefined).decide()).toEqual({ state: "hidden", reason: "unknown-screen" });
    expect(await createFrameGate(manifest, async () => "not-in-manifest").decide()).toEqual({ state: "hidden", reason: "unknown-screen" });
    const boom = createFrameGate(manifest, async () => {
      throw new Error("x");
    });
    expect(await boom.decide()).toEqual({ state: "hidden", reason: "gate-error" });
  });
  it("blacks out during a login step and releases afterwards", async () => {
    const gate = createFrameGate(manifest, async () => "home");
    gate.setPrivateStep(true);
    expect(await gate.decide()).toEqual({ state: "hidden", reason: "private-step" });
    gate.setPrivateStep(false);
    expect(await gate.decide()).toEqual({ state: "visible" });
  });
  it("hides when a private step starts while the screen is being read", async () => {
    let gate!: ReturnType<typeof createFrameGate>;
    gate = createFrameGate(manifest, async () => {
      gate.setPrivateStep(true);
      return "home";
    });
    expect(await gate.decide()).toEqual({ state: "hidden", reason: "private-step" });
  });
});
