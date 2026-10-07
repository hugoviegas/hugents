import { describe, expect, it } from "vitest";
import { EventValidationError, STATUSES, parseEvent } from "../src/index.js";

const base = {
  v: 1,
  seq: 1,
  at: "2026-10-07T10:00:00Z",
  origin: "live",
  agent: "player-alpha",
  status: "waiting",
  phase: "queued",
  label: "waiting for runner lock",
};

describe("event contract", () => {
  it("keeps waiting distinct from working", () => {
    expect(STATUSES).toContain("waiting");
    expect(parseEvent(base).status).toBe("waiting");
  });

  it("rejects bad enums, versions and non-opaque ids", () => {
    expect(() => parseEvent({ ...base, status: "dancing" })).toThrow(EventValidationError);
    expect(() => parseEvent({ ...base, v: 2 })).toThrow(EventValidationError);
    expect(() => parseEvent({ ...base, artifactRef: "/home/user/shot.png" })).toThrow(EventValidationError);
    expect(() => parseEvent({ ...base, tool: "rm -rf" })).toThrow(EventValidationError);
  });

  it("drops unknown keys", () => {
    const parsed = parseEvent({ ...base, __proto__: { x: 1 }, extra: "secret" }) as unknown as Record<string, unknown>;
    expect(parsed.extra).toBeUndefined();
  });
});
