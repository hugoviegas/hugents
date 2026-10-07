import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { officeThemeCss } from "../src/theme/office.js";
import { DEFAULT_THEME, THEMES, themeCss } from "../src/theme/tokens.js";

describe("Agent Office theme", () => {
  it("emits every theme of the design system, with aliases resolved", () => {
    const css = themeCss();
    expect(THEMES.map((t) => t.id)).toEqual(["workshop", "outpost", "night", "light"]);
    expect(DEFAULT_THEME).toBe("workshop");
    expect(css).toContain(':root, [data-theme="workshop"] {');
    for (const t of THEMES) expect(css).toContain(`[data-theme="${t.id}"]`);
    expect(css).not.toMatch(/\{[a-z-]+\}/);
    // state-working is an alias of accent-primary; light theme uses its own value.
    const light = css.slice(css.indexOf('[data-theme="light"]'));
    expect(light).toMatch(/--state-working: #0F766E;/);
    expect(css).toMatch(/--agent-bravo: #9BC25A;/);
  });

  it("keeps the AgentOffice copy in office/theme in sync with the tokens", async () => {
    // A Windows checkout with core.autocrlf may turn LF into CRLF; line endings are not drift.
    const committed = (await readFile(path.join(process.cwd(), "office", "theme", "agent-office.css"), "utf8")).replace(/\r\n/g, "\n");
    expect(committed, "run npm run office:theme").toBe(officeThemeCss());
  });
});
