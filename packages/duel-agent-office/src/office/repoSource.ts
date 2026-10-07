import { execFile } from "node:child_process";
import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { redact } from "../redact.js";
import type { RepoSource } from "./connections.js";

/**
 * Read-only access to a repository, local or on GitHub. The only operations are: summary, list files, read one text file.
 * Local reads run fixed `git` commands and plain file reads inside the checkout; GitHub reads are GET requests to
 * api.github.com. A token (`GITHUB_TOKEN` in the process environment, never from the page) only raises the rate limit and
 * opens private repositories; it is never returned, logged or written.
 */

export interface RepoSummary {
  kind: RepoSource["kind"];
  label: string;
  branch?: string;
  description?: string;
  /** Local: files with uncommitted changes. */
  changedFiles?: number;
  commits: { sha: string; subject: string; at?: string }[];
  pulls?: { number: number; title: string; author?: string; url?: string }[];
  issues?: { number: number; title: string; url?: string }[];
}

export interface RepoReader {
  summary(): Promise<RepoSummary>;
  /** Tracked or listed files, relative with `/`. Secret-looking files are never listed. */
  listFiles(): Promise<string[]>;
  /** Text of one file, or `undefined` for a missing, binary, oversized or secret-looking file. */
  readFile(rel: string): Promise<string | undefined>;
}

export class RepoError extends Error {}

export const MAX_FILE_BYTES = 200_000;
const MAX_LIST = 5_000;
const TIMEOUT_MS = 10_000;

/** Never listed, never read: environment files, keys, credentials, Git internals, installed packages. */
const SECRET_PATH =
  /(?:^|\/)(?:\.env(?:\..*)?|\.git|node_modules|\.npmrc|\.netrc|id_(?:rsa|ed25519|ecdsa)[^/]*|[^/]*\.(?:pem|key|p12|pfx|jks|keystore)|[^/]*service-?account[^/]*\.json|[^/]*credentials?[^/]*\.json|\.firebaserc)$|(?:^|\/)(?:\.git|node_modules|secrets?)\//i;
export const isSecretPath = (rel: string) => SECRET_PATH.test(rel.replace(/\\/g, "/")) && !/(?:^|\/)\.env\.example$/i.test(rel);

const git = (cwd: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(
      "git",
      ["-c", "core.fsmonitor=false", "-c", "core.pager=cat", ...args],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 8_000_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } },
      (error, stdout) => (error ? reject(new RepoError("git could not read this folder")) : resolve(String(stdout))),
    ),
  );

function localReader(source: RepoSource): RepoReader {
  const root = source.path ?? "";
  const safeRoot = async () => {
    const real = await realpath(root).catch(() => undefined);
    if (!real || !(await stat(real)).isDirectory()) throw new RepoError("The folder does not exist on this machine");
    return real;
  };
  return {
    async summary() {
      const cwd = await safeRoot();
      const [branch, log, status] = await Promise.all([
        git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ""),
        git(cwd, ["log", "-n", "8", "--format=%h%x1f%s%x1f%cI"]).catch(() => ""),
        git(cwd, ["status", "--porcelain"]).catch(() => ""),
      ]);
      return {
        kind: "local",
        label: source.label,
        ...(branch.trim() ? { branch: branch.trim() } : {}),
        changedFiles: status.split("\n").filter(Boolean).length,
        commits: log
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const [sha, subject, at] = l.split("\x1f");
            return { sha: sha ?? "", subject: redact((subject ?? "").slice(0, 120), []), ...(at ? { at } : {}) };
          }),
      };
    },
    async listFiles() {
      const cwd = await safeRoot();
      let names: string[];
      try {
        names = (await git(cwd, ["ls-files", "-z"])).split("\0").filter(Boolean);
      } catch {
        // Not a Git checkout: a shallow walk of the folder instead.
        names = [];
        const walk = async (dir: string, depth: number): Promise<void> => {
          if (depth > 6 || names.length >= MAX_LIST) return;
          for (const e of await readdir(path.join(cwd, dir), { withFileTypes: true }).catch(() => [])) {
            const rel = dir ? `${dir}/${e.name}` : e.name;
            if (isSecretPath(rel)) continue;
            if (e.isDirectory()) await walk(rel, depth + 1);
            else if (e.isFile()) names.push(rel);
          }
        };
        await walk("", 0);
      }
      return names.filter((n) => !isSecretPath(n)).slice(0, MAX_LIST);
    },
    async readFile(rel) {
      if (!rel || isSecretPath(rel) || rel.includes("\0") || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) return undefined;
      const cwd = await safeRoot();
      const full = await realpath(path.join(cwd, rel)).catch(() => undefined);
      // The real path (after symlinks) must stay inside the checkout.
      if (!full || (full !== cwd && !full.startsWith(cwd + path.sep)) || isSecretPath(path.relative(cwd, full))) return undefined;
      const info = await stat(full).catch(() => undefined);
      if (!info?.isFile() || info.size > MAX_FILE_BYTES) return undefined;
      const handle = await open(full, "r");
      try {
        const buf = Buffer.alloc(info.size);
        await handle.read(buf, 0, info.size, 0);
        return buf.includes(0) ? undefined : buf.toString("utf8");
      } finally {
        await handle.close();
      }
    },
  };
}

