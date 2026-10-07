import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { APP_CSS, APP_JS, INDEX_HTML } from "./dashboardAssets.js";
import type { ObserverConfig } from "./config.js";
import { readApprovedScreenshot, RUN_NAME } from "./inputs.js";
import { buildReport, scanArtifactRoot, type ScannedRun } from "./scan.js";
import { sanitizeText } from "./sanitize.js";
import { playerLabel } from "./analyze.js";
import type { AgentName } from "../orchestrator/eventBus.js";
import type { FindingsReport } from "./schema.js";
import type { OfficeHub, OfficeView } from "../office/hub.js";
import { DEFAULT_LAYOUT, type LayoutStore, type OfficeLayout } from "../office/layout.js";
import { AGENT_COMMANDS, DEFAULT_CONFIGS, EXPLORE_SCREEN_NAMES, type AgentConfigStore, type AgentConfigs } from "../office/agentConfig.js";
import type { Connections, ConnectionStore } from "../office/connections.js";
import { OFFICE_AGENT_IDS } from "../office/contract.js";
import type { DayUsage, QuotaStore } from "../office/quota.js";
import { listReports, readReport, REPORT_FILE, REPORT_SEVERITIES, type ReportEntry } from "../office/reports.js";
import { createRepoReader, RepoError, type GithubOptions } from "../office/repoSource.js";

/** What the browser receives. Built field by field from sanitized data: never raw JSON, paths or URLs. */
export interface DashboardState {
  generatedAt: string;
  /** The office agents and how each looks. Static structure, sent with the data so the page hardcodes no agents. */
  agents: typeof ROSTER;
  /** Live office from the bridge: task board, events, busy flags. Null when the dashboard runs without the office. */
  office: OfficeView | null;
  /** Where the props stand and which agent uses which desk (visual only). */
  layout: OfficeLayout;
  /** Editable settings per agent, today's usage against their quota, the commands each agent understands and the screens the explorer may be limited to. */
  settings: {
    configs: AgentConfigs;
    usage: Record<string, DayUsage>;
    commands: typeof AGENT_COMMANDS;
    screens: readonly string[];
    connections: Connections;
    /** Agents that share one runner round: stopping one stops all of them. */
    sharedRun: readonly string[];
  };
  totals: FindingsReport["totals"];
  repeated: FindingsReport["repeated"];
  runs: {
    runId: string;
    status: string;
    scenario?: string;
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
    ignoredNetworkFailures: number;
    players: { player: string; status: string; activity: string; at?: string }[];
    findings: { severity: string; ruleId: string; category: string; player: string; count: number; message: string; evidence: { file: string; line?: number }[] }[];
    screenshots: { url: string; player: string; label: string }[];
  }[];
}

/**
 * The office agents (bridge ids) in roster order. `look` picks the identity colour and the character sprite;
 * which desk an agent uses comes from the layout.
 */
const ROSTER = [
  { id: "player-alpha", name: "Player Alpha", role: "Hosts the private match and plays it as Alpha", look: 1 },
  { id: "player-bravo", name: "Player Bravo", role: "Joins the private match and plays it as Bravo", look: 5 },
  { id: "explorer", name: "Explorer", role: "Walks the screens and captures them", look: 2 },
  { id: "qa-analyst", name: "QA Analyst", role: "Reads run artifacts and writes findings", look: 3 },
  { id: "design-critic", name: "Design Critic", role: "Checks the UI against the design system", look: 4 },
  { id: "test-planner", name: "Test Planner", role: "Reads the game's code and plans the test setup", look: 6 },
] as const;

const SHARED_RUN: readonly string[] = ["player-alpha", "player-bravo"];

/** File name of a report. A name that looks like one of ours is kept as is (its timestamp would read as a token to the sanitizer). */
const reportName = (p: string) => {
  const name = p.split(/[\\/]/).pop() ?? "";
  return REPORT_FILE.test(name) ? name : sanitizeText(name, 120);
};

