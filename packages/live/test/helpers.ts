import type { Manifest } from "@hugents/core";
import type { ScreencastPage } from "../src/capture.js";

export const manifest: Pick<Manifest, "screens"> = {
  screens: [
    { id: "home", hidden: false },
    { id: "lobby", hidden: false },
    { id: "login", hidden: true },
    { id: "profile", hidden: true },
    { id: "room-code", hidden: true },
  ],
};

/** Minimal valid JPEG header (SOI + SOF0) with a payload tail. Synthetic: no real pixels. */
export function fakeJpeg(width: number, height: number, tail = ""): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from(tail), Buffer.from([0xff, 0xd9])]);
}

export function fakePage(vp = { width: 640, height: 360 }) {
  let onFrame: ((f: { data: Buffer }) => void | Promise<void>) | undefined;
  const calls = { start: 0, stop: 0, options: undefined as unknown };
  const page: ScreencastPage = {
    viewportSize: () => vp,
    screencast: {
      async start(o) {
        calls.start++;
        calls.options = o;
        onFrame = o.onFrame;
      },
      async stop() {
        calls.stop++;
      },
    },
  };
  return { page, calls, push: (data: Buffer) => onFrame?.({ data }) };
}
