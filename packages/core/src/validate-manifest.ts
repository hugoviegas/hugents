#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { MANIFEST_LIMITS, parseManifest } from "./manifest.js";

/** Validates a manifest file and prints reason codes with field paths only, never values. */
const file = process.argv[2];
if (!file) {
  console.error("usage: validate-manifest <file>");
  process.exit(2);
}
let text: string | undefined;
try {
  // Check the size before reading so an oversized file is never loaded.
  text = statSync(file).size > MANIFEST_LIMITS.maxBytes ? undefined : readFileSync(file, "utf8");
} catch {
  console.error("unreadable-file");
  process.exit(2);
}
const result = text === undefined ? { ok: false as const, issues: [{ code: "too-large", path: "$" }] } : parseManifest(text);
if (result.ok) {
  console.log("ok");
} else {
  for (const issue of result.issues) console.log(`${issue.code} ${issue.path}`);
  process.exit(1);
}
