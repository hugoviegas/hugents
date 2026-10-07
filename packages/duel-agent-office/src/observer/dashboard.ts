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

/** What the browser receives. Built field by field from sanitized data: never raw JSON, paths or URLs. */
export interface DashboardState {
  generatedAt: string;
  /** The office agents and how each looks. Static structure, sent with the data so the page hardcodes no agents. */
  agents: typeof ROSTER;
  /** Live office from the bridge: task board, events, busy flags. Null when the dashboard runs without the office. */
  office: OfficeView | null;
  /** Where the props stand and which agent uses which desk (visual only). */
  layout: OfficeLayout;
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
 * The four office agents (bridge ids) in roster order. `look` picks the identity colour and the character sprite;
 * which desk an agent uses comes from the layout.
 */
const ROSTER = [
  { id: "player-alpha", name: "Player Alpha", role: "Plays the private match against Player Bravo", look: 1 },
  { id: "explorer", name: "Explorer", role: "Walks the screens and captures them", look: 2 },
  { id: "qa-analyst", name: "QA Analyst", role: "Reads run artifacts and writes findings", look: 3 },
  { id: "design-critic", name: "Design Critic", role: "Checks the UI against the design system", look: 4 },
] as const;

/** Office data as the page gets it: every free-text field sanitized again, report paths reduced to their file name. */
export function sanitizeOfficeView(view: OfficeView): OfficeView {
  return {
    ...view,
    tasks: view.tasks.map((t) => ({
      ...t,
      title: sanitizeText(t.title, 200),
      activity: sanitizeText(t.activity, 160),
      ...(t.summary !== undefined ? { summary: sanitizeText(t.summary, 400) } : {}),
      ...(t.reportPath !== undefined ? { reportPath: sanitizeText(t.reportPath.split(/[\\/]/).pop() ?? "", 120) } : {}),
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
export function createDashboardServer(config: ObserverConfig, now: () => Date = () => new Date(), office?: OfficeHub, layout?: LayoutStore): Server {
  let port = config.port;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const postHandler =
        url.pathname === "/api/tasks" && office
          ? async (input: unknown) => {
              const result = await office.assign(input);
              const task = result.body.task;
              return { status: result.status, body: task ? { task: sanitizeOfficeView({ connected: true, readonly: false, agents: [], tasks: [task], events: [] }).tasks[0] } : result.body };
            }
          : url.pathname === "/api/layout" && layout
            ? (input: unknown) => layout.save(input)
            : undefined;
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
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify(buildDashboardState(scanned, config, when, officeView, currentLayout)));
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
export async function startDashboard(config: ObserverConfig, office?: OfficeHub, layout?: LayoutStore): Promise<{ server: Server; port: number }> {
  const server = createDashboardServer(config, undefined, office, layout);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  return { server, port: (server.address() as AddressInfo).port };
}
