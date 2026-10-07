import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { parseFrame, type LiveConfig, type LiveFrame } from "./frame.js";

export const BIND_HOST = "127.0.0.1";

export interface RunInfo {
  runId: string;
  agentId: string;
  status: string;
  phase: string;
  startedAt: string;
}

export interface RelayOptions {
  /** 0 picks a free port. */
  port?: number;
  /** Admin login result. Sent as `Authorization: Bearer`; never in a URL. */
  viewerToken: string;
  /** Shared with the worker process only. */
  workerToken: string;
  config: LiveConfig;
  /** Browser origins allowed to call the relay (the office UI). Default: none. */
  allowedOrigins?: readonly string[];
  /** Max players buffered per run. */
  maxPlayers?: number;
  onViewerChange?(viewers: number): void;
}

export interface Relay {
  start(): Promise<number>;
  stop(): Promise<void>;
  beginRun(info: RunInfo): void;
  updateRun(patch: Partial<Pick<RunInfo, "status" | "phase">>): void;
  endRun(runId: string, status: "completed" | "failed" | "stopped"): void;
  /** In-process ingest (same path as POST /worker/frame). Returns false when the frame is dropped. */
  publish(frame: LiveFrame): boolean;
  hasViewer(): boolean;
  readonly viewerCount: number;
}

const digest = (s: string) => createHash("sha256").update(s).digest();
const sameSecret = (given: string | undefined, expected: string) => given !== undefined && timingSafeEqual(digest(given), digest(expected));
const bearer = (req: IncomingMessage) => /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];

/**
 * Loopback relay: worker -> relay -> authenticated viewer. Bound to 127.0.0.1, Host validated, GET-only for viewers.
 * Keeps at most the latest frame per player in memory. Nothing is written to disk. If nobody watches, the worker is
 * told `wanted: false`; a slow viewer is skipped, never buffered.
 */
