import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MANIFEST_LIMITS, migrateLegacyManifest, parseManifest } from "../src/index.js";

const valid = JSON.parse(readFileSync(new URL("../../../examples/manifest.example.json", import.meta.url), "utf8"));
const codes = (input: unknown) => {
  const r = parseManifest(input);
  return r.ok ? [] : r.issues.map((i) => `${i.code} ${i.path}`);
};

describe("parseManifest", () => {
  it("parses a valid manifest into the typed object", () => {
    const r = parseManifest(valid);
    expect(r.ok && r.manifest).toEqual(valid);
    expect(parseManifest(JSON.stringify(valid)).ok).toBe(true);
  });

  it("defaults availableScenarios to empty", () => {
    const { availableScenarios: _omit, ...rest } = valid;
    const r = parseManifest(rest);
    expect(r.ok && r.manifest.availableScenarios).toEqual([]);
  });

  it.each(["projectId", "allowedTargetUrlPattern", "blockedTargets", "testAccountVariableNames", "screens", "forbiddenActions"])(
    "rejects the whole manifest when %s is missing",
    (field) => {
      const { [field]: _omit, ...rest } = valid;
      const r = parseManifest(rest);
      expect(r).toEqual({ ok: false, issues: [{ code: "missing-field", path: field }] });
    },
  );

  it("requires the hidden flag on every screen and at least one blocked target", () => {
    expect(codes({ ...valid, screens: [{ id: "a" }] })).toEqual(["missing-field screens[0].hidden"]);
    expect(codes({ ...valid, blockedTargets: [] })).toEqual(["invalid-value blockedTargets"]);
  });

  it.each([
    ["no ^", "https://qa\\.example\\.test$"],
    ["no $", "^https://qa\\.example\\.test"],
    ["an escaped $", "^https://qa\\.example\\.test\\$"],
    ["top-level alternation", "^https://qa\\.example\\.test$|https://evil\\.example\\.test"],
  ])("rejects a pattern with %s", (_n, pattern) => {
    expect(codes({ ...valid, allowedTargetUrlPattern: pattern })).toEqual(["unanchored-pattern allowedTargetUrlPattern"]);
  });

  it("rejects an unparseable pattern and allows alternation in a group", () => {
    expect(codes({ ...valid, allowedTargetUrlPattern: "^(unclosed$" })).toEqual(["invalid-pattern allowedTargetUrlPattern"]);
    expect(parseManifest({ ...valid, allowedTargetUrlPattern: "^https://(qa|stage)\\.example\\.test$" }).ok).toBe(true);
  });

  it("keeps a blocked target ahead of the allowlist data (both are kept, the consumer checks blocked first)", () => {
    const r = parseManifest({ ...valid, blockedTargets: ["qa-"] });
    expect(r.ok && r.manifest.blockedTargets).toEqual(["qa-"]);
  });

  const secrets = {
    email: "someone@example.test",
    token: "ghp_abcdefghijklmnopqrstuvwxyz0123",
    key: "AIzaSyA1234567890abcdefghijklmnop",
    assignment: "password=hunter2hunter2",
  };
  it.each(Object.entries(secrets))("rejects a %s-shaped value in any string field and never echoes it", (_n, secret) => {
    for (const mutated of [
      { ...valid, projectId: secret },
      { ...valid, blockedTargets: [secret] },
      { ...valid, testAccountVariableNames: [secret] },
      { ...valid, availableScenarios: [secret] },
      { ...valid, screens: [{ id: secret, hidden: false }] },
      { ...valid, forbiddenActions: [secret] },
      { ...valid, allowedTargetUrlPattern: `^${secret}$` },
    ]) {
      const r = parseManifest(mutated);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain(secret);
    }
  });

  it("rejects oversized input and over-limit lists", () => {
    expect(codes("x".repeat(MANIFEST_LIMITS.maxBytes + 1))).toEqual(["too-large $"]);
    const many = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`);
    expect(codes({ ...valid, forbiddenActions: many(MANIFEST_LIMITS.maxForbiddenActions + 1) })).toEqual(["too-many-items forbiddenActions"]);
    expect(codes({ ...valid, screens: many(MANIFEST_LIMITS.maxScreens + 1).map((id) => ({ id, hidden: false })) })).toEqual(["too-many-items screens"]);
    expect(codes({ ...valid, forbiddenActions: ["x".repeat(MANIFEST_LIMITS.maxPhraseLength + 1)] })).toEqual(["too-long forbiddenActions[0]"]);
  });

  it("rejects unknown fields, duplicates, bad types and bad JSON", () => {
    expect(codes({ ...valid, extra: 1 })).toEqual(["unknown-field extra"]);
    expect(codes({ ...valid, screens: [{ id: "a", hidden: false, note: "x" }] })).toEqual(["unknown-field screens[0].note"]);
    expect(codes({ ...valid, screens: [{ id: "a", hidden: false }, { id: "a", hidden: true }] })).toEqual(["duplicate screens[1].id"]);
    expect(codes({ ...valid, testAccountVariableNames: ["lowercase"] })).toEqual(["invalid-value testAccountVariableNames[0]"]);
    expect(codes({ ...valid, projectId: 3 })).toEqual(["invalid-type projectId"]);
    expect(codes("{")).toEqual(["invalid-json $"]);
    expect(codes([])).toEqual(["not-an-object $"]);
  });
});

describe("migrateLegacyManifest", () => {
  it("turns screensToHide ids into hidden screens", () => {
    const { screens: _s, ...rest } = valid;
    const migrated = migrateLegacyManifest({ ...rest, screens: [{ id: "visible", hidden: false }], screensToHide: ["secret-screen"] });
    const r = parseManifest(migrated);
    expect(r.ok && r.manifest.screens).toEqual([{ id: "visible", hidden: false }, { id: "secret-screen", hidden: true }]);
  });

  it("leaves selectors to be rejected by path", () => {
    const { screens: _s, ...rest } = valid;
    expect(codes(migrateLegacyManifest({ ...rest, screensToHide: [".some > selector"] }))).toEqual(["invalid-value screens[0].id"]);
  });

  it("the old field alone is rejected without migration", () => {
    expect(codes({ ...valid, screensToHide: ["a"] })).toEqual(["unknown-field screensToHide"]);
  });
});
