import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactRegistry, createDb, sha256 } from "../src/index.js";
import { PNG, deterministic, tempDir } from "./helpers.js";

const origin = { kind: "import", actorId: "hugo" } as const;

async function registry(opts: { root?: boolean; importRoots?: string[] } = {}) {
  const dir = await tempDir();
  const clock = { t: Date.parse("2026-10-07T10:00:00Z") };
  const reg = new ArtifactRegistry({
    db: createDb(path.join(dir, "db")),
    ...(opts.root !== false ? { root: path.join(dir, "store") } : {}),
    importRoots: opts.importRoots ?? [],
    now: () => new Date(clock.t),
    newId: deterministic().newId,
  });
  return { reg, dir, clock };
}

describe("artifact registry", () => {
  it("registers with id, hash, size, MIME, controlled path and origin", async () => {
    const { reg, dir } = await registry();
    const ref = await reg.register({ kind: "screenshot", mime: "image/png", data: PNG, origin });
    expect(ref).toEqual({ id: "art-0001", kind: "screenshot", sha256: sha256(PNG), size: PNG.length });
    const { record, read } = await reg.resolve(ref);
    expect(record.path).toBe("objects/art-0001");
    expect(record.origin).toEqual(origin);
    expect(record.retainUntil).toBe("2026-11-06T10:00:00.000Z");
    expect(await read()).toEqual(PNG);
    expect(await readFile(path.join(dir, "store", "objects", "art-0001"))).toEqual(PNG);
  });

  it("enforces kinds, MIME types, magic bytes and size limits", async () => {
    const { reg } = await registry();
    await expect(reg.register({ kind: "binary" as "log", mime: "text/plain", data: "x", origin })).rejects.toThrow("artifact-kind-not-allowed");
    await expect(reg.register({ kind: "screenshot", mime: "image/svg+xml", data: "<svg/>", origin })).rejects.toThrow("artifact-mime-not-allowed");
    await expect(reg.register({ kind: "screenshot", mime: "image/png", data: "not a png", origin })).rejects.toThrow("artifact-mime-not-allowed");
    await expect(reg.register({ kind: "run-evidence", mime: "application/json", data: "{oops", origin })).rejects.toThrow("artifact-mime-not-allowed");
    await expect(reg.register({ kind: "report", mime: "text/markdown", data: Buffer.from([0x41, 0x00]), origin })).rejects.toThrow("artifact-mime-not-allowed");
    await expect(reg.register({ kind: "report", mime: "text/markdown", data: "x".repeat(256 * 1024 + 1), origin })).rejects.toThrow("artifact-too-large");
    await expect(reg.register({ kind: "report", mime: "text/markdown", data: "", origin })).rejects.toThrow("artifact-too-large");
  });

  it("rejects forged metadata, unknown ids and tampered bytes", async () => {
    const { reg, dir } = await registry();
    const ref = await reg.register({ kind: "report", mime: "text/markdown", data: "# report", origin });
    await expect(reg.resolve({ ...ref, sha256: sha256("other") })).rejects.toThrow("artifact-tampered");
    await expect(reg.resolve({ ...ref, size: 1 })).rejects.toThrow("artifact-tampered");
    await expect(reg.resolve({ ...ref, kind: "screenshot" })).rejects.toThrow("artifact-tampered");
    await expect(reg.resolve({ ...ref, id: "art-9999" })).rejects.toThrow("artifact-unknown");
    await expect(reg.resolve({ ...ref, id: "../../db/artifacts" })).rejects.toThrow("artifact-unknown");
    await expect(reg.resolve("art-0001")).rejects.toThrow("artifact-unknown");
    await writeFile(path.join(dir, "store", "objects", ref.id), "# REPORT");
    await expect(reg.resolve(ref)).rejects.toThrow("artifact-tampered");
  });

  it("imports only regular files inside an import root", async () => {
    const outside = await tempDir();
    const root = path.join(outside, "office-artifacts");
    await mkdir(path.join(root, "reports"), { recursive: true });
    await writeFile(path.join(root, "reports", "critic.md"), "# critic");
    await writeFile(path.join(outside, ".env"), "QA_ACCOUNT_A=secret");
    const { reg } = await registry({ importRoots: [root] });
    const ok = await reg.importFile(path.join(root, "reports", "critic.md"), { kind: "report", mime: "text/markdown", origin });
    expect(ok.size).toBe(8);
    await expect(reg.importFile(path.join(root, "..", ".env"), { kind: "report", mime: "text/markdown", origin })).rejects.toThrow("unsafe-path");
    await expect(reg.importFile(path.join(root, "reports", "..", "..", ".env"), { kind: "report", mime: "text/markdown", origin })).rejects.toThrow("unsafe-path");
    await expect(reg.importFile(path.join(root, "missing.md"), { kind: "report", mime: "text/markdown", origin })).rejects.toThrow("unsafe-path");
    await expect(reg.importFile(root, { kind: "report", mime: "text/markdown", origin })).rejects.toThrow("unsafe-path");
    try {
      await symlink(path.join(outside, ".env"), path.join(root, "link.md"));
    } catch {
      return; // no symlink rights on this machine
    }
    await expect(reg.importFile(path.join(root, "link.md"), { kind: "report", mime: "text/markdown", origin })).rejects.toThrow("unsafe-path");
  });

  it("retention: expired artifacts lose their bytes and resolve as expired; kept ones stay", async () => {
    const { reg, clock, dir } = await registry();
    const log = await reg.register({ kind: "log", mime: "text/plain", data: "line", origin });
    const shot = await reg.register({ kind: "screenshot", mime: "image/png", data: PNG, origin });
    const report = await reg.register({ kind: "report", mime: "text/markdown", data: "# r", origin });
    clock.t += 15 * 86_400_000;
    expect(await reg.sweep()).toEqual([log.id]);
    await expect(reg.resolve(log)).rejects.toThrow("artifact-expired");
    await expect(readFile(path.join(dir, "store", "objects", log.id))).rejects.toThrow();
    clock.t += 30 * 86_400_000;
    expect(await reg.sweep(new Set([shot.id]))).toEqual([]);
    expect((await reg.resolve(shot)).record.state).toBe("active");
    expect((await reg.resolve(report)).record.retainUntil).toBeUndefined();
  });

  it("works in memory without a root", async () => {
    const { reg } = await registry({ root: false });
    const ref = await reg.register({ kind: "report", mime: "text/markdown", data: "# r", origin });
    expect((await (await reg.resolve(ref)).read()).toString()).toBe("# r");
  });
});
