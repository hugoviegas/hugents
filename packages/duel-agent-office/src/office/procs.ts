import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The runner processes this office started, and nothing else. Each one is written to a small file the moment it starts, so a
 * crashed office can still find (and stop) the browsers it left behind. Cleanup only touches a recorded pid whose command line
 * still names the runner entry point: a reused pid or an unrelated Playwright on the machine is never killed.
 */
export interface TrackedProcess {
  pid: number;
  label: string;
  startedAt: string;
}

export interface ProcessRegistry {
  track(pid: number, label: string): Promise<void>;
  untrack(pid: number): Promise<void>;
  /** Kills the process and everything it started (the browsers), then forgets it. */
  stop(pid: number): Promise<void>;
  /** Pids recorded by an earlier office that are no longer owned by this one. */
  stale(): Promise<TrackedProcess[]>;
  /** Stops every stale process that still looks like a runner; forgets the rest. Returns what it did. */
  cleanupStale(): Promise<{ stopped: TrackedProcess[]; forgotten: TrackedProcess[] }>;
}

export interface ProcessOps {
  kill(pid: number): Promise<void>;
  /** Command line of a live process, or `undefined` when it is gone or unreadable. */
  commandLine(pid: number): Promise<string | undefined>;
}

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve) => execFile(file, args, { windowsHide: true, timeout: 10_000 }, (_e, stdout) => resolve(String(stdout ?? ""))));

export const systemProcessOps: ProcessOps = {
  async kill(pid) {
    if (!Number.isInteger(pid) || pid <= 1) return;
    if (process.platform === "win32") {
      await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
      return;
    }
    // Runner children start in their own process group (see `defaultSpawnRun`), so one signal reaches the browsers too.
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGKILL");
        return;
      } catch {
        // not a group leader, or already gone
      }
    }
  },
  async commandLine(pid) {
    if (!Number.isInteger(pid) || pid <= 1) return undefined;
    if (process.platform === "win32") {
      const out = await run("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]);
      return out.trim() || undefined;
    }
    try {
      return (await readFile(`/proc/${pid}/cmdline`, "utf8")).replace(/\0/g, " ").trim() || undefined;
    } catch {
      return undefined;
    }
  },
};

const RUNNER_ENTRY = /src[\\/]cli\.ts/;

export function fileProcessRegistry(file: string, ops: ProcessOps = systemProcessOps, now: () => Date = () => new Date()): ProcessRegistry {
  const owned = new Set<number>();
  async function read(): Promise<TrackedProcess[]> {
    try {
      const list = JSON.parse(await readFile(file, "utf8")) as unknown;
      return Array.isArray(list)
        ? list.filter((p): p is TrackedProcess => !!p && Number.isInteger((p as TrackedProcess).pid) && typeof (p as TrackedProcess).label === "string")
        : [];
    } catch {
      return [];
    }
  }
  let queue: Promise<unknown> = Promise.resolve();
  const write = (change: (list: TrackedProcess[]) => TrackedProcess[]) => {
    const job = queue.then(async () => {
      const next = change(await read());
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(next, null, 2));
      await rename(`${file}.tmp`, file);
    });
    queue = job.catch(() => undefined);
    return job;
  };
  return {
    async track(pid, label) {
      owned.add(pid);
      await write((l) => [...l.filter((p) => p.pid !== pid), { pid, label, startedAt: now().toISOString() }]);
    },
    async untrack(pid) {
      owned.delete(pid);
      await write((l) => l.filter((p) => p.pid !== pid));
    },
    async stop(pid) {
      await ops.kill(pid);
      await this.untrack(pid);
    },
    async stale() {
      return (await read()).filter((p) => !owned.has(p.pid));
    },
    async cleanupStale() {
      const stopped: TrackedProcess[] = [];
      const forgotten: TrackedProcess[] = [];
      for (const p of await this.stale()) {
        const cmd = await ops.commandLine(p.pid);
        if (cmd && RUNNER_ENTRY.test(cmd)) {
          await ops.kill(p.pid);
          stopped.push(p);
        } else forgotten.push(p);
      }
      const gone = new Set([...stopped, ...forgotten].map((p) => p.pid));
      if (gone.size) await write((l) => l.filter((p) => !gone.has(p.pid)));
      return { stopped, forgotten };
    },
  };
}
