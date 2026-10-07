import { describe, expect, it } from "vitest";
import { MANUAL_HINT, pickPreviewUrl, syncPreview, updateEnvValue, type SyncDeps } from "../src/preview/syncPreview.js";

const NEW = "big-bang-duel-newhash-team.vercel.app";
const OLD = "big-bang-duel-oldhash-team.vercel.app";
const list = (items: unknown[]) => JSON.stringify({ deployments: items });

describe("pickPreviewUrl", () => {
  it("picks the newest READY Preview deployment and keeps only the origin", () => {
    const text = list([
      { url: OLD, createdAt: 1, readyState: "READY", target: null },
      { url: NEW, createdAt: 2, readyState: "READY", target: null },
    ]);
    expect(pickPreviewUrl(text)).toBe(`https://${NEW}`);
  });

  it("accepts a top-level array", () => {
    expect(pickPreviewUrl(JSON.stringify([{ url: NEW, createdAt: 5, state: "READY" }]))).toBe(`https://${NEW}`);
  });

  it("skips production, not-ready and non-vercel entries", () => {
    const text = list([
      { url: "x-prod.vercel.app", createdAt: 9, readyState: "READY", target: "production" },
      { url: "y.vercel.app", createdAt: 8, readyState: "ERROR" },
      { url: "duel.hugoviegas.dev", createdAt: 7, readyState: "READY" },
      { url: "example.com", createdAt: 6, readyState: "READY" },
    ]);
    expect(pickPreviewUrl(text)).toBeNull();
  });

  it("returns null for empty, unparsable or ambiguous output", () => {
    expect(pickPreviewUrl("")).toBeNull();
    expect(pickPreviewUrl("not json")).toBeNull();
    expect(pickPreviewUrl(list([]))).toBeNull();
    const tie = list([
      { url: OLD, createdAt: 3, readyState: "READY" },
      { url: NEW, createdAt: 3, readyState: "READY" },
    ]);
    expect(pickPreviewUrl(tie)).toBeNull();
  });
});

describe("updateEnvValue", () => {
  it("replaces only GAME_BASE_URL and leaves every other line untouched", () => {
    const before = "GAME_BASE_URL=old\nQA_ALPHA_EMAIL=a@b.c\n# note\nQA_HEADLESS=false\n";
    const after = updateEnvValue(before, "GAME_BASE_URL", "new");
    expect(after).toBe("GAME_BASE_URL=new\nQA_ALPHA_EMAIL=a@b.c\n# note\nQA_HEADLESS=false\n");
  });

  it("appends when absent, keeps CRLF files CRLF, and creates content from nothing", () => {
    expect(updateEnvValue("A=1\n", "GAME_BASE_URL", "n")).toBe("A=1\nGAME_BASE_URL=n\n");
    expect(updateEnvValue("A=1\r\nGAME_BASE_URL=o\r\n", "GAME_BASE_URL", "n")).toBe("A=1\r\nGAME_BASE_URL=n\r\n");
    expect(updateEnvValue("", "GAME_BASE_URL", "n")).toBe("GAME_BASE_URL=n\n");
  });

  it("does not confuse keys that merely start with the same text", () => {
    expect(updateEnvValue("GAME_BASE_URL_EXTRA=1\n", "GAME_BASE_URL", "n")).toBe("GAME_BASE_URL_EXTRA=1\nGAME_BASE_URL=n\n");
  });
});

describe("syncPreview", () => {
  function deps(over: Partial<SyncDeps> = {}) {
    const state = { written: null as string | null, listed: 0 };
    const d: SyncDeps = {
      listPreviews: async () => {
        state.listed += 1;
        return list([{ url: NEW, createdAt: 2, readyState: "READY" }]);
      },
      readEnv: async () => "QA_ALPHA_EMAIL=a@b.c\nGAME_BASE_URL=\n",
      writeEnv: async (content) => {
        state.written = content;
      },
      envIsIgnored: async () => true,
      ...over,
    };
    return { d, state };
  }

  it("writes only GAME_BASE_URL and never returns or exposes the URL", async () => {
    const { d, state } = deps();
    const result = await syncPreview(d);
    expect(result).toEqual({ ok: true });
    expect(state.written).toBe(`QA_ALPHA_EMAIL=a@b.c\nGAME_BASE_URL=https://${NEW}\n`);
    expect(JSON.stringify(result)).not.toContain(NEW);
  });

  it("refuses to touch an .env that Git does not ignore, before calling Vercel", async () => {
    const { d, state } = deps({ envIsIgnored: async () => false });
    const result = await syncPreview(d);
    expect(result.ok).toBe(false);
    expect(state.listed).toBe(0);
    expect(state.written).toBeNull();
  });

  it.each([
    ["the CLI fails", async () => { throw new Error(`boom ${NEW}`); }],
    ["nothing usable is found", async () => list([])],
    ["the output is not JSON", async () => "garbage"],
  ])("fails with the manual instruction when %s, without echoing a URL", async (_label, listPreviews) => {
    const { d, state } = deps({ listPreviews });
    const result = await syncPreview(d);
    expect(result).toEqual({ ok: false, message: MANUAL_HINT });
    expect(state.written).toBeNull();
    expect(MANUAL_HINT).toContain("GAME_BASE_URL");
    expect(MANUAL_HINT).not.toMatch(/https?:/);
  });

  it("creates .env content when the file does not exist yet", async () => {
    const { d, state } = deps({ readEnv: async () => null });
    expect(await syncPreview(d)).toEqual({ ok: true });
    expect(state.written).toBe(`GAME_BASE_URL=https://${NEW}\n`);
  });
});
