import { checkPreviewTarget } from "../config.js";

export const MANUAL_HINT =
  "Could not discover a Preview deployment safely. Set GAME_BASE_URL in duel-agent-office/.env manually.";

export type SyncResult = { ok: true } | { ok: false; message: string };

interface Candidate {
  url: string;
  at: number;
}

/**
 * Picks the newest READY Preview deployment from `vercel ls --format json` output.
 * Tolerant of the exact JSON shape (array or `{ deployments: [...] }`). Returns null when
 * nothing usable is found or when the two newest candidates are indistinguishable.
 */
export function pickPreviewUrl(jsonText: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return null;
  }
  const record = data as { deployments?: unknown; items?: unknown } | null;
  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(record?.deployments)
      ? record.deployments
      : Array.isArray(record?.items)
        ? record.items
        : [];

  const candidates: Candidate[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    if (typeof d.url !== "string" || !d.url) continue;
    if (d.target === "production") continue;
    const state = d.readyState ?? d.state;
    if (typeof state === "string" && state.toUpperCase() !== "READY") continue;
    const created = d.createdAt ?? d.created;
    const url = d.url.startsWith("http") ? d.url : `https://${d.url}`;
    if (checkPreviewTarget(url) !== null) continue;
    candidates.push({ url: new URL(url).origin, at: typeof created === "number" ? created : 0 });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.at - a.at);
  const [first, second] = candidates;
  if (first && second && first.at === second.at && first.url !== second.url) return null;
  return first?.url ?? null;
}

/** Replaces (or appends) one KEY=value line; every other line is left untouched. */
export function updateEnvValue(content: string, key: string, value: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content === "" ? [] : content.split(/\r?\n/);
  const line = `${key}=${value}`;
  const index = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (index >= 0) lines[index] = line;
  else {
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    lines.push(line, "");
  }
  return lines.join(eol);
}

export interface SyncDeps {
  /** Runs the local Vercel CLI and returns its JSON stdout. May throw. */
  listPreviews: () => Promise<string>;
  readEnv: () => Promise<string | null>;
  writeEnv: (content: string) => Promise<void>;
  /** True when the .env path is ignored by Git. */
  envIsIgnored: () => Promise<boolean>;
}

/** Updates only GAME_BASE_URL in the ignored .env. Never returns or logs the URL. */
export async function syncPreview(deps: SyncDeps): Promise<SyncResult> {
  if (!(await deps.envIsIgnored().catch(() => false))) {
    return { ok: false, message: "duel-agent-office/.env is not ignored by Git; refusing to write to it." };
  }
  let url: string | null;
  try {
    url = pickPreviewUrl(await deps.listPreviews());
  } catch {
    url = null;
  }
  if (!url || checkPreviewTarget(url) !== null) return { ok: false, message: MANUAL_HINT };

  const current = (await deps.readEnv()) ?? "";
  await deps.writeEnv(updateEnvValue(current, "GAME_BASE_URL", url));
  return { ok: true };
}
