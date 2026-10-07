import ts from "typescript";
import { DEFAULT_RULES } from "@hugents/core";
import type { ReasonCode, ValidationIssue, ValidatorResult } from "./contracts.js";
import type { GeneratorManifest } from "./manifest.js";

/** The only module a generated spec may import from. It exports `test` (the seed fixture) and `expect`. */
export const APPROVED_HELPER_MODULE = "hugents-seed";
export const ALLOWED_IMPORT_NAMES: ReadonlySet<string> = new Set(["test", "expect"]);
export const MAX_SPEC_CHARS = 20_000;
export const MAX_SPEC_LINES = 400;
/** The seed fixture provides `page` only. No browser, context or request fixture. */
const ALLOWED_FIXTURES: ReadonlySet<string> = new Set(["page"]);

const LOCATOR_METHODS = new Set(["getByRole", "getByLabel", "getByText", "getByTestId"]);
const ACTION_METHODS = new Set(["click", "dblclick", "check", "uncheck", "setChecked", "selectOption", "press", "fill", "tap"]);
const ALLOWED_METHODS = new Set([
  ...LOCATOR_METHODS,
  ...ACTION_METHODS,
  "hover", "focus", "blur", "waitFor", "count", "isVisible", "isHidden", "isEnabled", "first", "last", "nth",
  "describe", "step", "beforeEach",
  "toBeVisible", "toBeHidden", "toBeEnabled", "toBeDisabled", "toBeChecked", "toHaveText", "toContainText",
  "toHaveValue", "toHaveCount", "toBe", "toEqual", "toBeGreaterThan", "toBeGreaterThanOrEqual", "toBeTruthy", "toBeFalsy",
]);
const LOCATOR_DENIED = new Set(["locator", "frameLocator", "getByPlaceholder", "getByAltText", "getByTitle", "$", "$$", "$eval", "$$eval", "all", "elementHandle", "elementHandles"]);
const NETWORK_DENIED = new Set(["goto", "route", "unroute", "routeFromHAR", "request", "waitForResponse", "waitForRequest", "setExtraHTTPHeaders", "setOffline", "fetch"]);
const DENIED_PROPERTIES = new Set(["keyboard", "mouse", "touchscreen", "context", "request", "browser", "video", "tracing", "coverage", "accessibility", "mainFrame", "frames", "constructor", "prototype", "__proto__"]);
const GLOBAL_IDENTIFIERS: Record<string, ReasonCode> = {
  process: "env-access",
  Deno: "env-access",
  Bun: "env-access",
  fetch: "network-access",
  XMLHttpRequest: "network-access",
  WebSocket: "network-access",
  EventSource: "network-access",
  navigator: "network-access",
  fs: "filesystem-access",
  child_process: "process-access",
  globalThis: "api-not-allowed",
  global: "api-not-allowed",
  window: "api-not-allowed",
  document: "api-not-allowed",
  self: "api-not-allowed",
  Reflect: "api-not-allowed",
  Proxy: "api-not-allowed",
  setTimeout: "api-not-allowed",
  setInterval: "api-not-allowed",
};
const ALLOWED_GETBY_OPTION_KEYS = new Set(["name", "exact", "level", "checked", "pressed", "selected", "expanded", "disabled"]);
const URL_LIKE = /(?:^|[^a-z0-9])(?:[a-z][a-z0-9+.-]*:\/\/|(?:file|data|javascript|blob):|\/\/[a-z0-9.-]+\.[a-z]{2,}|www\.)/i;
const SECRET_RULES = DEFAULT_RULES.filter((r) => ["email", "jwt", "bearer", "google-api-key", "github-token", "long-token"].includes(r.name));

type Literal = { text: string } | undefined;

function literalOf(node: ts.Node | undefined): Literal {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text };
  if (ts.isRegularExpressionLiteral(node)) return { text: node.text };
  if (ts.isNumericLiteral(node)) return { text: node.text };
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { text: "" };
  return undefined;
}

function unwrap(node: ts.Expression): ts.Expression {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAwaitExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n)) n = n.expression;
  return n;
}

/**
 * Pure, static validation of an untrusted generated spec. Parses with the TypeScript parser and walks the AST;
 * it never executes or imports the spec. Issues carry a reason code and a line number, never source text.
 */
