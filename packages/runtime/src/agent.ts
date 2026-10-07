import { AGENT_IDS, type AgentId } from "@hugents/core";
import { ARTIFACT_KINDS, type ArtifactKind } from "./artifacts.js";
import { BOARDS, BOARD_IDS, HUMAN_CAPABILITIES, type BoardId } from "./boards.js";
import type { Issue, RuntimeReasonCode } from "./errors.js";
import { checkSchema, isCompatible, type Schema } from "./schema.js";
import { AGENT_CAPABILITIES, MODEL_PROVIDERS, type AgentCapability, type ModelProvider, type ToolRegistry } from "./tools.js";
import { canonicalJson, isObject, looksSecret, sha256 } from "./util.js";

/**
 * An agent is data: a directory (or bundle) with `agent.json`, a system prompt, skills and input/output schemas. The
 * runtime never branches on an agent id; behavior comes from the tools the package selects from the closed registry.
 * See docs/agent-runtime.md for the layout.
 */
export const AGENT_SCHEMA_VERSION = 1;
export const MANIFEST_FILE = "agent.json";

export interface AgentLimits {
  timeoutMs: number;
  maxRetries: number;
  maxConcurrency: number;
  maxInputArtifacts: number;
  maxOutputBytes: number;
  maxTokens: number;
}

export interface AgentManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  identity: { name: string; role: string; description: string };
  /** Office character this agent animates in core events. Absent: events use `system`. */
  officeAgent?: AgentId;
  model: { provider: ModelProvider; model?: string };
  prompt: { system: string };
  skills: { id: string; file: string }[];
  /** The tool the runner calls. Must be listed in `tools`. */
  entry: string;
  tools: string[];
  capabilities: AgentCapability[];
  input: string;
  output: string;
  limits: AgentLimits;
  artifacts: { accepts: ArtifactKind[]; produces: ArtifactKind[] };
  boards: { produces: { board: BoardId; state: string }[]; transitions: { board: BoardId; from: string; to: string }[] };
  /** Agents cannot opt out: every output they put on a board waits for a human where the board requires one. */
  approval: { outputRequiresHuman: true };
  /** Names of environment variables the tools may read. Names only, never values. */
  env: string[];
}

export interface AgentDefinition {
  manifest: AgentManifest;
  prompt: { system: string; skills: { id: string; text: string }[] };
  inputSchema: Schema;
  outputSchema: Schema;
  /** SHA-256 over every file of the package (LF-normalized). Identifies the exact version content. */
  contentHash: string;
  files: Record<string, string>;
}

export const AGENT_LIMITS = {
  maxFiles: 32,
  maxPackageBytes: 256 * 1024,
  maxManifestBytes: 32 * 1024,
  maxSchemaBytes: 32 * 1024,
  maxPromptChars: 16_000,
  maxSkillChars: 8_000,
  maxSkills: 16,
  maxTools: 16,
  maxEnv: 16,
} as const;

const LIMIT_RANGES: Record<keyof AgentLimits, [number, number]> = {
  timeoutMs: [100, 600_000],
  maxRetries: [0, 5],
  maxConcurrency: [1, 8],
  maxInputArtifacts: [0, 50],
  maxOutputBytes: [1, 256 * 1024],
  maxTokens: [0, 1_000_000],
};

const FIELDS = [
  "schemaVersion", "id", "version", "identity", "officeAgent", "model", "prompt", "skills", "entry", "tools",
  "capabilities", "input", "output", "limits", "artifacts", "boards", "approval", "env",
] as const;
const OPTIONAL = new Set(["officeAgent"]);

export const AGENT_ID = /^[a-z][a-z0-9-]{1,47}$/;
export const SEMVER = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
const SKILL_ID = /^[a-z][a-z0-9-]{0,47}$/;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const FILE_PATH = /^(?:[a-z0-9][a-z0-9_-]{0,31}\/){0,2}[a-z0-9][a-z0-9._-]{0,63}\.(?:json|md)$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Variables that change how the process itself runs. An agent never reads them. */
const RESERVED_ENV = /^(?:PATH|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|SHELL|COMSPEC|SYSTEMROOT|NODE_OPTIONS|NODE_PATH|NODE_TLS_REJECT_UNAUTHORIZED|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_[A-Z0-9_]*|NPM_[A-Z0-9_]*|GIT_[A-Z0-9_]*)$/;
/** Prefixes bundlers expose to browsers. A secret behind one of these is already public. */
const CLIENT_EXPOSED_ENV = /^(?:NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_|GATSBY_|PUBLIC_)/;

export type AgentParseResult = { ok: true; agent: AgentDefinition } | { ok: false; issues: Issue[] };

