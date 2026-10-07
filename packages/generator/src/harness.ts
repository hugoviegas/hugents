import { isDeepStrictEqual } from "node:util";
import type { ReasonCode } from "./contracts.js";

/** A runtime stop with a fixed reason code. Its message is the code, never page text, a URL or a value. */
export class HarnessError extends Error {
  constructor(readonly code: ReasonCode) {
    super(code);
    this.name = "HarnessError";
  }
}

export interface HarnessLimits {
  /** Maximum time for one test, in milliseconds. */
  testTimeoutMs: number;
  /** Maximum total run time for the whole spec, in milliseconds. */
  runTimeoutMs: number;
  /** Maximum number of actions and assertions in one test. */
  maxActions: number;
  /** Maximum number of pages opened in a run. */
  maxPages: number;
  /** Maximum time one assertion polls before it fails. */
  assertionTimeoutMs: number;
}

export const DEFAULT_LIMITS: HarnessLimits = {
  testTimeoutMs: 30_000,
  runTimeoutMs: 120_000,
  maxActions: 100,
  maxPages: 2,
  assertionTimeoutMs: 5_000,
};

/** The slice of a Playwright locator the wrapper uses. */
export interface RawLocator {
  click(o?: { timeout?: number }): Promise<void>;
  dblclick(o?: { timeout?: number }): Promise<void>;
  check(o?: { timeout?: number }): Promise<void>;
  uncheck(o?: { timeout?: number }): Promise<void>;
  setChecked(checked: boolean, o?: { timeout?: number }): Promise<void>;
  selectOption(v: string | string[], o?: { timeout?: number }): Promise<unknown>;
  press(key: string, o?: { timeout?: number }): Promise<void>;
  fill(v: string, o?: { timeout?: number }): Promise<void>;
  tap(o?: { timeout?: number }): Promise<void>;
  hover(o?: { timeout?: number }): Promise<void>;
  focus(o?: { timeout?: number }): Promise<void>;
  blur(o?: { timeout?: number }): Promise<void>;
  waitFor(o?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }): Promise<void>;
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  isHidden(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  isChecked(): Promise<boolean>;
  textContent(): Promise<string | null>;
  inputValue(): Promise<string>;
  first(): RawLocator;
  last(): RawLocator;
  nth(i: number): RawLocator;
}

/** The slice of a Playwright page the wrapper uses. */
export interface RawPage {
  getByRole(role: string, o?: Record<string, unknown>): RawLocator;
  getByLabel(text: string | RegExp, o?: Record<string, unknown>): RawLocator;
  getByText(text: string | RegExp, o?: Record<string, unknown>): RawLocator;
  getByTestId(id: string | RegExp): RawLocator;
}

/** Shared counters and deadline. Every action and assertion goes through `tick`. Reset at the start of each test. */
export interface Budget {
  tick(): void;
  /** Milliseconds a single wait may use, bounded by what is left of the test. */
  remainingMs(cap: number): number;
  /** True once the test deadline has passed. */
  expired(): boolean;
}

export class RunBudget implements Budget {
  /** Set by the executor when the run is over, so a late spec callback cannot keep acting. */
  aborted = false;
  private actions = 0;
  private deadlineAt = 0;

  constructor(private readonly limits: HarnessLimits) {}

  startTest(): void {
    this.actions = 0;
    this.deadlineAt = Date.now() + this.limits.testTimeoutMs;
  }

  tick(): void {
    if (this.aborted || Date.now() > this.deadlineAt) throw new HarnessError("run-timeout");
    if (++this.actions > this.limits.maxActions) throw new HarnessError("action-limit");
  }

  expired(): boolean {
    return Date.now() >= this.deadlineAt;
  }

  remainingMs(cap: number): number {
    return Math.max(1, Math.min(cap, this.deadlineAt - Date.now()));
  }
}

const RAW = Symbol("hugents.rawLocator");
const isRegExp = (v: unknown): v is RegExp => Object.prototype.toString.call(v) === "[object RegExp]";
const GETBY_KEYS = ["name", "exact", "level", "checked", "pressed", "selected", "expanded", "disabled"] as const;

