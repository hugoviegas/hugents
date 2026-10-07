import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { StoreError, type HugentsEvent, type Store, type Task, type TaskStatus } from "@hugents/core";
import { createSerialQueue } from "./util.js";

/**
 * Local persistence: one JSON file per collection, written atomically (temp file + rename), the same mechanism the
 * office already uses for `agent-config.json` and `tasks.json`. No new backend. Without a directory it is in-memory.
 *
 * ponytail: whole-file rewrite per mutation and a single-process writer; move to SQLite behind the same `Db` (and the
 * core `Store` interface) when collections grow past a few MB or a second process writes.
 */
export interface Db {
  read<T>(collection: string): Promise<Record<string, T>>;
  /** Runs `fn` on a private copy and persists it only if `fn` returns without throwing. Mutations are serialized. */
  mutate<T, R>(collection: string, fn: (data: Record<string, T>) => R | Promise<R>): Promise<R>;
}

const COLLECTION = /^[a-z][a-z0-9-]{0,31}$/;

export function createDb(dir?: string): Db {
  const cache = new Map<string, Record<string, unknown>>();
  const serial = createSerialQueue();

  async function load(collection: string): Promise<Record<string, unknown>> {
    if (!COLLECTION.test(collection)) throw new Error("invalid collection");
    const hit = cache.get(collection);
    if (hit) return hit;
    let data: Record<string, unknown> = {};
    if (dir) {
      try {
        data = JSON.parse(await readFile(path.join(dir, `${collection}.json`), "utf8")) as Record<string, unknown>;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    cache.set(collection, data);
    return data;
  }

  return {
    async read<T>(collection: string) {
      return structuredClone(await load(collection)) as Record<string, T>;
    },
    mutate<T, R>(collection: string, fn: (data: Record<string, T>) => R | Promise<R>) {
      return serial(async () => {
        const draft = structuredClone(await load(collection)) as Record<string, T>;
        const result = await fn(draft);
        if (dir) {
          await mkdir(dir, { recursive: true });
          const file = path.join(dir, `${collection}.json`);
          await writeFile(`${file}.tmp`, JSON.stringify(draft, null, 1));
          await rename(`${file}.tmp`, file);
        }
        cache.set(collection, draft as Record<string, unknown>);
        return result;
      });
    },
  };
}

/** The core `Store` over the same files, so runtime events and tasks reload after a restart. */
export class FileStore implements Store {
  constructor(private readonly db: Db) {}

  async appendEvent(sessionId: string, event: HugentsEvent): Promise<void> {
    if (event.origin !== "live") throw new StoreError("demo events never enter live state");
    await this.db.mutate<HugentsEvent[], void>("events", (all) => {
      const list = all[sessionId] ?? [];
      const last = list[list.length - 1];
      if (last && event.seq <= last.seq) throw new StoreError("seq must increase");
      list.push({ ...event });
      all[sessionId] = list;
    });
  }

  async listEvents(sessionId: string, afterSeq = -1): Promise<HugentsEvent[]> {
    return ((await this.db.read<HugentsEvent[]>("events"))[sessionId] ?? []).filter((e) => e.seq > afterSeq);
  }

  async upsertTask(task: Task): Promise<void> {
    await this.db.mutate<Task, void>("core-tasks", (all) => {
      all[task.id] = { ...task, params: { ...task.params } };
    });
  }

  async getTask(id: string): Promise<Task | undefined> {
    return (await this.db.read<Task>("core-tasks"))[id];
  }

  async listTasks(status?: TaskStatus): Promise<Task[]> {
    return Object.values(await this.db.read<Task>("core-tasks")).filter((t) => !status || t.status === status);
  }
}