export interface AgentPackage {
  /** Relative POSIX path -> UTF-8 text. */
  files: Record<string, string>;
}

const lf = (s: string) => s.replace(/\r\n?/g, "\n");

export function packageHash(files: Record<string, string>): string {
  return sha256(canonicalJson(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, lf(v)]))));
}

/**
 * Validates a whole package against the tool registry and the board catalog. Fails closed: any issue rejects the
 * package. Issues carry a code and a path (file path or JSON path), never the offending value.
 */
export function parseAgentPackage(pkg: unknown, tools: ToolRegistry): AgentParseResult {
  const issues: Issue[] = [];
  const add = (code: RuntimeReasonCode, path: string) => void issues.push({ code, path });
  const fail = (): AgentParseResult => ({ ok: false, issues });

  // ---- files -------------------------------------------------------------------------------------------------
  if (!isObject(pkg) || !isObject(pkg.files)) return add("not-an-object", "$"), fail();
  const entries = Object.entries(pkg.files);
  if (entries.length > AGENT_LIMITS.maxFiles) return add("too-many-items", "files"), fail();
  const files: Record<string, string> = {};
  let total = 0;
  for (const [name, content] of entries) {
    if (!FILE_PATH.test(name) || name.includes("..")) {
      add("unsafe-path", "files");
      continue;
    }
    if (typeof content !== "string") {
      add("invalid-type", name);
      continue;
    }
    total += Buffer.byteLength(content, "utf8");
    files[name] = lf(content);
  }
  if (total > AGENT_LIMITS.maxPackageBytes) add("too-large", "files");
  if (issues.length) return fail();

  const manifestText = files[MANIFEST_FILE];
  if (manifestText === undefined) return add("missing-file", MANIFEST_FILE), fail();
  if (Buffer.byteLength(manifestText, "utf8") > AGENT_LIMITS.maxManifestBytes) return add("too-large", MANIFEST_FILE), fail();
  let raw: unknown;
  try {
    raw = JSON.parse(manifestText);
  } catch {
    return add("invalid-json", MANIFEST_FILE), fail();
  }
  if (!isObject(raw)) return add("not-an-object", MANIFEST_FILE), fail();

  // ---- secrets anywhere in the manifest ------------------------------------------------------------------------
  (function scan(v: unknown, path: string) {
    if (typeof v === "string") {
      if (looksSecret(v)) add("secret-shaped", path);
    } else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${path}[${i}]`));
    else if (isObject(v)) for (const [k, x] of Object.entries(v)) scan(x, `${path}.${k}`);
  })(raw, "$");

  for (const key of Object.keys(raw)) if (!(FIELDS as readonly string[]).includes(key)) add("unknown-field", `$.${key}`);
  for (const key of FIELDS) if (raw[key] === undefined && !OPTIONAL.has(key)) add("missing-field", `$.${key}`);
  if (issues.length) return fail();

  const str = (path: string, v: unknown, max: number, shape?: RegExp): string | undefined => {
    if (typeof v !== "string") return add("invalid-type", path), undefined;
    if (!v.trim()) return add("invalid-value", path), undefined;
    if (v.length > max) return add("too-long", path), undefined;
    if (shape && !shape.test(v)) return add("invalid-value", path), undefined;
    return v;
  };
  const obj = (path: string, v: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> | undefined => {
    if (!isObject(v)) return add("invalid-type", path), undefined;
    for (const k of Object.keys(v)) if (!keys.includes(k)) add("unknown-field", `${path}.${k}`);
    for (const k of keys) if (v[k] === undefined && !optional.includes(k)) add("missing-field", `${path}.${k}`);
    return v;
  };
  const list = <T>(path: string, v: unknown, max: number, each: (x: unknown, p: string) => T | undefined): T[] => {
    if (!Array.isArray(v)) return add("invalid-type", path), [];
    if (v.length > max) return add("too-many-items", path), [];
    const out: T[] = [];
    v.forEach((x, i) => {
      const r = each(x, `${path}[${i}]`);
      if (r !== undefined) out.push(r);
    });
    if (new Set(out.map((x) => canonicalJson(x))).size !== out.length) add("duplicate", path);
    return out;
  };
  const oneOf = <T extends string>(allowed: readonly T[]) => (x: unknown, p: string): T | undefined =>
    typeof x === "string" && (allowed as readonly string[]).includes(x) ? (x as T) : (add("invalid-value", p), undefined);

  // ---- scalar fields --------------------------------------------------------------------------------------------
  if (raw.schemaVersion !== AGENT_SCHEMA_VERSION) add("invalid-value", "$.schemaVersion");
  const id = str("$.id", raw.id, 48, AGENT_ID);
  const version = str("$.version", raw.version, 16, SEMVER);
  const identityRaw = obj("$.identity", raw.identity, ["name", "role", "description"]);
  const identity = identityRaw && {
    name: str("$.identity.name", identityRaw.name, 40),
    role: str("$.identity.role", identityRaw.role, 60),
    description: str("$.identity.description", identityRaw.description, 300),
  };
  const officeAgent = raw.officeAgent === undefined ? undefined : oneOf(AGENT_IDS)(raw.officeAgent, "$.officeAgent");
  const modelRaw = obj("$.model", raw.model, ["provider", "model"], ["model"]);
  const provider = modelRaw && oneOf(MODEL_PROVIDERS)(modelRaw.provider, "$.model.provider");
  const modelName = modelRaw?.model === undefined ? undefined : str("$.model.model", modelRaw.model, 64, MODEL_NAME);

  // ---- prompt and skills ----------------------------------------------------------------------------------------
  const referenced = new Set<string>([MANIFEST_FILE]);
  const fileText = (path: string, v: unknown, max: number, ext: ".md" | ".json"): string | undefined => {
    const name = str(path, v, 100, FILE_PATH);
    if (!name) return undefined;
    if (!name.endsWith(ext)) return add("invalid-value", path), undefined;
    const text = files[name];
    if (text === undefined) return add("missing-file", name), undefined;
    referenced.add(name);
    if (text.length > max) return add("too-long", name), undefined;
    if (!text.trim()) return add("invalid-value", name), undefined;
    if (looksSecret(text)) return add("secret-shaped", name), undefined;
    return text;
  };
  const promptRaw = obj("$.prompt", raw.prompt, ["system"]);
  const system = promptRaw && fileText("$.prompt.system", promptRaw.system, AGENT_LIMITS.maxPromptChars, ".md");
  const skills = list("$.skills", raw.skills, AGENT_LIMITS.maxSkills, (x, p) => {
    const s = obj(p, x, ["id", "file"]);
    if (!s) return undefined;
    const sid = str(`${p}.id`, s.id, 48, SKILL_ID);
    const text = fileText(`${p}.file`, s.file, AGENT_LIMITS.maxSkillChars, ".md");
    return sid && text !== undefined ? { id: sid, text } : undefined;
  });
  if (new Set(skills.map((s) => s.id)).size !== skills.length) add("duplicate", "$.skills");

  // ---- schemas ------------------------------------------------------------------------------------------------
  const schemaFile = (path: string, v: unknown): Schema | undefined => {
    const text = fileText(path, v, AGENT_LIMITS.maxSchemaBytes, ".json");
    if (text === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return add("invalid-json", String(v)), undefined;
    }
    const problems = checkSchema(parsed);
    if (problems.length) return issues.push(...problems.map((i) => ({ ...i, path: `${String(v)}:${i.path}` }))), undefined;
    if ((parsed as Schema).type !== "object") return add("invalid-schema", String(v)), undefined;
    return parsed as Schema;
  };
  const inputSchema = schemaFile("$.input", raw.input);
  const outputSchema = schemaFile("$.output", raw.output);

  // ---- tools and capabilities ---------------------------------------------------------------------------------
  const toolNames = list("$.tools", raw.tools, AGENT_LIMITS.maxTools, (x, p) => {
    if (typeof x !== "string") return add("invalid-type", p), undefined;
    if (!tools.get(x)) return add("unknown-tool", p), undefined;
    return x;
  });
  const entry = str("$.entry", raw.entry, 65);
  if (entry && !toolNames.includes(entry)) add(tools.get(entry) ? "invalid-value" : "unknown-tool", "$.entry");
  const capabilities = list("$.capabilities", raw.capabilities, AGENT_CAPABILITIES.length + HUMAN_CAPABILITIES.length, (x, p) => {
    if ((HUMAN_CAPABILITIES as readonly unknown[]).includes(x)) return add("human-only-capability", p), undefined;
    return oneOf(AGENT_CAPABILITIES)(x, p);
  });
  const has = (c: AgentCapability) => capabilities.includes(c);
  const env = list("$.env", raw.env, AGENT_LIMITS.maxEnv, (x, p) => {
    if (typeof x !== "string" || !ENV_NAME.test(x) || RESERVED_ENV.test(x)) return add("unsafe-env-name", p), undefined;
    if (CLIENT_EXPOSED_ENV.test(x)) return add("client-exposed-env", p), undefined;
    return x;
  });
  for (const name of toolNames) {
    const tool = tools.get(name)!;
    for (const c of tool.requires) if (!has(c)) add("undeclared-capability", `$.tools.${name}:${c}`);
    for (const e of tool.env ?? []) if (!env.includes(e)) add("undeclared-capability", `$.tools.${name}:env`);
  }
  if (env.length && !has("env:read")) add("undeclared-capability", "$.env");
  if (provider && provider !== "deterministic" && !has("model:invoke")) add("undeclared-capability", "$.model.provider");
  const entryTool = entry ? tools.get(entry) : undefined;
  if (entryTool && inputSchema && !isCompatible(inputSchema, entryTool.inputSchema)) add("schema-incompatible", "$.input");
  if (entryTool && outputSchema && !isCompatible(entryTool.outputSchema, outputSchema)) add("schema-incompatible", "$.output");

  // ---- limits ---------------------------------------------------------------------------------------------------
  const limitsRaw = obj("$.limits", raw.limits, Object.keys(LIMIT_RANGES));
  const limits = {} as AgentLimits;
  if (limitsRaw) {
    for (const [k, [min, max]] of Object.entries(LIMIT_RANGES) as [keyof AgentLimits, [number, number]][]) {
      const v = limitsRaw[k];
      if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) add("invalid-value", `$.limits.${k}`);
      else limits[k] = v;
    }
  }

  // ---- artifacts and boards -----------------------------------------------------------------------------------
  const artifactsRaw = obj("$.artifacts", raw.artifacts, ["accepts", "produces"]);
  const accepts = list("$.artifacts.accepts", artifactsRaw?.accepts ?? [], ARTIFACT_KINDS.length, oneOf(ARTIFACT_KINDS));
  const produces = list("$.artifacts.produces", artifactsRaw?.produces ?? [], ARTIFACT_KINDS.length, oneOf(ARTIFACT_KINDS));
  if (accepts.length && !has("artifact:read")) add("undeclared-capability", "$.artifacts.accepts");
  if (produces.length && !has("artifact:write")) add("undeclared-capability", "$.artifacts.produces");

  const boardsRaw = obj("$.boards", raw.boards, ["produces", "transitions"]);
  const boardOf = (x: unknown, p: string): BoardId | undefined =>
    (BOARD_IDS as readonly unknown[]).includes(x) ? (x as BoardId) : (add("unknown-board", p), undefined);
  const boardProduces = list("$.boards.produces", boardsRaw?.produces ?? [], 8, (x, p) => {
    const o = obj(p, x, ["board", "state"]);
    const board = o && boardOf(o.board, `${p}.board`);
    if (!o || !board) return undefined;
    if (typeof o.state !== "string" || !BOARDS[board].initial.includes(o.state)) return add("invalid-board-transition", `${p}.state`), undefined;
    return { board, state: o.state };
  });
  const boardTransitions = list("$.boards.transitions", boardsRaw?.transitions ?? [], 16, (x, p) => {
    const o = obj(p, x, ["board", "from", "to"]);
    const board = o && boardOf(o.board, `${p}.board`);
    if (!o || !board) return undefined;
    const def = BOARDS[board].transitions.find((t) => t.from === o.from && t.to === o.to);
    // agents may only declare transitions the board reserves for agents; approvals are always human
    if (!def || def.by !== "agent") return add("invalid-board-transition", p), undefined;
    return { board, from: def.from, to: def.to };
  });
  if (boardProduces.length && !has("board:propose")) add("undeclared-capability", "$.boards.produces");
  if (boardTransitions.length && !has("board:transition")) add("undeclared-capability", "$.boards.transitions");

  const approvalRaw = obj("$.approval", raw.approval, ["outputRequiresHuman"]);
  if (approvalRaw && approvalRaw.outputRequiresHuman !== true) add("invalid-value", "$.approval.outputRequiresHuman");

  for (const name of Object.keys(files)) if (!referenced.has(name)) add("unreferenced-file", name);
  if (issues.length || !id || !version || !identity?.name || !identity.role || !identity.description || !provider || !entry || system === undefined || !inputSchema || !outputSchema) {
    if (!issues.length) add("invalid-value", "$");
    return fail();
  }

  const manifest: AgentManifest = {
    schemaVersion: 1,
    id,
    version,
    identity: { name: identity.name, role: identity.role, description: identity.description },
    ...(officeAgent ? { officeAgent } : {}),
    model: { provider, ...(modelName ? { model: modelName } : {}) },
    prompt: { system: (raw.prompt as { system: string }).system },
    skills: (raw.skills as { id: string; file: string }[]).map((s) => ({ id: s.id, file: s.file })),
    entry,
    tools: toolNames,
    capabilities,
    input: raw.input as string,
    output: raw.output as string,
    limits,
    artifacts: { accepts, produces },
    boards: { produces: boardProduces, transitions: boardTransitions },
    approval: { outputRequiresHuman: true },
    env,
  };
  return { ok: true, agent: { manifest, prompt: { system, skills }, inputSchema, outputSchema, contentHash: packageHash(files), files } };
}