/** Copies only known option keys into a host-realm object, so nothing from the spec's realm reaches Playwright. */
function cleanOptions(options: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof options !== "object" || options === null) return out;
  for (const key of GETBY_KEYS) {
    const v = (options as Record<string, unknown>)[key];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || isRegExp(v)) {
      out[key] = isRegExp(v) ? new RegExp(v.source, v.flags) : v;
    }
  }
  return out;
}

const text = (v: unknown): string | RegExp => (isRegExp(v) ? new RegExp(v.source, v.flags) : String(v));

/** Unknown properties throw a reason code instead of returning undefined, so a bypassed validator still stops here. */
function strict<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === "symbol" || prop === "then") return Reflect.get(t, prop, receiver);
      if (!Object.prototype.hasOwnProperty.call(t, prop)) throw new HarnessError("api-not-allowed");
      return Reflect.get(t, prop, receiver);
    },
    set() {
      throw new HarnessError("api-not-allowed");
    },
    defineProperty() {
      throw new HarnessError("api-not-allowed");
    },
  });
}

export interface WrappedLocator {
  [key: string]: unknown;
}

export function wrapLocator(raw: RawLocator, budget: Budget, limits: HarnessLimits): WrappedLocator {
  const timeout = () => ({ timeout: budget.remainingMs(limits.assertionTimeoutMs) });
  const act = <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) => async (...a: A) => {
    budget.tick();
    await fn(...a);
  };
  const query = <R>(fn: () => Promise<R>) => async () => {
    budget.tick();
    return fn();
  };
  const derive = (fn: () => RawLocator) => () => {
    budget.tick();
    return wrapLocator(fn(), budget, limits);
  };
  const w = {
    click: act(() => raw.click(timeout())),
    dblclick: act(() => raw.dblclick(timeout())),
    check: act(() => raw.check(timeout())),
    uncheck: act(() => raw.uncheck(timeout())),
    setChecked: act((v: unknown) => raw.setChecked(Boolean(v), timeout())),
    selectOption: act((v: unknown) => raw.selectOption(Array.isArray(v) ? v.map(String) : String(v), timeout())),
    press: act((k: unknown) => raw.press(String(k), timeout())),
    fill: act((v: unknown) => raw.fill(String(v), timeout())),
    tap: act(() => raw.tap(timeout())),
    hover: act(() => raw.hover(timeout())),
    focus: act(() => raw.focus(timeout())),
    blur: act(() => raw.blur(timeout())),
    waitFor: act(() => raw.waitFor(timeout())),
    count: query(() => raw.count()),
    isVisible: query(() => raw.isVisible()),
    isHidden: query(() => raw.isHidden()),
    isEnabled: query(() => raw.isEnabled()),
    first: derive(() => raw.first()),
    last: derive(() => raw.last()),
    nth: (i: unknown) => {
      budget.tick();
      return wrapLocator(raw.nth(Number(i) | 0), budget, limits);
    },
    [RAW]: raw,
  };
  return strict(w as unknown as WrappedLocator);
}

/** The only fixture a spec gets: the four locator factories the validator allows, nothing else. */
export function wrapPage(raw: RawPage, budget: Budget, limits: HarnessLimits): WrappedLocator {
  const loc = (make: () => RawLocator) => {
    budget.tick();
    return wrapLocator(make(), budget, limits);
  };
  return strict({
    getByRole: (role: unknown, o?: unknown) => loc(() => raw.getByRole(String(role), cleanOptions(o))),
    getByLabel: (t: unknown, o?: unknown) => loc(() => raw.getByLabel(text(t), cleanOptions(o))),
    getByText: (t: unknown, o?: unknown) => loc(() => raw.getByText(text(t), cleanOptions(o))),
    getByTestId: (t: unknown) => loc(() => raw.getByTestId(text(t))),
  } as unknown as WrappedLocator);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Polls `check` until it is true or the time is up. Failure is a reason code, never the compared values. */
async function poll(budget: Budget, limits: HarnessLimits, negate: boolean, check: () => Promise<boolean>): Promise<void> {
  const until = Date.now() + budget.remainingMs(limits.assertionTimeoutMs);
  for (;;) {
    let ok = false;
    try {
      ok = await check();
    } catch {
      ok = false;
    }
    if (ok !== negate) return;
    if (Date.now() >= until) throw new HarnessError(budget.expired() ? "run-timeout" : "assertion-failed");
    await sleep(50);
  }
}

const matches = (actual: string, expected: unknown, partial: boolean) =>
  isRegExp(expected) ? new RegExp(expected.source, expected.flags.replace(/[gy]/g, "")).test(actual) : partial ? actual.includes(String(expected)) : actual.trim() === String(expected).trim();

function rawOf(value: unknown): RawLocator | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  // The wrapper is a Proxy that only exposes known keys; the symbol lookup is allowed through.
  return (value as { [RAW]?: RawLocator })[RAW];
}

