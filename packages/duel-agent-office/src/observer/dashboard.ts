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

/** What the browser receives. Built field by field from sanitized data: never raw JSON, paths or URLs. */
export interface DashboardState {
  generatedAt: string;
  /** Who sits at which desk of the office view. Static structure, sent with the data so the page hardcodes no agents. */
  agents: typeof ROSTER;
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

/** The runner's agents (by observer player label) plus the observer's own desk, in roster order. */
const ROSTER = [
  { id: "alpha", name: "Player Alpha", role: "Creates the private room and plays", desk: 1 },
  { id: "bravo", name: "Player Bravo", role: "Joins the room and plays", desk: 2 },
  { id: "runner", name: "Runner", role: "Opens both browsers and drives the scenario", desk: 4 },
  { id: "report", name: "QA Observer", role: "Reads run artifacts and writes findings", desk: 3 },
] as const;

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

export function buildDashboardState(scanned: readonly ScannedRun[], config: ObserverConfig, now: Date): DashboardState {
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

/** Creates (does not start) the dashboard server. Starting is an explicit act of `startDashboard`. */
export function createDashboardServer(config: ObserverConfig, now: () => Date = () => new Date()): Server {
  let port = config.port;
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain", "Method not allowed");
      if (!hostAllowed(req, port)) return send(res, 403, "text/plain", "Forbidden");
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", INDEX_HTML);
      if (url.pathname === "/app.css") return send(res, 200, "text/css; charset=utf-8", APP_CSS);
      if (url.pathname === "/app.js") return send(res, 200, "text/javascript; charset=utf-8", APP_JS);
      if (url.pathname === "/api/state") {
        const when = now();
        const scanned = await scanArtifactRoot(config, when);
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify(buildDashboardState(scanned, config, when)));
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
export async function startDashboard(config: ObserverConfig): Promise<{ server: Server; port: number }> {
  const server = createDashboardServer(config);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  return { server, port: (server.address() as AddressInfo).port };
}
