import { describe, expect, it, vi } from "vitest";
import { assertAllowedTarget, openSeededPage, SeedError, TargetBlockedError } from "../src/index.js";
import { manifest } from "./fixtures.js";

const env = { QA_ACCOUNT_A: "fake-credential" };
const mk = () => ({ goto: vi.fn(async () => undefined) });

describe("seed fixture", () => {
  it.each([
    "https://prod-site.example.test",
    "https://www.example.test",
    "https://other.example.org",
    "http://qa-one.example.test",
    "not a url",
  ])("blocks %s before any navigation", async (targetUrl) => {
    const page = mk();
    await expect(openSeededPage({ manifest, targetUrl, accountVariable: "QA_ACCOUNT_A", env, page, login: async () => {} })).rejects.toThrow(
      TargetBlockedError,
    );
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("navigates to an allowed target, then logs in with the credential", async () => {
    const page = mk();
    const login = vi.fn(async () => {});
    const ready = await openSeededPage({ manifest, targetUrl: "https://qa-one.example.test/path", accountVariable: "QA_ACCOUNT_A", env, page, login });
    expect(ready).toBe(page);
    expect(page.goto).toHaveBeenCalledOnce();
    expect(login).toHaveBeenCalledWith(page, "fake-credential");
  });

  it("only accounts named in the manifest, and only when set", async () => {
    const base = { manifest, targetUrl: "https://qa-one.example.test", page: mk(), login: async () => {} };
    await expect(openSeededPage({ ...base, accountVariable: "OTHER", env })).rejects.toMatchObject({ code: "account-not-in-manifest" });
    await expect(openSeededPage({ ...base, accountVariable: "QA_ACCOUNT_A", env: {} })).rejects.toThrow(SeedError);
  });

  it("blockedTargets win over the allowlist", () => {
    expect(() => assertAllowedTarget("https://qa-prod.example.test", manifest)).toThrow(TargetBlockedError);
  });
});
