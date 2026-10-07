import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.js";

describe("redact", () => {
  it("removes known secret values wherever they appear", () => {
    const out = redact("login as qa@qa.invalid with hunter2-pass failed", ["hunter2-pass", "qa@qa.invalid"]);
    expect(out).not.toContain("hunter2-pass");
    expect(out).not.toContain("qa@qa.invalid");
  });

  it("replaces the longer secret first so no suffix leaks", () => {
    const out = redact("value abcdefgh", ["abc", "abcdefgh"]);
    expect(out).toBe("value [redacted]");
  });

  it("strips query strings and token parameters from URLs", () => {
    const out = redact("GET https://db.example.com/rooms.json?auth=SECRETVALUE&x=1 failed");
    expect(out).toBe("GET https://db.example.com/rooms.json failed");
  });

  it("redacts bearer headers, e-mail addresses and JWT-like tokens", () => {
    const jwt = "eyJhbGciOiJSUzI1NiIs1234.eyJzdWIiOiJhYmMxMjM0NTY3ODkw.c2lnbmF0dXJlVmFsdWU";
    expect(redact(`Authorization: Bearer ${jwt}`)).not.toContain("eyJ");
    expect(redact(`token ${jwt}`)).not.toContain("eyJ");
    expect(redact("mail someone@example.com now")).not.toContain("someone@example.com");
  });

  it("keeps ordinary hyphenated words readable", () => {
    expect(redact("Planning private-match-full-game with two isolated players")).toBe(
      "Planning private-match-full-game with two isolated players",
    );
  });
});
