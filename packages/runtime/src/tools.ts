import type { ArtifactKind, ArtifactRef } from "./artifacts.js";
import type { BoardItem, Proposal } from "./boards.js";
import { checkSchema, type Schema } from "./schema.js";

/** Capabilities an agent package may declare. Human-only ones live in `HUMAN_CAPABILITIES` and are refused here. */
export const AGENT_CAPABILITIES = ["artifact:read", "artifact:write", "board:read", "board:propose", "board:transition", "model:invoke", "env:read"] as const;
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export const MODEL_PROVIDERS = ["deterministic", "ollama", "gemini"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export interface InputArtifact {
  ref: ArtifactRef;
  mime: string;
  /** Verifies the hash again on every read. Present only with `artifact:read`. */
  read(): Promise<Buffer>;
}

/**
 * What a tool sees. Every method is gated by the agent's declared capabilities; calling one the agent did not declare
 * throws `capability-denied`. There is no handle to the registry, the store, other agents or the file system.
 */
export interface ToolContext {
  agent: { id: string; version: string };
  taskId: string;
  /** Validated against the agent's input schema, frozen. */
  input: Readonly<Record<string, unknown>>;
  artifacts: readonly InputArtifact[];
  prompt: { system: string; skills: readonly { id: string; text: string }[] };
  model: { provider: ModelProvider; model?: string };
  /** Only the variables the agent declared, read at run time. Never stored, logged or put in events. */
  env: Readonly<Record<string, string | undefined>>;
  /** Aborted on cancel, on timeout and when the attempt ends. Tools release resources when it fires. */
  signal: AbortSignal;
  /** Board items, with `board:read`. Reading an item makes its artifacts readable and attachable for this task. */
  readItem(id: string): Promise<BoardItem | undefined>;
  /** Bytes of an input artifact or of one attached to an item read in this task, with `artifact:read`. Hash-checked. */
  readArtifact(id: string): Promise<{ ref: ArtifactRef; mime: string; bytes: Buffer }>;
  writeArtifact(kind: ArtifactKind, mime: string, data: Uint8Array | string): Promise<ArtifactRef>;
  sanitize(text: string, max: number): string;
  reportUsage(usage: { tokens?: number; costUsd?: number }): void;
}

export interface ToolOutput {
  output: unknown;
  /** New board items. All are validated before any is written. */
  proposals?: Proposal[];
  /** Agent transitions on existing items, applied after the proposals. */
  transitions?: { itemId: string; to: string; reason?: string }[];
}

export interface ToolDefinition {
  /** `<plugin>.<action>`, e.g. `design-critic.review`. */
  name: string;
  version: string;
  description: string;
  /** Capabilities the agent must declare to use this tool. */
  requires: readonly AgentCapability[];
  /** Environment variable names the tool reads. The agent must declare them too. */
  env?: readonly string[];
  inputSchema: Schema;
  outputSchema: Schema;
  run(ctx: ToolContext): Promise<ToolOutput>;
}

const TOOL_NAME = /^[a-z][a-z0-9-]{0,31}\.[a-z][a-z0-9-]{0,31}$/;

/** Closed set of tools known to this runtime. Agent packages pick from it; they cannot bring code. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (!TOOL_NAME.test(tool.name)) throw new Error(`invalid tool name`);
    if (this.tools.has(tool.name)) throw new Error(`tool already registered: ${tool.name}`);
    if (checkSchema(tool.inputSchema).length || checkSchema(tool.outputSchema).length) throw new Error(`tool ${tool.name}: invalid schema`);
    if (!tool.requires.every((c) => (AGENT_CAPABILITIES as readonly string[]).includes(c))) throw new Error(`tool ${tool.name}: unknown capability`);
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }
}