export interface GithubOptions {
  /** `GITHUB_TOKEN` from the process environment. Optional. */
  token?: string;
  fetchImpl?: typeof fetch;
}

function githubReader(source: RepoSource, options: GithubOptions): RepoReader {
  const call = options.fetchImpl ?? fetch;
  const repo = source.repo ?? "";
  const ghUrl = (v: unknown) => (typeof v === "string" && /^https:\/\/github\.com\//.test(v) ? v : undefined);
  async function get(pathname: string): Promise<unknown> {
    let res: Response;
    try {
      res = await call(`https://api.github.com/repos/${repo}${pathname}`, {
        method: "GET",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "duel-agent-office",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
      });
    } catch {
      throw new RepoError("GitHub is not reachable");
    }
    if (res.status === 404) throw new RepoError("GitHub says this repository or file does not exist (or the token cannot see it)");
    if (res.status === 401 || res.status === 403) throw new RepoError(options.token ? "GitHub refused the request (rate limit or no access)" : "GitHub refused the request: set GITHUB_TOKEN for private repositories or a higher rate limit");
    if (!res.ok) throw new RepoError(`GitHub answered ${res.status}`);
    return res.json();
  }
  const refQuery = source.ref ? `?ref=${encodeURIComponent(source.ref)}` : "";
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    async summary() {
      const [info, commits, pulls, issues] = await Promise.all([
        get("") as Promise<Record<string, unknown>>,
        get(`/commits?per_page=8${source.ref ? `&sha=${encodeURIComponent(source.ref)}` : ""}`).catch(() => []),
        get("/pulls?state=open&per_page=10").catch(() => []),
        get("/issues?state=open&per_page=15").catch(() => []),
      ]);
      const text = (v: unknown, max: number) => String(v ?? "").slice(0, max);
      return {
        kind: "github",
        label: source.label,
        branch: source.ref || text(info.default_branch, 60),
        ...(info.description ? { description: text(info.description, 200) } : {}),
        commits: arr(commits).map((c) => {
          const commit = (c.commit ?? {}) as { message?: string; committer?: { date?: string } };
          return { sha: text(c.sha, 7), subject: text(commit.message, 400).split("\n")[0]?.slice(0, 120) ?? "", ...(commit.committer?.date ? { at: text(commit.committer.date, 30) } : {}) };
        }),
        pulls: arr(pulls).map((p) => ({ number: Number(p.number) || 0, title: text(p.title, 120), ...(p.user ? { author: text((p.user as { login?: string }).login, 40) } : {}), ...(ghUrl(p.html_url) ? { url: ghUrl(p.html_url) } : {}) })),
        issues: arr(issues)
          .filter((i) => !i.pull_request)
          .map((i) => ({ number: Number(i.number) || 0, title: text(i.title, 120), ...(ghUrl(i.html_url) ? { url: ghUrl(i.html_url) } : {}) })),
      };
    },
    async listFiles() {
      const ref = source.ref || "HEAD";
      const tree = (await get(`/git/trees/${encodeURIComponent(ref)}?recursive=1`)) as { tree?: { path?: string; type?: string }[] };
      return (tree.tree ?? []).filter((e) => e.type === "blob" && typeof e.path === "string" && !isSecretPath(e.path)).map((e) => e.path as string).slice(0, MAX_LIST);
    },
    async readFile(rel) {
      if (!rel || isSecretPath(rel) || rel.includes("\0") || rel.split("/").includes("..") || rel.startsWith("/")) return undefined;
      try {
        const file = (await get(`/contents/${rel.split("/").map(encodeURIComponent).join("/")}${refQuery}`)) as { type?: string; encoding?: string; content?: string; size?: number };
        if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string" || (file.size ?? 0) > MAX_FILE_BYTES) return undefined;
        const buf = Buffer.from(file.content, "base64");
        return buf.includes(0) ? undefined : buf.toString("utf8");
      } catch {
        return undefined;
      }
    },
  };
}

export function createRepoReader(source: RepoSource, options: GithubOptions = {}): RepoReader {
  return source.kind === "local" ? localReader(source) : githubReader(source, options);
}
