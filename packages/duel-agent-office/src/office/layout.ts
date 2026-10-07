import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { OFFICE_AGENT_IDS, type OfficeAgentId } from "./contract.js";

/**
 * Visual layout of the QA bullpen (the design's layout editor). It only says where props stand, how they face,
 * their material and which agent uses which desk. It has no field for permissions, credentials, game logic or
 * agent rules, and nothing in it reaches the bridge or the runner.
 */

export const GRID = { w: 10, h: 8 } as const;

/** Footprint in tiles at rotation 0 (90 swaps w and h). Rugs lie on the floor and do not block other props. */
export const PROP_TYPES = {
  desk: { w: 3, h: 2, blocking: true, label: "Desk" },
  plant: { w: 1, h: 1, blocking: true, label: "Plant" },
  cabinet: { w: 1, h: 1, blocking: true, label: "Cabinet" },
  bookshelf: { w: 1, h: 2, blocking: true, label: "Bookshelf" },
  rug: { w: 3, h: 2, blocking: false, label: "Rug" },
} as const;
export type PropType = keyof typeof PROP_TYPES;

export const MATERIALS = ["wood", "dark", "metal", "paper"] as const;
export type Material = (typeof MATERIALS)[number];

export interface LayoutProp {
  id: string;
  type: PropType;
  x: number;
  y: number;
  rot: 0 | 90;
  material: Material;
  /** Desks only: the desk number shown to people ("Desk 3"). */
  n?: number;
  /** Desks only: the agent who works here. */
  agent?: OfficeAgentId;
}

export interface OfficeLayout {
  version: 1;
  props: LayoutProp[];
}

export const MAX_PROPS = 40;

export const DEFAULT_LAYOUT: OfficeLayout = {
  version: 1,
  props: [
    { id: "rug-1", type: "rug", x: 4, y: 3, rot: 0, material: "wood" },
    { id: "bookshelf-1", type: "bookshelf", x: 0, y: 6, rot: 0, material: "wood" },
    { id: "cabinet-1", type: "cabinet", x: 9, y: 0, rot: 0, material: "metal" },
    { id: "desk-1", type: "desk", x: 1, y: 2, rot: 0, material: "wood", n: 1, agent: "player-alpha" },
    { id: "desk-2", type: "desk", x: 6, y: 2, rot: 0, material: "wood", n: 2, agent: "explorer" },
    { id: "desk-3", type: "desk", x: 1, y: 5, rot: 0, material: "wood", n: 3, agent: "qa-analyst" },
    { id: "desk-4", type: "desk", x: 6, y: 5, rot: 0, material: "wood", n: 4, agent: "design-critic" },
  ],
};

export function footprint(p: Pick<LayoutProp, "type" | "rot">): { w: number; h: number } {
  const t = PROP_TYPES[p.type];
  return p.rot === 90 ? { w: t.h, h: t.w } : { w: t.w, h: t.h };
}

const ID = /^[a-z0-9-]{1,24}$/;
const int = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Checks a layout from the page. Returns the cleaned layout (only known fields) or the first problem in plain words. */
export function validateLayout(input: unknown): { ok: true; layout: OfficeLayout } | { ok: false; error: string } {
  const raw = input && typeof input === "object" ? (input as { version?: unknown; props?: unknown }) : {};
  if (raw.version !== 1 || !Array.isArray(raw.props)) return { ok: false, error: "Not a layout" };
  if (raw.props.length > MAX_PROPS) return { ok: false, error: `A layout holds at most ${MAX_PROPS} props` };
  const props: LayoutProp[] = [];
  const ids = new Set<string>();
  const numbers = new Set<number>();
  const agents = new Set<string>();
  for (const item of raw.props as unknown[]) {
    const p = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (typeof p.id !== "string" || !ID.test(p.id) || ids.has(p.id)) return { ok: false, error: "Every prop needs its own id" };
    if (typeof p.type !== "string" || !Object.hasOwn(PROP_TYPES, p.type)) return { ok: false, error: "Unknown prop type" };
    const type = p.type as PropType;
    if (p.rot !== 0 && p.rot !== 90) return { ok: false, error: "Rotation must be 0 or 90" };
    if (!(MATERIALS as readonly unknown[]).includes(p.material)) return { ok: false, error: "Unknown material" };
    const { w, h } = footprint({ type, rot: p.rot });
    if (!int(p.x, 0, GRID.w - w) || !int(p.y, 0, GRID.h - h)) return { ok: false, error: `${PROP_TYPES[type].label} is outside the room` };
    const prop: LayoutProp = { id: p.id, type, x: p.x as number, y: p.y as number, rot: p.rot, material: p.material as Material };
    if (type === "desk") {
      if (!int(p.n, 1, 99) || numbers.has(p.n as number)) return { ok: false, error: "Every desk needs its own number" };
      prop.n = p.n as number;
      numbers.add(prop.n);
      if (p.agent !== undefined) {
        if (!(OFFICE_AGENT_IDS as readonly unknown[]).includes(p.agent) || agents.has(p.agent as string)) return { ok: false, error: "An agent can use only one desk" };
        prop.agent = p.agent as OfficeAgentId;
        agents.add(prop.agent);
      }
    } else if (p.n !== undefined || p.agent !== undefined) {
      return { ok: false, error: "Only desks have a number or an agent" };
    }
    ids.add(prop.id);
    props.push(prop);
  }
  const taken = new Map<string, string>();
  for (const p of props) {
    if (!PROP_TYPES[p.type].blocking) continue;
    const { w, h } = footprint(p);
    for (let x = p.x; x < p.x + w; x++) {
      for (let y = p.y; y < p.y + h; y++) {
        const other = taken.get(`${x},${y}`);
        if (other) return { ok: false, error: `${PROP_TYPES[p.type].label} overlaps another prop` };
        taken.set(`${x},${y}`, p.id);
      }
    }
  }
  return { ok: true, layout: { version: 1, props } };
}

export interface LayoutStore {
  get(): Promise<OfficeLayout>;
  save(input: unknown): Promise<{ status: number; body: { layout?: OfficeLayout; error?: string } }>;
}

/** Layout kept in a JSON file. A missing or invalid file means the default layout. */
export function fileLayoutStore(options: { file: string; readonly: boolean }): LayoutStore {
  return {
    async get() {
      try {
        const checked = validateLayout(JSON.parse(await readFile(options.file, "utf8")));
        return checked.ok ? checked.layout : structuredClone(DEFAULT_LAYOUT);
      } catch {
        return structuredClone(DEFAULT_LAYOUT);
      }
    },
    async save(input) {
      if (options.readonly) return { status: 403, body: { error: "The office is read-only" } };
      const checked = validateLayout(input);
      if (!checked.ok) return { status: 400, body: { error: checked.error } };
      await mkdir(path.dirname(options.file), { recursive: true });
      await writeFile(`${options.file}.tmp`, JSON.stringify(checked.layout, null, 2));
      await rename(`${options.file}.tmp`, options.file);
      return { status: 200, body: { layout: checked.layout } };
    },
  };
}
