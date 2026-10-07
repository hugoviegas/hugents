import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { RuntimeError } from "./errors.js";
import type { Db } from "./persist.js";
import { OPAQUE_ID, SHA256_HEX, defaultNewId, isObject, sha256, snapshot } from "./util.js";

/**
 * Reports, screenshots, logs and generated files are artifacts: bytes in a controlled folder plus a record with an
 * opaque id, kind, SHA-256, size, MIME type, origin and retention. Everything else (tasks, board items, events) holds an
 * `ArtifactRef` only, never contents or a caller-supplied path.
 */
export const ARTIFACT_KINDS = ["report", "screenshot", "log", "generated-spec", "run-evidence", "issue-draft"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

interface KindRule {
  mimes: readonly string[];
  maxBytes: number;
  /** Days kept after registration; undefined keeps it until removed by hand. */
  retentionDays?: number;
}

export const ARTIFACT_RULES: Record<ArtifactKind, KindRule> = {
  report: { mimes: ["text/markdown"], maxBytes: 256 * 1024 },
  screenshot: { mimes: ["image/png", "image/jpeg", "image/webp"], maxBytes: 5 * 1024 * 1024, retentionDays: 30 },
  log: { mimes: ["application/json", "text/plain"], maxBytes: 1024 * 1024, retentionDays: 14 },
  "generated-spec": { mimes: ["text/typescript"], maxBytes: 64 * 1024 },
  "run-evidence": { mimes: ["application/json"], maxBytes: 256 * 1024 },
  "issue-draft": { mimes: ["text/markdown"], maxBytes: 64 * 1024 },
};

export type ArtifactOrigin =
  | { kind: "import"; actorId: string }
  | { kind: "agent"; agentId: string; agentVersion: string; taskId: string }
  | { kind: "system"; stage: string };

export interface ArtifactRecord {
  id: string;
  kind: ArtifactKind;
  sha256: string;
  size: number;
  mime: string;
  /** Relative to the artifact root, always `objects/<id>`. Never a caller-supplied path. */
  path: string;
  origin: ArtifactOrigin;
  createdAt: string;
  retainUntil?: string;
  state: "active" | "expired";
}

/** What tasks, results and board items hold. Checked against the record and the bytes on every use. */
export interface ArtifactRef {
  id: string;
  kind: ArtifactKind;
  sha256: string;
  size: number;
}

export interface NewArtifact {
  kind: ArtifactKind;
  mime: string;
  data: Uint8Array | string;
  origin: ArtifactOrigin;
}

const toRef = (r: ArtifactRecord): ArtifactRef => ({ id: r.id, kind: r.kind, sha256: r.sha256, size: r.size });

/** Magic numbers, so a forged MIME type cannot smuggle other bytes in as an image. */
function contentMatches(mime: string, bytes: Buffer): boolean {
  if (mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/webp") return bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
  // text kinds: valid UTF-8, no NUL bytes
  const text = bytes.toString("utf8");
  return !text.includes("\u0000") && !text.includes("�") && (mime !== "application/json" || isJson(text));
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** True when `child` is `parent` or inside it, after both are resolved. */
const isInside = (parent: string, child: string) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

export interface ArtifactRegistryOptions {
  db: Db;
  /** Controlled folder. Bytes live in `<root>/objects/<id>`. Without it, bytes are kept in memory (tests). */
  root?: string;
  /** Folders `importFile` may read from (e.g. the office `artifacts/` folder). Nothing else is ever read. */
  importRoots?: readonly string[];
  now: () => Date;
  newId?: (prefix: string) => string;
}

export class ArtifactRegistry {
  private readonly memory = new Map<string, Buffer>();
  private readonly newId: (prefix: string) => string;

  constructor(private readonly options: ArtifactRegistryOptions) {
    this.newId = options.newId ?? defaultNewId;
  }

  async register(input: NewArtifact): Promise<ArtifactRef> {
    if (!(ARTIFACT_KINDS as readonly string[]).includes(input.kind)) throw new RuntimeError("artifact-kind-not-allowed", "kind");
    const rule = ARTIFACT_RULES[input.kind];
    if (!rule.mimes.includes(input.mime)) throw new RuntimeError("artifact-mime-not-allowed", "mime");
    const bytes = Buffer.from(input.data);
    if (bytes.length === 0 || bytes.length > rule.maxBytes) throw new RuntimeError("artifact-too-large", "data");
    if (!contentMatches(input.mime, bytes)) throw new RuntimeError("artifact-mime-not-allowed", "data");

    const id = this.newId("art");
    if (!OPAQUE_ID.test(id)) throw new RuntimeError("invalid-value", "id");
    const now = this.options.now();
    const record: ArtifactRecord = {
      id,
      kind: input.kind,
      sha256: sha256(bytes),
      size: bytes.length,
      mime: input.mime,
      path: `objects/${id}`,
      origin: input.origin,
      createdAt: now.toISOString(),
      state: "active",
      ...(rule.retentionDays ? { retainUntil: new Date(now.getTime() + rule.retentionDays * 86_400_000).toISOString() } : {}),
    };
    await this.writeBytes(id, bytes);
    await this.options.db.mutate<ArtifactRecord, void>("artifacts", (all) => {
      if (all[id]) throw new RuntimeError("duplicate", "id");
      all[id] = record;
    });
    return toRef(record);
  }

  /**
   * Registers a file from one of the import roots. Symlinks and anything resolving outside the roots are refused, so a
   * report cannot point the registry at `../../.env`.
   */
  async importFile(file: string, meta: Omit<NewArtifact, "data">): Promise<ArtifactRef> {
    const roots = await Promise.all((this.options.importRoots ?? []).map((r) => realpath(r).catch(() => undefined)));
    let real: string;
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new Error("symlink");
      real = await realpath(file);
    } catch {
      throw new RuntimeError("unsafe-path", "file");
    }
    if (!roots.some((r) => r && isInside(r, real))) throw new RuntimeError("unsafe-path", "file");
    const stat = await lstat(real);
    if (!stat.isFile()) throw new RuntimeError("unsafe-path", "file");
    if (stat.size > ARTIFACT_RULES[meta.kind]?.maxBytes) throw new RuntimeError("artifact-too-large", "file");
    return this.register({ ...meta, data: await readFile(real) });
  }

  /**
   * The only way to use an artifact. Fails on unknown ids, expired records, a ref whose metadata does not match the
   * record (forged), or bytes whose hash no longer matches (tampered on disk).
   */
  async resolve(ref: unknown): Promise<{ record: ArtifactRecord; read: () => Promise<Buffer> }> {
    if (!isObject(ref) || typeof ref.id !== "string" || !OPAQUE_ID.test(ref.id)) throw new RuntimeError("artifact-unknown", "id");
    const record = (await this.options.db.read<ArtifactRecord>("artifacts"))[ref.id];
    if (!record) throw new RuntimeError("artifact-unknown", "id");
    if (record.state !== "active") throw new RuntimeError("artifact-expired", "id");
    if (ref.kind !== record.kind || ref.sha256 !== record.sha256 || ref.size !== record.size || !SHA256_HEX.test(String(ref.sha256))) {
      throw new RuntimeError("artifact-tampered", "ref");
    }
    const bytes = await this.readBytes(record.id).catch(() => undefined);
    if (!bytes || bytes.length !== record.size || sha256(bytes) !== record.sha256) throw new RuntimeError("artifact-tampered", "bytes");
    return {
      record: snapshot(record),
      read: async () => {
        const again = await this.readBytes(record.id);
        if (sha256(again) !== record.sha256) throw new RuntimeError("artifact-tampered", "bytes");
        return again;
      },
    };
  }

  async ref(id: string): Promise<ArtifactRef> {
    const r = (await this.options.db.read<ArtifactRecord>("artifacts"))[id];
    if (!r) throw new RuntimeError("artifact-unknown", "id");
    return toRef(r);
  }

  async list(): Promise<ArtifactRecord[]> {
    return Object.values(await this.options.db.read<ArtifactRecord>("artifacts"));
  }

  /**
   * Retention: removes the bytes of records past `retainUntil` and keeps a tombstone, so old refs fail with
   * `artifact-expired` instead of resolving to something else. `keep` holds ids still referenced by open work.
   */
  async sweep(keep: ReadonlySet<string> = new Set()): Promise<string[]> {
    const now = this.options.now().toISOString();
    const expired = await this.options.db.mutate<ArtifactRecord, string[]>("artifacts", (all) => {
      const ids: string[] = [];
      for (const r of Object.values(all)) {
        if (r.state === "active" && r.retainUntil && r.retainUntil < now && !keep.has(r.id)) {
          r.state = "expired";
          ids.push(r.id);
        }
      }
      return ids;
    });
    for (const id of expired) await this.deleteBytes(id);
    return expired;
  }

  private objectPath(id: string): string {
    if (!OPAQUE_ID.test(id) || !this.options.root) throw new RuntimeError("unsafe-path", "id");
    const objects = path.resolve(this.options.root, "objects");
    const file = path.resolve(objects, id);
    if (path.dirname(file) !== objects) throw new RuntimeError("unsafe-path", "id");
    return file;
  }

  private async writeBytes(id: string, bytes: Buffer): Promise<void> {
    if (!this.options.root) return void this.memory.set(id, Buffer.from(bytes));
    const file = this.objectPath(id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, bytes);
    await rename(`${file}.tmp`, file);
  }

  private async readBytes(id: string): Promise<Buffer> {
    if (!this.options.root) {
      const b = this.memory.get(id);
      if (!b) throw new RuntimeError("artifact-unknown", "id");
      return Buffer.from(b);
    }
    return readFile(this.objectPath(id));
  }

  private async deleteBytes(id: string): Promise<void> {
    if (!this.options.root) return void this.memory.delete(id);
    await rm(this.objectPath(id), { force: true });
  }
}