/** A small `expect` limited to the matchers the validator allows. Locator matchers poll; value matchers do not. */
export function createExpect(budget: Budget, limits: HarnessLimits) {
  return (actual: unknown) => {
    const build = (negate: boolean) => {
      const raw = rawOf(actual);
      const fail = (): never => {
        throw new HarnessError("assertion-failed");
      };
      const onLocator = (fn: (r: RawLocator) => Promise<boolean>) => async () => {
        budget.tick();
        if (!raw) return fail();
        await poll(budget, limits, negate, () => fn(raw));
      };
      const onValue = (fn: () => boolean) => async () => {
        budget.tick();
        if (fn() === negate) fail();
      };
      return {
        toBeVisible: onLocator((r) => r.isVisible()),
        toBeHidden: onLocator((r) => r.isHidden()),
        toBeEnabled: onLocator((r) => r.isEnabled()),
        toBeDisabled: onLocator(async (r) => !(await r.isEnabled())),
        toBeChecked: onLocator((r) => r.isChecked()),
        toHaveText: (e: unknown) => onLocator(async (r) => matches((await r.textContent()) ?? "", e, false))(),
        toContainText: (e: unknown) => onLocator(async (r) => matches((await r.textContent()) ?? "", e, true))(),
        toHaveValue: (e: unknown) => onLocator(async (r) => matches(await r.inputValue(), e, false))(),
        toHaveCount: (n: unknown) => onLocator(async (r) => (await r.count()) === Number(n))(),
        toBe: (e: unknown) => onValue(() => Object.is(actual, e))(),
        toEqual: (e: unknown) => onValue(() => isDeepStrictEqual(JSON.parse(JSON.stringify(actual ?? null)), JSON.parse(JSON.stringify(e ?? null))))(),
        toBeGreaterThan: (e: unknown) => onValue(() => Number(actual) > Number(e))(),
        toBeGreaterThanOrEqual: (e: unknown) => onValue(() => Number(actual) >= Number(e))(),
        toBeTruthy: onValue(() => Boolean(actual)),
        toBeFalsy: onValue(() => !actual),
      };
    };
    return strict({ ...build(false), not: strict(build(true)) });
  };
}

export interface RegisteredTest {
  name: string;
  fn: (fixtures: { page: unknown }) => unknown;
}

/**
 * The `hugents-seed` module as the spec sees it: `test` (with `describe`, `step`, `beforeEach`) and `expect`.
 * `test` only registers; the executor runs the registered tests serially and owns pages, budget and timeouts.
 */
export function createSeedModule(expectFn: ReturnType<typeof createExpect>) {
  const tests: RegisteredTest[] = [];
  const hooks: Array<(fixtures: { page: unknown }) => unknown> = [];
  const test = Object.assign(
    (name: unknown, fn: unknown) => {
      if (typeof fn !== "function") throw new HarnessError("spec-error");
      tests.push({ name: String(name), fn: fn as RegisteredTest["fn"] });
    },
    {
      describe: (_name: unknown, fn: unknown) => {
        if (typeof fn === "function") fn();
      },
      step: async (_name: unknown, fn: unknown) => {
        if (typeof fn === "function") await fn();
      },
      beforeEach: (fn: unknown) => {
        if (typeof fn === "function") hooks.push(fn as (f: { page: unknown }) => unknown);
      },
    },
  );
  return { module: { test, expect: expectFn }, tests, hooks };
}
