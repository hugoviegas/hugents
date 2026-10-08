import { createHash, randomBytes } from "node:crypto";
import { DEFAULT_RULES } from "@hugents/core";

export const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const SHA256_HEX = /^[a-f0-9]{64}$/;

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** JSON with sorted object keys, so equal values always hash the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v,
  );
}

export const hashValue = (value: unknown): string => sha256(canonicalJson(value));

/** Snapshots are frozen all the way down so no caller can change the meaning of a stored record in memory. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Immutable copy: callers can never alias stored state. */
export const snapshot = <T>(value: T): T => deepFreeze(structuredClone(value));

/** Any built-in secret rule, URLs included: agent packages, prompts and payload text never carry them. */
export function looksSecret(text: string): boolean {
  return DEFAULT_RULES.some((rule) => new RegExp(rule.pattern.source, rule.pattern.flags).test(text));
}

export const defaultNewId = (prefix: string): string => `${prefix}-${randomBytes(9).toString("base64url")}`;

/** Promise chain that runs jobs one at a time. A failed job does not block the next. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}
