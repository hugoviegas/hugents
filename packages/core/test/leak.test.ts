import { describe, expect, it } from "vitest";
import { InMemoryStore, createProviderChain, createSanitizer, type AiProvider } from "../src/index.js";

// Fake sensitive values planted on purpose.
const PLANTED = [
  "qa.player@example.com",
  "https://preview.example.test/room/ABCD",
  "AIzaSyFAKEFAKEFAKEFAKEFAKEFAKE12345",
  "ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKE1234",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.c2lnbmF0dXJl",
  "Bearer abcdef1234567890",
  "ROOM-7K2Q9",
];
const text = `user ${PLANTED.join(" and ")} password=hunter2`;

const sanitizer = createSanitizer([{ name: "room-code", pattern: /\bROOM-[A-Z0-9]{5}\b/g }]);

function expectClean(out: string) {
  for (const secret of [...PLANTED, "hunter2"]) expect(out).not.toContain(secret);
}

describe("leak tests", () => {
  it("sanitizes labels", () => {
    const event = sanitizer.sanitizeEvent({
      v: 1, seq: 1, at: "2026-10-07T10:00:00Z", origin: "live", agent: "explorer",
      status: "working", phase: "navigate", label: text,
    });
    expectClean(event.label);
  });

  it("keeps sanitized events clean through the store", async () => {
    const store = new InMemoryStore();
    const event = sanitizer.sanitizeEvent({
      v: 1, seq: 1, at: "2026-10-07T10:00:00Z", origin: "live", agent: "explorer",
      status: "working", phase: "navigate", label: text,
    });
    await store.appendEvent("s", event);
    expectClean(JSON.stringify(await store.listEvents("s")));
  });

  it("sanitizes provider output and falls back on failure", async () => {
    const leaky: AiProvider = {
      name: "leaky",
      generateReport: async () => ({ provider: "leaky", summary: text, highlights: [text] }),
    };
    const broken: AiProvider = { name: "broken", generateReport: async () => { throw new Error("429"); } };
    const input = { runId: "r1", totals: { findings: 1, errors: 1, warnings: 0 }, findings: [{ id: "f1", severity: "error" as const, title: "x" }] };

    expectClean(JSON.stringify(await createProviderChain([leaky], sanitizer).generateReport(input)));
    const fallback = await createProviderChain([broken], sanitizer).generateReport(input);
    expect(fallback.provider).toBe("deterministic");
  });
});
