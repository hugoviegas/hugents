import { describe, expect, it } from "vitest";
import { InMemoryStore, parseEvent } from "../src/index.js";

const ev = (seq: number, origin = "live") =>
  parseEvent({ v: 1, seq, at: "2026-10-07T10:00:00Z", origin, agent: "system", status: "idle", phase: "idle", label: "x" });

describe("InMemoryStore", () => {
  it("rejects demo events in live state", async () => {
    await expect(new InMemoryStore().appendEvent("s", ev(1, "demo"))).rejects.toThrow(/demo/);
  });

  it("requires increasing seq and lists after a cursor", async () => {
    const s = new InMemoryStore();
    await s.appendEvent("s", ev(1));
    await s.appendEvent("s", ev(2));
    await expect(s.appendEvent("s", ev(2))).rejects.toThrow(/seq/);
    expect((await s.listEvents("s", 1)).map((e) => e.seq)).toEqual([2]);
  });

  it("stores and filters tasks", async () => {
    const s = new InMemoryStore();
    await s.upsertTask({ id: "t1", kind: "explore-screens", status: "waiting", params: {}, updatedAt: "2026-10-07T10:00:00Z" });
    expect(await s.listTasks("pending")).toHaveLength(0);
    expect((await s.getTask("t1"))?.status).toBe("waiting");
  });
});
