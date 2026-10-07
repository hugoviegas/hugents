import type { FrameGate } from "./gate.js";
import type { LiveConfig, LiveFrame } from "./frame.js";
import type { LiveStage } from "./events.js";

/** The slice of Playwright's page.screencast API (Playwright 1.59+) the capture needs. */
export interface ScreencastLike {
  start(options: {
    onFrame: (frame: { data: Buffer }) => void | Promise<void>;
    size?: { width: number; height: number };
    quality?: number;
  }): Promise<unknown>;
  stop(): Promise<unknown>;
}
export interface ScreencastPage {
  screencast: ScreencastLike;
  viewportSize(): { width: number; height: number } | null;
}

export interface CaptureOptions {
  page: ScreencastPage;
  gate: FrameGate;
  config: LiveConfig;
  runId: string;
  agentId: string;
  player: string;
  /** Receives every frame, hidden placeholders included. Must not persist it. */
  publish(frame: LiveFrame): void;
  /** True while someone watches. With nobody watching no capture runs. */
  hasViewer(): boolean;
  onEvent?(stage: LiveStage): void;
  now?: () => Date;
}

export interface Capture {
  /** Starts the screencast if a viewer is present. Returns whether it started. */
  start(): Promise<boolean>;
  stop(): Promise<void>;
  readonly active: boolean;
}

/** Reads width and height from a JPEG's SOF marker. Returns undefined when it cannot. */
export function jpegSize(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return undefined;
    const marker = buf[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return undefined;
}

/**
 * Worker-side capture tied to the run lifecycle. Throttles to the fps cap, caps size and quality, asks the gate
 * about every frame and sends a pixel-free placeholder when the gate hides it. Frames are never stored here.
 */
export function createCapture(o: CaptureOptions): Capture {
  const now = o.now ?? (() => new Date());
  const minGap = 1000 / o.config.maxFps;
  let active = false;
  let seq = 0;
  let lastAt = -Infinity;
  let busy = false;
  let wasHidden = false;

  const onFrame = async (raw: { data: Buffer }): Promise<void> => {
    if (!active) return;
    if (!o.hasViewer()) {
      await stop();
      return;
    }
    const t = now().getTime();
    if (busy || t - lastAt < minGap) return;
    busy = true;
    lastAt = t;
    try {
      const gate = await o.gate.decide();
      if (!active) return;
      const base = { runId: o.runId, agentId: o.agentId, player: o.player, seq: seq++, at: now().toISOString() };
      if (gate.state === "hidden") {
        if (!wasHidden) o.onEvent?.("gate-blocked");
        wasHidden = true;
        o.publish({ ...base, width: 0, height: 0, jpeg: "", gate });
        return;
      }
      const size = jpegSize(raw.data);
      if (!size || size.width > o.config.maxWidth || size.height > o.config.maxHeight || raw.data.length > o.config.maxFrameBytes) {
        return; // over the caps or unreadable: drop, never send
      }
      if (wasHidden) o.onEvent?.("gate-released");
      wasHidden = false;
      o.publish({ ...base, ...size, jpeg: raw.data.toString("base64"), gate });
    } finally {
      busy = false;
    }
  };

  async function stop(): Promise<void> {
    if (!active) return;
    active = false;
    try {
      await o.page.screencast.stop();
    } catch {
      // the page may already be closed
    }
    o.onEvent?.("stream-end");
  }

  return {
    get active() {
      return active;
    },
    async start() {
      if (active || !o.hasViewer()) return false;
      const vp = o.page.viewportSize();
      const width = Math.min(vp?.width ?? o.config.maxWidth, o.config.maxWidth);
      const height = Math.min(vp?.height ?? o.config.maxHeight, o.config.maxHeight);
      active = true;
      seq = 0;
      wasHidden = false;
      try {
        await o.page.screencast.start({ onFrame, size: { width, height }, quality: o.config.quality });
      } catch (e) {
        active = false;
        throw e;
      }
      o.onEvent?.("stream-start");
      return true;
    },
    stop,
  };
}