export function createRelay(opts: RelayOptions): Relay {
  const maxPlayers = opts.maxPlayers ?? 4;
  const maxBody = Math.ceil(opts.config.maxFrameBytes * 1.4) + 2048;
  const latest = new Map<string, LiveFrame>();
  const viewers = new Set<{ res: ServerResponse; player: string }>();
  let run: RunInfo | undefined;
  let lastRun: { status: string; endedAt: string } | undefined;
  let boundPort = 0;

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const sse = (v: { res: ServerResponse }, event: string, data: unknown): void => {
    if (v.res.writableNeedDrain) return; // slow viewer: drop, do not buffer
    v.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const notifyViewers = () => opts.onViewerChange?.(viewers.size);

  function publish(frame: LiveFrame): boolean {
    if (!run || frame.runId !== run.runId) return false; // never simulate or replay: only the active run
    if (!latest.has(frame.player) && latest.size >= maxPlayers) return false;
    latest.set(frame.player, frame);
    for (const v of viewers) if (v.player === frame.player) sse(v, "frame", frame);
    return true;
  }

  async function readBody(req: IncomingMessage): Promise<string | undefined> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > maxBody) return undefined;
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  const server: Server = createServer(async (req, res) => {
    try {
      const hosts = new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`, `[::1]:${boundPort}`]);
      if (!hosts.has(req.headers.host ?? "")) return send(res, 403, { error: "bad-host" });
      const origin = req.headers.origin;
      if (origin !== undefined) {
        if (!opts.allowedOrigins?.includes(origin)) return send(res, 403, { error: "bad-origin" });
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "Origin");
        res.setHeader("access-control-allow-headers", "authorization");
        res.setHeader("access-control-allow-methods", "GET");
      }
      const url = new URL(req.url ?? "/", "http://relay.local");
      const path = url.pathname;

      if (path.startsWith("/viewer/")) {
        if (req.method === "OPTIONS") return send(res, 204, {});
        if (!sameSecret(bearer(req), opts.viewerToken)) return send(res, 401, { error: "unauthorized" });
        if (req.method !== "GET") return send(res, 403, { error: "input-not-allowed" }); // read-only popup
        if (path === "/viewer/status") {
          return send(res, 200, { run: run ?? null, lastRun: lastRun ?? null, players: [...latest.keys()] });
        }
        if (path === "/viewer/stream") {
          const player = url.searchParams.get("player") ?? "alpha";
          if (!/^[A-Za-z0-9_-]{1,64}$/.test(player)) return send(res, 400, { error: "bad-player" });
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
          const v = { res, player };
          viewers.add(v);
          notifyViewers();
          req.on("close", () => {
            if (viewers.delete(v)) notifyViewers();
          });
          sse(v, "status", { run: run ?? null, lastRun: lastRun ?? null });
          const first = latest.get(player);
          if (first) sse(v, "frame", first);
          return;
        }
        return send(res, 404, { error: "not-found" });
      }

      if (path === "/worker/wanted") {
        if (req.method !== "GET") return send(res, 405, { error: "method-not-allowed" });
        if (!sameSecret(bearer(req), opts.workerToken)) return send(res, 401, { error: "unauthorized" });
        return send(res, 200, { wanted: !!run && viewers.size > 0 });
      }

      if (path === "/worker/run") {
        if (req.method !== "POST") return send(res, 405, { error: "method-not-allowed" });
        if (!sameSecret(bearer(req), opts.workerToken)) return send(res, 401, { error: "unauthorized" });
        const body = await readBody(req);
        let msg: Record<string, unknown> = {};
        try {
          msg = body === undefined ? {} : (JSON.parse(body) as Record<string, unknown>);
        } catch {
          return send(res, 400, { error: "invalid-run" });
        }
        const label = (v: unknown, max = 64) => (typeof v === "string" && /^[A-Za-z0-9_ .:-]{1,64}$/.test(v) && v.length <= max ? v : undefined);
        const runId = label(msg.runId);
        if (msg.action === "begin") {
          const agentId = label(msg.agentId);
          if (!runId || !agentId) return send(res, 400, { error: "invalid-run" });
          self.beginRun({ runId, agentId, status: label(msg.status) ?? "working", phase: label(msg.phase) ?? "setup", startedAt: new Date().toISOString() });
          return send(res, 200, { ok: true });
        }
        if (msg.action === "update") {
          const status = label(msg.status);
          const phase = label(msg.phase);
          self.updateRun({ ...(status ? { status } : {}), ...(phase ? { phase } : {}) });
          return send(res, 200, { ok: true });
        }
        if (msg.action === "end" && runId && (msg.status === "completed" || msg.status === "failed" || msg.status === "stopped")) {
          self.endRun(runId, msg.status);
          return send(res, 200, { ok: true });
        }
        return send(res, 400, { error: "invalid-run" });
      }

      if (path === "/worker/frame") {
        if (req.method !== "POST") return send(res, 405, { error: "method-not-allowed" });
        if (!sameSecret(bearer(req), opts.workerToken)) return send(res, 401, { error: "unauthorized" });
        const body = await readBody(req);
        if (body === undefined) return send(res, 413, { error: "too-large" });
        let frame: LiveFrame | undefined;
        try {
          frame = parseFrame(JSON.parse(body), opts.config);
        } catch {
          frame = undefined;
        }
        if (!frame) return send(res, 400, { error: "invalid-frame" });
        const accepted = viewers.size > 0 && publish(frame);
        return send(res, 200, { wanted: viewers.size > 0, accepted });
      }
      return send(res, 404, { error: "not-found" });
    } catch {
      if (!res.headersSent) send(res, 500, { error: "internal" });
      else res.end();
    }
  });
  // Viewers never send anything; refuse protocol upgrades (no WebSocket input channel).
  server.on("upgrade", (_req, socket) => socket.destroy());

  const self: Relay = {
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(opts.port ?? 0, BIND_HOST, () => {
          boundPort = (server.address() as AddressInfo).port;
          resolve(boundPort);
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        for (const v of viewers) v.res.end();
        viewers.clear();
        latest.clear();
        run = undefined;
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
    beginRun(info) {
      latest.clear();
      run = info;
      lastRun = undefined;
      for (const v of viewers) sse(v, "status", { run, lastRun: null });
    },
    updateRun(patch) {
      if (!run) return;
      run = { ...run, ...patch };
      for (const v of viewers) sse(v, "status", { run, lastRun: null });
    },
    endRun(runId, status) {
      if (!run || run.runId !== runId) return;
      latest.clear(); // stale frames never outlive the run
      run = undefined;
      lastRun = { status, endedAt: new Date().toISOString() };
      for (const v of viewers) sse(v, "ended", { lastRun });
    },
    publish,
    hasViewer: () => viewers.size > 0,
    get viewerCount() {
      return viewers.size;
    },
  };
  return self;
}