export function validateSpec(spec: string, manifest: Pick<GeneratorManifest, "forbiddenActions">): ValidatorResult {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const fail = (code: ReasonCode, line?: number) => {
    const key = `${code}:${line ?? 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(line === undefined ? { code } : { code, line });
  };

  if (spec.length > MAX_SPEC_CHARS || spec.split("\n").length > MAX_SPEC_LINES) {
    fail("size-limit");
    return { ok: false, issues };
  }

  const sf = ts.createSourceFile("generated.spec.ts", spec, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const parseDiagnostics = (sf as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    fail("syntax-error");
    return { ok: false, issues };
  }
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  for (const rule of SECRET_RULES) {
    if (new RegExp(rule.pattern.source, rule.pattern.flags).test(spec)) fail("secret-in-spec");
  }

  const forbidden = manifest.forbiddenActions.map((f) => f.trim().toLowerCase()).filter(Boolean);
  const consts = new Map<string, ts.Expression>();
  const localFunctions = new Set<string>();
  let testImported = false;
  let testCalls = 0;

  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      consts.set(node.name.text, node.initializer);
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) localFunctions.add(node.name.text);
    }
    if (ts.isFunctionDeclaration(node) && node.name) localFunctions.add(node.name.text);
    ts.forEachChild(node, collect);
  };
  collect(sf);

  /** Walks a receiver chain down to its root and gathers the literal text of every getBy* argument on the way. */
  const chainTexts = (start: ts.Expression, line: number): string[] => {
    const texts: string[] = [];
    const visited = new Set<string>();
    let n: ts.Expression = unwrap(start);
    for (let guard = 0; guard < 64; guard++) {
      n = unwrap(n);
      if (ts.isCallExpression(n)) {
        const callee = unwrap(n.expression);
        if (ts.isPropertyAccessExpression(callee)) {
          if (LOCATOR_METHODS.has(callee.name.text)) {
            for (const a of n.arguments) {
              if (ts.isObjectLiteralExpression(a)) {
                for (const p of a.properties) if (ts.isPropertyAssignment(p)) texts.push(literalOf(p.initializer)?.text ?? "");
              } else {
                texts.push(literalOf(a)?.text ?? "");
              }
            }
          }
          n = callee.expression;
          continue;
        }
        fail("locator-not-allowed", line);
        return texts;
      }
      if (ts.isPropertyAccessExpression(n)) {
        n = n.expression;
        continue;
      }
      if (ts.isIdentifier(n)) {
        if (n.text === "page") return texts;
        const init = consts.get(n.text);
        if (init && !visited.has(n.text)) {
          visited.add(n.text);
          n = init;
          continue;
        }
      }
      fail("locator-not-allowed", line);
      return texts;
    }
    fail("locator-not-allowed", line);
    return texts;
  };

  const visit = (node: ts.Node): void => {
    const line = lineOf(node);

    if (ts.isImportDeclaration(node)) {
      const spec_ = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : "";
      const clause = node.importClause;
      const named = clause?.namedBindings;
      if (spec_ !== APPROVED_HELPER_MODULE || !clause || clause.name || clause.isTypeOnly || !named || !ts.isNamedImports(named)) {
        fail("disallowed-import", line);
      } else {
        for (const el of named.elements) {
          const imported = (el.propertyName ?? el.name).text;
          if (!ALLOWED_IMPORT_NAMES.has(imported) || el.name.text !== imported) fail("disallowed-import", line);
          else if (imported === "test") testImported = true;
        }
      }
      return;
    }
    if (ts.isImportEqualsDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) fail("disallowed-import", line);

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) fail("dynamic-code", line);
    if (ts.isIdentifier(node) && (node.text === "eval" || node.text === "Function" || node.text === "require")) fail("dynamic-code", line);
    if (ts.isTaggedTemplateExpression(node)) fail("api-not-allowed", line);
    if (ts.isNewExpression(node)) {
      const ctor = ts.isIdentifier(node.expression) ? node.expression.text : "";
      if (ctor !== "RegExp" && ctor !== "Function") fail("api-not-allowed", line);
    }

    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isMemberName = parent && ts.isPropertyAccessExpression(parent) && parent.name === node;
      const isKey = parent && (ts.isPropertyAssignment(parent) || ts.isBindingElement(parent)) && parent.name === node;
      const code = GLOBAL_IDENTIFIERS[node.text];
      if (code && !isMemberName && !isKey) fail(code, line);
    }

    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const text = node.text;
      if (URL_LIKE.test(text)) fail("hardcoded-url", line);
      if (/(^|[:/])child_process$/.test(text)) fail("process-access", line);
      if (/^(node:)?fs(\/promises)?$/.test(text)) fail("filesystem-access", line);
    }

    if (ts.isElementAccessExpression(node)) {
      const key = node.argumentExpression;
      if (!ts.isNumericLiteral(key)) fail("api-not-allowed", line);
    }

    if (ts.isPropertyAccessExpression(node) && DENIED_PROPERTIES.has(node.name.text)) fail("api-not-allowed", line);

    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isPropertyAccessExpression(callee)) {
        const name = callee.name.text;
        if (LOCATOR_DENIED.has(name)) fail("locator-not-allowed", line);
        else if (NETWORK_DENIED.has(name)) fail("network-access", line);
        else if (!ALLOWED_METHODS.has(name)) fail("api-not-allowed", line);

        if (LOCATOR_METHODS.has(name)) {
          const [first, second] = node.arguments;
          if (!literalOf(first)) fail("locator-not-allowed", line);
          if (second) {
            if (!ts.isObjectLiteralExpression(second)) fail("locator-not-allowed", line);
            else {
              for (const p of second.properties) {
                const key = ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined;
                if (!key || !ALLOWED_GETBY_OPTION_KEYS.has(key) || !ts.isPropertyAssignment(p) || !literalOf(p.initializer)) {
                  fail("locator-not-allowed", line);
                }
              }
            }
          }
        }

        if (ACTION_METHODS.has(name)) {
          const haystack = [...chainTexts(callee.expression, line), ...node.arguments.map((a) => literalOf(a)?.text ?? "")]
            .join(" ")
            .toLowerCase();
          if (forbidden.some((f) => haystack.includes(f))) fail("forbidden-action", line);
        }
      } else if (ts.isIdentifier(callee)) {
        if (callee.text === "test") {
          testCalls++;
          const fn = node.arguments[node.arguments.length - 1];
          const param = fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) ? fn.parameters[0] : undefined;
          const names = param && ts.isObjectBindingPattern(param.name) ? param.name.elements.map((e) => (e.propertyName ?? e.name).getText(sf)) : undefined;
          if (!testImported || !names || names.length === 0 || !names.every((n) => ALLOWED_FIXTURES.has(n))) fail("missing-seed-fixture", line);
        } else if (callee.text !== "expect" && callee.text !== "eval" && callee.text !== "require" && !localFunctions.has(callee.text)) {
          fail("api-not-allowed", line);
        }
      } else {
        fail("api-not-allowed", line);
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (testCalls === 0 || !testImported) fail("missing-seed-fixture");
  return { ok: issues.length === 0, issues };
}
