import { describe, expect, it } from "vitest";
import { createManifest, ManifestError } from "../src/index.js";
import { manifest } from "./fixtures.js";

const base = { ...manifest, allowedTargetUrlPattern: "^https://qa\\.example\\.test$" };

describe("createManifest", () => {
  it("accepts an anchored pattern", () => {
    expect(createManifest(base).allowedTargetUrlPattern).toBe(base.allowedTargetUrlPattern);
  });

  it.each([
    ["no ^", "https://qa\\.example\\.test$"],
    ["no $", "^https://qa\\.example\\.test"],
    ["an escaped $", "^https://qa\\.example\\.test\\$"],
    ["top-level alternation", "^https://qa\\.example\\.test$|https://evil\\.example\\.test"],
    ["unanchored substring", "qa\\.example\\.test"],
  ])("refuses a pattern with %s", (_n, pattern) => {
    expect(() => createManifest({ ...base, allowedTargetUrlPattern: pattern })).toThrow(ManifestError);
  });

  it("refuses an unparseable pattern", () => {
    expect(() => createManifest({ ...base, allowedTargetUrlPattern: "^(unclosed$" })).toThrow(/invalid-pattern/);
  });

  it("allows alternation inside a group", () => {
    expect(() => createManifest({ ...base, allowedTargetUrlPattern: "^https://(qa|stage)\\.example\\.test$" })).not.toThrow();
  });
});
