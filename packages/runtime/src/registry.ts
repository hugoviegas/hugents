import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_LIMITS, parseAgentPackage, type AgentDefinition, type AgentPackage } from "./agent.js";
import { actorRef, type Actor, type ActorRef, type AgentBoardPolicy } from "./boards.js";
import { RuntimeError } from "./errors.js";
import type { Db } from "./persist.js";
import type { ToolRegistry } from "./tools.js";
import { isObject } from "./util.js";

export interface StoredAgent {
  id: string;
  version: string;
  contentHash: string;
  files: Record<string, string>;
  registeredAt: string;
  registeredBy: ActorRef;
}

const key = (id: string, version: string) => `${id}@${version}`;
const semver = (v: string) => v.split(".").map(Number) as [number, number, number];
export function compareVersions(a: string, b: string): number {
  const [x, y] = [semver(a), semver(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/**
 * Registered agents are immutable versions. Registering the same id and version again with identical content is a
 * no-op; with different content it is `version-conflict`, so an edited prompt or config must carry a new version and
 * historical tasks keep pointing at the exact content they ran with. Registering needs a human with `config:mutate`.
 */
export class AgentRegistry {
  private readonly parsed = new Map<string, AgentDefinition>();

  constructor(private readonly o: { db: Db; tools: ToolRegistry; now: () => Date }) {}

  async register(pkg: AgentPackage, actor: Actor): Promise<{ agent: AgentDefinition; created: boolean }> {
    if (actor.kind !== "human" || actor.role !== "admin") throw new RuntimeError("not-human", "actor");
    if (!actor.capabilities.includes("config:mutate")) throw new RuntimeError("capability-denied", "actor");
    const result = parseAgentPackage(pkg, this.o.tools);
    if (!result.ok) throw RuntimeError.fromIssues(result.issues);
    const { agent } = result;
    const { id, version } = agent.manifest;
    const created = await this.o.db.mutate<StoredAgent, boolean>("agents", (all) => {
      const existing = all[key(id, version)];
      if (existing) {
        if (existing.contentHash !== agent.contentHash) throw new RuntimeError("version-conflict", "$.version");
        return false;
      }
      const newer = Object.values(all).some((a) => a.id === id && compareVersions(a.version, version) > 0);
      if (newer) throw new RuntimeError("stale-version", "$.version");
      all[key(id, version)] = {
        id,
        version,
        contentHash: agent.contentHash,
        files: agent.files,
        registeredAt: this.o.now().toISOString(),
        registeredBy: actorRef(actor),
      };
      return true;
    });
    return { agent: (await this.get(id, version))!, created };
  }

  /** Re-validates stored content on load, so a hand-edited `agents.json` is caught (`agent-tampered`). */
  async get(id: string, version: string): Promise<AgentDefinition | undefined> {
    const stored = (await this.o.db.read<StoredAgent>("agents"))[key(id, version)];
    if (!stored) return undefined;
    const cached = this.parsed.get(key(id, version));
    if (cached && cached.contentHash === stored.contentHash) return cached;
    const result = parseAgentPackage({ files: stored.files }, this.o.tools);
    if (!result.ok || result.agent.contentHash !== stored.contentHash) throw new RuntimeError("agent-tampered", key(id, version));
    this.parsed.set(key(id, version), result.agent);
    return result.agent;
  }

  async versions(id: string): Promise<string[]> {
    return Object.values(await this.o.db.read<StoredAgent>("agents"))
      .filter((a) => a.id === id)
      .map((a) => a.version)
      .sort(compareVersions);
  }

  async latest(id: string): Promise<AgentDefinition | undefined> {
    const v = (await this.versions(id)).at(-1);
    return v ? this.get(id, v) : undefined;
  }

  async list(): Promise<{ id: string; versions: string[] }[]> {
    const ids = [...new Set(Object.values(await this.o.db.read<StoredAgent>("agents")).map((a) => a.id))].sort();
    return Promise.all(ids.map(async (id) => ({ id, versions: await this.versions(id) })));
  }

  async stored(id: string, version: string): Promise<StoredAgent | undefined> {
    return (await this.o.db.read<StoredAgent>("agents"))[key(id, version)];
  }

  /** Board permissions of one exact version, for the board service. */
  async policyOf(id: string, version: string): Promise<AgentBoardPolicy | undefined> {
    const agent = await this.get(id, version).catch(() => undefined);
    return agent && { capabilities: agent.manifest.capabilities, produces: agent.manifest.boards.produces, transitions: agent.manifest.boards.transitions };
  }
}

// ---- import / export ----------------------------------------------------------------------------------------------

export const BUNDLE_FORMAT = "hugents-agent-bundle";
const MAX_BUNDLE_BYTES = 512 * 1024;

/**
 * Reads an agent directory. Symlinks, nested folders deeper than two levels and oversized files are refused before
 * anything is read, so a package cannot pull in files from outside its folder. Validation happens in `register`.
 */
export async function readAgentDir(dir: string): Promise<AgentPackage> {
  const files: Record<string, string> = {};
  let total = 0;
  async function walk(rel: string, depth: number): Promise<void> {
    for (const entry of await readdir(path.join(dir, rel))) {
      const relPath = rel ? `${rel}/${entry}` : entry;
      const full = path.join(dir, relPath);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) throw new RuntimeError("unsafe-path", relPath);
      if (stat.isDirectory()) {
        if (depth >= 2) throw new RuntimeError("unsafe-path", relPath);
        await walk(relPath, depth + 1);
      } else if (stat.isFile()) {
        total += stat.size;
        if (Object.keys(files).length >= AGENT_LIMITS.maxFiles) throw new RuntimeError("too-many-items", "files");
        if (total > AGENT_LIMITS.maxPackageBytes) throw new RuntimeError("too-large", "files");
        files[relPath] = await readFile(full, "utf8");
      } else {
        throw new RuntimeError("unsafe-path", relPath);
      }
    }
  }
  await walk("", 0);
  return { files };
}

/** A single-file package: `{ "format": "hugents-agent-bundle", "formatVersion": 1, "files": { ... } }`. */
export function parseBundle(text: string): AgentPackage {
  if (Buffer.byteLength(text, "utf8") > MAX_BUNDLE_BYTES) throw new RuntimeError("too-large", "bundle");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RuntimeError("invalid-json", "bundle");
  }
  if (!isObject(raw) || raw.format !== BUNDLE_FORMAT || raw.formatVersion !== 1 || !isObject(raw.files) || Object.keys(raw).length !== 3) {
    throw new RuntimeError("invalid-bundle", "bundle");
  }
  return { files: raw.files as Record<string, string> };
}

export async function loadAgentPackage(source: string): Promise<AgentPackage> {
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) throw new RuntimeError("unsafe-path", "source");
  if (stat.isDirectory()) return readAgentDir(source);
  if (stat.size > MAX_BUNDLE_BYTES) throw new RuntimeError("too-large", "bundle");
  return parseBundle(await readFile(source, "utf8"));
}

export function toBundle(agent: Pick<AgentDefinition, "files">): string {
  return `${JSON.stringify({ format: BUNDLE_FORMAT, formatVersion: 1, files: agent.files }, null, 2)}\n`;
}

/** Writes a registered package back out as a directory. Refuses a non-empty target. Paths were validated on register. */
export async function writeAgentDir(agent: Pick<AgentDefinition, "files">, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  if ((await readdir(outDir)).length) throw new RuntimeError("unsafe-path", "outDir");
  for (const [rel, text] of Object.entries(agent.files)) {
    const file = path.resolve(outDir, rel);
    if (!file.startsWith(path.resolve(outDir) + path.sep)) throw new RuntimeError("unsafe-path", rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
}
