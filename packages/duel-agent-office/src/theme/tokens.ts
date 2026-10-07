import tokens from "./tokens.json";

/**
 * Agent Office design tokens (Claude Design system "Agent Office", `tokens.json` copied verbatim into this folder).
 * This module turns them into CSS custom properties, one block per theme, so the local QA view and the
 * AgentOffice HUD patch share one source. To re-sync: replace `tokens.json`, then `npm run office:theme`.
 */

type Themed = string | Record<string, string>;
interface TokenEntry {
  name: string;
  value: Themed;
}
interface TypeStyle {
  name: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing?: string;
}

const source = tokens as unknown as {
  color: { themes: { id: string; name: string }[]; tokens: TokenEntry[] };
  type: { families: Record<string, string>; groups: { family: string; styles: TypeStyle[] }[] };
  spacing: { tokens: TokenEntry[] };
  radius: { tokens: TokenEntry[] };
  shadow: { tokens: TokenEntry[] };
  duration: { tokens: TokenEntry[] };
  easing: { tokens: TokenEntry[] };
};

export const THEMES = source.color.themes.map((t) => ({ id: t.id, name: t.name }));
export const DEFAULT_THEME = THEMES[0]?.id ?? "workshop";

/**
 * Identity colors for the runner's own agents. The design system names four office agents; the runner's
 * agents borrow their stripes so every desk keeps a distinct color (assumption until the system adds them).
 */
const IDENTITY_ALIASES: Record<string, string> = {
  "agent-bravo": "agent-explorer",
  "agent-report": "agent-analyst",
  "agent-runner": "agent-critic",
};

const valueFor = (value: Themed, theme: string): string | undefined =>
  typeof value === "string" ? (theme === DEFAULT_THEME ? value : undefined) : (value[theme] ?? value[DEFAULT_THEME]);

/** Resolves `{other-token}` aliases inside one theme. Unknown or circular aliases resolve to nothing. */
function resolveColors(theme: string): Map<string, string> {
  const raw = new Map(source.color.tokens.map((t) => [t.name, valueFor(t.value, theme)]));
  const resolve = (name: string, seen: Set<string>): string | undefined => {
    const v = raw.get(name);
    const alias = v ? /^\{([A-Za-z0-9_.-]+)\}$/.exec(v) : null;
    if (!alias) return v;
    const target = alias[1] as string;
    if (seen.has(target)) return undefined;
    return resolve(target, new Set([...seen, target]));
  };
  const out = new Map<string, string>();
  for (const name of raw.keys()) {
    const v = resolve(name, new Set([name]));
    if (v) out.set(name, v);
  }
  for (const [alias, target] of Object.entries(IDENTITY_ALIASES)) {
    const v = out.get(target);
    if (v) out.set(alias, v);
  }
  return out;
}

const decl = (name: string, value: string) => `  --${name}: ${value};`;

/** The full token stylesheet: theme-independent tokens on `:root`, colors and shadows per `data-theme`. */
export function themeCss(): string {
  const lines: string[] = [];
  lines.push(":root {");
  for (const [key, family] of Object.entries(source.type.families)) lines.push(decl(`font-${key}`, family));
  for (const group of source.type.groups) {
    for (const s of group.styles) {
      lines.push(decl(`type-${s.name}`, `${s.fontWeight} ${s.fontSize}/${s.lineHeight} var(--font-${group.family})`));
      if (s.letterSpacing) lines.push(decl(`type-${s.name}-tracking`, s.letterSpacing));
    }
  }
  for (const family of [source.spacing, source.radius, source.duration, source.easing]) {
    for (const t of family.tokens) if (typeof t.value === "string") lines.push(decl(t.name, t.value));
  }
  lines.push("}");
  for (const { id } of THEMES) {
    const selector = id === DEFAULT_THEME ? `:root, [data-theme="${id}"]` : `[data-theme="${id}"]`;
    lines.push(`${selector} {`);
    lines.push(`  color-scheme: ${id === "light" ? "light" : "dark"};`);
    for (const [name, value] of resolveColors(id)) lines.push(decl(name, value));
    for (const t of source.shadow.tokens) {
      const v = valueFor(t.value, id);
      if (v) lines.push(decl(t.name, v));
    }
    lines.push("}");
  }
  return lines.join("\n") + "\n";
}
