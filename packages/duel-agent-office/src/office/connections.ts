import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Repositories the office may read. Two kinds: a folder on this machine (a Git checkout) and a GitHub repository by
 * `owner/name`. Reading only: nothing here can write, push, comment or open an issue. Writing to a third-party system
 * needs the human approval flow, which is not part of the MVP.
 */

export type SourceKind = "local" | "github";

export interface RepoSource {
  id: string;
  kind: SourceKind;
  label: string;
  /** `local`: absolute path of the checkout. */
  path?: string;
  /** `github`: `owner/name`. */
  repo?: string;
  /** `github`: branch, tag or commit to read. Empty means the default branch. */
  ref?: string;
}

export interface Connections {
  sources: RepoSource[];
  /** The source the test planner reads (the game's code). */
  gameSource?: string;
}

export const MAX_SOURCES = 8;
const ID = /^[a-z0-9-]{1,24}$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const REF = /^[A-Za-z0-9_./-]{1,100}$/;
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\/)/;

const label = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : fallback);

export function validateConnections(input: unknown): { ok: true; connections: Connections } | { ok: false; error: string } {
  const raw = (input && typeof input === "object" ? input : {}) as { sources?: unknown; gameSource?: unknown };
  if (!Array.isArray(raw.sources)) return { ok: false, error: "Not a list of sources" };
  if (raw.sources.length > MAX_SOURCES) return { ok: false, error: `At most ${MAX_SOURCES} sources` };
  const sources: RepoSource[] = [];
  const ids = new Set<string>();
  for (const item of raw.sources as unknown[]) {
    const s = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (typeof s.id !== "string" || !ID.test(s.id) || ids.has(s.id)) return { ok: false, error: "Every source needs its own id (a-z, 0-9, -)" };
    if (s.kind === "local") {
      const p = typeof s.path === "string" ? s.path.trim() : "";
      if (!ABSOLUTE.test(p) || p.length > 300 || p.includes("\0") || p.split(/[\\/]/).includes("..")) return { ok: false, error: "A local source needs an absolute folder path" };
      sources.push({ id: s.id, kind: "local", label: label(s.label, s.id), path: p });
    } else if (s.kind === "github") {
      const repo = typeof s.repo === "string" ? s.repo.trim() : "";
      if (!REPO.test(repo)) return { ok: false, error: "A GitHub source needs a repository like owner/name" };
      const ref = typeof s.ref === "string" ? s.ref.trim() : "";
      if (ref && (!REF.test(ref) || ref.includes(".."))) return { ok: false, error: "The branch or tag has characters that are not allowed" };
      sources.push({ id: s.id, kind: "github", label: label(s.label, repo), repo, ...(ref ? { ref } : {}) });
    } else return { ok: false, error: "Source kind must be local or github" };
    ids.add(s.id);
  }
  const game = raw.gameSource;
  if (game !== undefined && game !== "" && (typeof game !== "string" || !ids.has(game))) return { ok: false, error: "The game source must be one of the sources" };
  return { ok: true, connections: { sources, ...(typeof game === "string" && game ? { gameSource: game } : {}) } };
}

export interface ConnectionStore {
  get(): Promise<Connections>;
  save(input: unknown): Promise<{ status: number; body: { connections?: Connections; error?: string } }>;
}

/** Sources in a JSON file. `OFFICE_GAME_REPO` (a local path) seeds a first source when no file exists yet. */
export function fileConnectionStore(options: { file: string; readonly: boolean; seedLocalPath?: string }): ConnectionStore {
  return {
    async get() {
      try {
        const checked = validateConnections(JSON.parse(await readFile(options.file, "utf8")));
        if (checked.ok) return checked.connections;
      } catch {
        // missing or unreadable file: fall through to the seed
      }
      if (options.seedLocalPath) {
        const seeded = validateConnections({ sources: [{ id: "game", kind: "local", label: "Game (local)", path: options.seedLocalPath }], gameSource: "game" });
        if (seeded.ok) return seeded.connections;
      }
      return { sources: [] };
    },
    async save(input) {
      if (options.readonly) return { status: 403, body: { error: "The office is read-only" } };
      const checked = validateConnections(input);
      if (!checked.ok) return { status: 400, body: { error: checked.error } };
      await mkdir(path.dirname(options.file), { recursive: true });
      await writeFile(`${options.file}.tmp`, JSON.stringify(checked.connections, null, 2));
      await rename(`${options.file}.tmp`, options.file);
      return { status: 200, body: { connections: checked.connections } };
    },
  };
}
