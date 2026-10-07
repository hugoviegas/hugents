import { readFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeText } from "../observer/sanitize.js";

/**
 * Read-only view of the agent runtime packages (packages/runtime) that belong to one office agent: a package belongs
 * when its `officeAgent` or its id names the office agent. Reads the runtime's JSON collections directly.
 * ponytail: no revalidation of stored packages (display only); show this through @hugents/runtime `inspect()` if the
 * office ever joins the workspaces.
 */
export interface RuntimeAgentView {
  id: string;
  version: string;
  versions: string[];
  name: string;
  role: string;
  description: string;
  contentHash: string;
  model: string;
  tools: string[];
  capabilities: string[];
  limits: Record<string, number>;
  boards: { produces: string[]; transitions: string[] };
  prompt: string;
  skills: { id: string; text: string }[];
  tasks: { id: string; version: string; state: string; reason?: string; summary?: string; createdAt: string; items: { board: string; state: string; title: string }[] }[];
}

// Untrusted JSON from disk: every field is checked or masked before it leaves this module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const ID = /^[a-z0-9][a-z0-9@._:>-]{0,95}$/i;
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : "?");
const ids = (v: unknown) => (Array.isArray(v) ? v.map(id) : []);
// Multi-line text keeps its lines; each line goes through the same masking as reports.
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max).split("\n").map((l) => sanitizeText(l, 600)).join("\n") : "");
const semver = (v: string) => v.split(".").map(Number);
const newer = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

async function collection(dir: string, name: string): Promise<Record<string, Record<string, Loose>>> {
  try {
    const data = JSON.parse(await readFile(path.join(dir, `${name}.json`), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {}; // no runtime data yet
  }
}

export async function runtimeAgentsFor(dir: string, officeId: string): Promise<RuntimeAgentView[]> {
  const [agents = {}, tasks = {}, items = {}] = await Promise.all(["agents", "tasks", "board-items"].map((n) => collection(dir, n)));
  const byId = new Map<string, Record<string, Loose>[]>();
  for (const stored of Object.values(agents)) {
    if (typeof stored?.id !== "string" || typeof stored.files?.["agent.json"] !== "string") continue;
    byId.set(stored.id, [...(byId.get(stored.id) ?? []), stored]);
  }
  const out: RuntimeAgentView[] = [];
  for (const [agentId, versions] of byId) {
    versions.sort((a, b) => newer(String(a.version), String(b.version)));
    const latest = versions.at(-1)!;
    let m: Record<string, Loose>;
    try {
      m = JSON.parse(latest.files["agent.json"]);
    } catch {
      continue;
    }
    if (m.officeAgent !== officeId && agentId !== officeId) continue;
    const files = latest.files as Record<string, string>;
    const mine = Object.values(tasks)
      .filter((t) => t?.agentId === agentId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 8);
    out.push({
      id: id(agentId),
      version: id(m.version),
      versions: versions.map((v) => id(v.version)),
      name: text(m.identity?.name, 40),
      role: text(m.identity?.role, 60),
      description: text(m.identity?.description, 300),
      contentHash: id(String(latest.contentHash ?? "").slice(0, 12)),
      model: [m.model?.provider, m.model?.model].filter((x) => typeof x === "string").map(id).join(" · "),
      tools: ids(m.tools),
      capabilities: ids(m.capabilities),
      limits: Object.fromEntries(Object.entries(m.limits ?? {}).filter(([, v]) => typeof v === "number").map(([k, v]) => [id(k), v as number])),
      boards: {
        produces: (m.boards?.produces ?? []).map((p: Loose) => `${id(p?.board)}:${id(p?.state)}`),
        transitions: (m.boards?.transitions ?? []).map((t: Loose) => `${id(t?.board)}:${id(t?.from)}>${id(t?.to)}`),
      },
      prompt: text(files[m.prompt?.system], 16_000),
      skills: (m.skills ?? []).map((s: Loose) => ({ id: id(s?.id), text: text(files[s?.file], 8_000) })),
      tasks: mine.map((t) => ({
        id: id(t.id),
        version: id(t.agentVersion),
        state: id(t.state),
        ...(t.result?.reason ? { reason: id(t.result.reason) } : {}),
        ...(t.result?.outputSummary ? { summary: text(t.result.outputSummary, 200) } : {}),
        createdAt: id(t.createdAt),
        items: ids(t.result?.proposedItemIds).flatMap((iid) => {
          const item = items[iid];
          return item ? [{ board: id(item.board), state: id(item.state), title: text(item.payload?.title ?? item.payload?.goal ?? "", 160).replace(/\n/g, " ") }] : [];
        }),
      })),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