/** Office data as the page gets it: every free-text field sanitized again, report paths reduced to their file name. */
export function sanitizeOfficeView(view: OfficeView): OfficeView {
  return {
    ...view,
    tasks: view.tasks.map((t) => ({
      ...t,
      title: sanitizeText(t.title, 200),
      activity: sanitizeText(t.activity, 160),
      ...(t.summary !== undefined ? { summary: sanitizeText(t.summary, 400) } : {}),
      ...(t.reportPath !== undefined ? { reportPath: reportName(t.reportPath) } : {}),
      ...(t.runId !== undefined ? { runId: RUN_NAME.test(t.runId) ? t.runId : "run" } : {}),
    })),
    events: view.events.map((e) => ({ ...e, activity: sanitizeText(e.activity, 160), at: ISO_TIME.test(e.at) ? e.at : "" })),
  };
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

export function buildDashboardState(
  scanned: readonly ScannedRun[],
  config: ObserverConfig,
  now: Date,
  office: OfficeView | null = null,
  layout: OfficeLayout = DEFAULT_LAYOUT,
  settings: DashboardState["settings"] = { configs: DEFAULT_CONFIGS, usage: {}, commands: AGENT_COMMANDS, screens: EXPLORE_SCREEN_NAMES, connections: { sources: [] }, sharedRun: SHARED_RUN },
): DashboardState {
  const report = buildReport(
    scanned.map((s) => s.report),
    "root",
    config,
    now,
  );
  const byId = new Map(scanned.map((s) => [s.report.runId, s]));
  return {
    generatedAt: report.generatedAt,
    agents: ROSTER,
    office: office ? sanitizeOfficeView(office) : null,
    layout,
    settings,
    totals: report.totals,
    repeated: report.repeated.map((r) => ({ ...r, message: sanitizeText(r.message) })),
    // Newest first.
    runs: [...report.runs].reverse().map((run) => {
      const source = byId.get(run.runId) as ScannedRun;
      return {
        runId: run.runId,
        status: run.status,
        ...(run.scenario ? { scenario: run.scenario } : {}),
        ...(run.startedAt ? { startedAt: run.startedAt } : {}),
        ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
        ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
        ignoredNetworkFailures: run.ignored.networkFailures,
        players: source.latest.map((e) => ({
          player: playerLabel(e.agent as AgentName),
          status: e.status,
          activity: sanitizeText(e.activity, 160),
          // Only a plain ISO timestamp passes; anything else is dropped rather than shown.
          ...(ISO_TIME.test(e.at) ? { at: e.at } : {}),
        })),
        findings: run.findings.map((f) => ({
          severity: f.severity,
          ruleId: f.ruleId,
          category: f.category,
          player: f.player,
          count: f.count,
          message: sanitizeText(f.message),
          evidence: f.evidence,
        })),
        screenshots: source.screenshots.map((s, i) => ({ url: `/shot/${run.runId}/${i}`, player: s.player, label: s.label })),
      };
    }),
  };
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
} as const;

const send = (res: ServerResponse, status: number, type: string, body: string | Buffer) => {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type });
  res.end(body);
};

/** Blocks DNS-rebinding: the Host header must be a loopback name with this server's port. */
function hostAllowed(req: IncomingMessage, port: number): boolean {
  const host = (req.headers.host ?? "").toLowerCase();
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host);
}

// A full layout (40 props) stays well under this.
const MAX_POST_BYTES = 8_000;

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > MAX_POST_BYTES) {
        resolve(undefined);
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", () => resolve(undefined));
  });
}

/**
 * A task starts a real browser run, so only the page itself may post one. Browsers send Origin (and Sec-Fetch-Site)
 * on a fetch POST; a page on another site cannot fake either, and the JSON content type forces a preflight we never answer.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return origin.toLowerCase() === `http://${(req.headers.host ?? "").toLowerCase()}`;
}

/** Creates (does not start) the dashboard server. Starting is an explicit act of `startDashboard`. */
export interface OfficeStores {
  configs?: AgentConfigStore;
  quota?: QuotaStore;
  connections?: ConnectionStore;
  /** Read-only GitHub access (token from the process environment, optional). */
  github?: GithubOptions;
}

const REPORT_LIMIT = 200;
const query = (url: URL, key: string) => (url.searchParams.get(key) ?? "").slice(0, 80) || undefined;
const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** Report entries for the page: free text sanitized again, nothing that is not a plain field. */
function reportRow(e: ReportEntry): ReportEntry {
  return { ...e, title: sanitizeText(e.title, 120), ...(e.taskTitle ? { taskTitle: sanitizeText(e.taskTitle, 200) } : {}), ...(e.objective ? { objective: sanitizeText(e.objective, 300) } : {}), ...(e.runId ? { runId: RUN_NAME.test(e.runId) ? e.runId : "run" } : {}) };
}

export function createDashboardServer(config: ObserverConfig, now: () => Date = () => new Date(), office?: OfficeHub, layout?: LayoutStore, stores: OfficeStores = {}): Server {
  let port = config.port;
  const settings = async (): Promise<DashboardState["settings"]> => ({
    configs: stores.configs ? await stores.configs.all() : DEFAULT_CONFIGS,
    usage: stores.quota ? await stores.quota.today() : {},
    commands: AGENT_COMMANDS,
    screens: EXPLORE_SCREEN_NAMES,
    connections: stores.connections ? await stores.connections.get() : { sources: [] },
    sharedRun: SHARED_RUN,
  });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const taskHandler = async (input: unknown) => {
        const body = (input && typeof input === "object" ? input : {}) as { agentId?: unknown; title?: unknown; command?: unknown };
        const agentId = (OFFICE_AGENT_IDS as readonly unknown[]).includes(body.agentId) ? (body.agentId as (typeof OFFICE_AGENT_IDS)[number]) : undefined;
        // A command with no text runs the agent's configured objective.
        const blank = typeof body.title !== "string" || !body.title.trim();
        const title = blank && agentId && stores.configs ? (await stores.configs.get(agentId)).objective : body.title;
        const result = await (office as OfficeHub).assign({ ...body, title });
        const task = result.body.task;
        return { status: result.status, body: task ? { task: sanitizeOfficeView({ connected: true, readonly: false, agents: [], tasks: [task], events: [], staleRunners: 0 }).tasks[0] } : result.body };
      };
      const postHandlers: Record<string, ((input: unknown) => Promise<{ status: number; body: unknown }> | { status: number; body: unknown }) | undefined> = {
        "/api/tasks": office ? taskHandler : undefined,
        "/api/layout": layout ? (input) => layout.save(input) : undefined,
        "/api/agent-config": stores.configs
          ? (input) => {
              const body = (input && typeof input === "object" ? input : {}) as { agentId?: unknown; config?: unknown };
              return (stores.configs as AgentConfigStore).save(body.agentId, body.config);
            }
          : undefined,
        "/api/stop": office ? (input) => (office as OfficeHub).stop((input as { agentId?: unknown } | null)?.agentId) : undefined,
        "/api/cleanup": office ? () => (office as OfficeHub).cleanup() : undefined,
        "/api/connections": stores.connections ? (input) => (stores.connections as ConnectionStore).save(input) : undefined,
      };
      const postHandler = postHandlers[url.pathname];
      if (req.method === "POST" && postHandler) {
        if (!hostAllowed(req, port) || !sameOrigin(req)) return send(res, 403, "text/plain", "Forbidden");
        if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, "text/plain", "application/json required");
        const raw = await readBody(req);
        let input: unknown;
        try {
          input = raw === undefined ? undefined : JSON.parse(raw);
        } catch {
          input = undefined;
        }
        if (input === undefined) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "Invalid request" }));
        const result = await postHandler(input);
        return send(res, result.status, "application/json; charset=utf-8", JSON.stringify(result.body));
      }
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain", "Method not allowed");
      if (!hostAllowed(req, port)) return send(res, 403, "text/plain", "Forbidden");
      if (url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", INDEX_HTML);
      if (url.pathname === "/app.css") return send(res, 200, "text/css; charset=utf-8", APP_CSS);
      if (url.pathname === "/app.js") return send(res, 200, "text/javascript; charset=utf-8", APP_JS);
      if (url.pathname === "/api/state") {
        const when = now();
        const scanned = await scanArtifactRoot(config, when);
        const officeView = office ? await office.view() : null;
        const currentLayout = layout ? await layout.get() : DEFAULT_LAYOUT;
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify(buildDashboardState(scanned, config, when, officeView, currentLayout, await settings())));
      }
      if (url.pathname === "/api/reports") {
        const severity = query(url, "severity");
        const rows = await listReports(config.artifactsDir, {
          agent: query(url, "agent"),
          severity: severity && (REPORT_SEVERITIES as readonly string[]).includes(severity) ? severity : undefined,
          task: query(url, "task"),
          from: day(query(url, "from")),
          to: day(query(url, "to")),
        });
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ total: rows.length, reports: rows.slice(0, REPORT_LIMIT).map(reportRow) }));
      }
      if (url.pathname === "/api/report") {
        const text = await readReport(config.artifactsDir, url.searchParams.get("file") ?? "");
        if (text === undefined) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "No such report" }));
        // Line by line, so the Markdown keeps its shape while URLs, e-mails and ids are masked once more.
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ text: text.split("\n").map((l) => sanitizeText(l, 600)).join("\n") }));
      }
      if (url.pathname === "/api/github") {
        // Read-only: a summary of one configured source. The source comes from the saved list, never from the request.
        const all = stores.connections ? await stores.connections.get() : { sources: [] };
        const source = all.sources.find((x) => x.id === url.searchParams.get("source"));
        if (!source) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "Unknown source" }));
        try {
          return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await createRepoReader(source, stores.github).summary()));
        } catch (error) {
          return send(res, 502, "application/json; charset=utf-8", JSON.stringify({ error: error instanceof RepoError ? error.message : "The source could not be read" }));
        }
      }
      const shot = /^\/shot\/([^/]+)\/(\d{1,3})$/.exec(url.pathname);
      if (shot && RUN_NAME.test(shot[1] as string)) {
        // The path never comes from the request: the run and index select from the approved list.
        const scanned = (await scanArtifactRoot(config, now())).find((s) => s.report.runId === shot[1]);
        const approved = scanned?.screenshots[Number(shot[2])];
        if (scanned && approved) return send(res, 200, "image/png", await readApprovedScreenshot(scanned.root, approved));
      }
      return send(res, 404, "text/plain", "Not found");
    } catch {
      return send(res, 500, "text/plain", "Error");
    }
  });
  // With port 0 the OS picks one; the Host check needs the real port.
  server.on("listening", () => {
    port = (server.address() as AddressInfo).port;
  });
  return server;
}

/** Explicit start. Binds to the configured loopback host only. */
export async function startDashboard(config: ObserverConfig, office?: OfficeHub, layout?: LayoutStore, stores?: OfficeStores): Promise<{ server: Server; port: number }> {
  const server = createDashboardServer(config, undefined, office, layout, stores);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  return { server, port: (server.address() as AddressInfo).port };
}
