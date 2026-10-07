import type { Issue } from "./errors.js";
import { isObject } from "./util.js";

/**
 * A closed subset of JSON Schema, enough for structured agent input and output. Every object is closed
 * (`additionalProperties: false`), every array has `maxItems` and every free string has `maxLength`, so free-form text
 * exists only in explicitly bounded fields.
 *
 * ponytail: hand-rolled subset instead of a JSON Schema library; switch to Ajv if agents ever need $ref, oneOf or formats.
 */
export type Schema =
  | { type: "object"; properties: Record<string, Schema>; required?: readonly string[]; additionalProperties: false; description?: string }
  | { type: "array"; items: Schema; maxItems: number; minItems?: number; description?: string }
  | { type: "string"; maxLength?: number; minLength?: number; enum?: readonly string[]; pattern?: string; description?: string }
  | { type: "integer" | "number"; minimum?: number; maximum?: number; description?: string }
  | { type: "boolean"; description?: string };

export const SCHEMA_LIMITS = { maxDepth: 8, maxProperties: 64, maxStringLength: 8000, maxItems: 200, maxPattern: 200, maxEnum: 50 } as const;

const KEYWORDS: Record<string, readonly string[]> = {
  object: ["type", "properties", "required", "additionalProperties", "description"],
  array: ["type", "items", "maxItems", "minItems", "description"],
  string: ["type", "maxLength", "minLength", "enum", "pattern", "description"],
  integer: ["type", "minimum", "maximum", "description"],
  number: ["type", "minimum", "maximum", "description"],
  boolean: ["type", "description"],
};
const PROPERTY_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const isCount = (v: unknown, max: number) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

/** Checks that a value is a schema inside the supported subset. Returns issues; empty means valid. */
export function checkSchema(def: unknown, path = "$", depth = 0): Issue[] {
  const bad = (p = path): Issue[] => [{ code: "invalid-schema", path: p }];
  if (!isObject(def) || typeof def.type !== "string" || !KEYWORDS[def.type]) return bad();
  if (depth > SCHEMA_LIMITS.maxDepth) return bad();
  const allowed = KEYWORDS[def.type]!;
  for (const key of Object.keys(def)) if (!allowed.includes(key)) return bad(`${path}.${key}`);
  if (def.description !== undefined && (typeof def.description !== "string" || def.description.length > 300)) return bad(`${path}.description`);
  switch (def.type) {
    case "object": {
      if (def.additionalProperties !== false || !isObject(def.properties)) return bad();
      const keys = Object.keys(def.properties);
      if (keys.length > SCHEMA_LIMITS.maxProperties || !keys.every((k) => PROPERTY_NAME.test(k))) return bad(`${path}.properties`);
      const req = def.required ?? [];
      if (!Array.isArray(req) || !req.every((r) => typeof r === "string" && keys.includes(r)) || new Set(req).size !== req.length) {
        return bad(`${path}.required`);
      }
      return keys.flatMap((k) => checkSchema((def.properties as Record<string, unknown>)[k], `${path}.${k}`, depth + 1));
    }
    case "array":
      if (!isCount(def.maxItems, SCHEMA_LIMITS.maxItems) || (def.minItems !== undefined && !isCount(def.minItems, def.maxItems as number))) {
        return bad(`${path}.maxItems`);
      }
      return checkSchema(def.items, `${path}[]`, depth + 1);
    case "string": {
      if (def.enum !== undefined) {
        const e = def.enum;
        if (!Array.isArray(e) || e.length === 0 || e.length > SCHEMA_LIMITS.maxEnum || !e.every((x) => typeof x === "string" && x.length <= 80)) {
          return bad(`${path}.enum`);
        }
      } else if (!isCount(def.maxLength, SCHEMA_LIMITS.maxStringLength) || def.maxLength === 0) {
        // free text must be bounded
        return bad(`${path}.maxLength`);
      }
      if (def.minLength !== undefined && !isCount(def.minLength, SCHEMA_LIMITS.maxStringLength)) return bad(`${path}.minLength`);
      if (def.pattern !== undefined) {
        if (typeof def.pattern !== "string" || def.pattern.length > SCHEMA_LIMITS.maxPattern || !def.pattern.startsWith("^") || !def.pattern.endsWith("$")) {
          return bad(`${path}.pattern`);
        }
        try {
          new RegExp(def.pattern);
        } catch {
          return bad(`${path}.pattern`);
        }
      }
      return [];
    }
    case "integer":
    case "number":
      for (const k of ["minimum", "maximum"] as const) {
        if (def[k] !== undefined && (typeof def[k] !== "number" || !Number.isFinite(def[k]))) return bad(`${path}.${k}`);
      }
      return [];
    default:
      return [];
  }
}

/** Validates a value against a checked schema. Issues carry paths and codes, never the value. */
export function validateValue(schema: Schema, value: unknown, path = "$"): Issue[] {
  const issue = (code: Issue["code"], p = path): Issue[] => [{ code, path: p }];
  switch (schema.type) {
    case "object": {
      if (!isObject(value)) return issue("invalid-type");
      const out: Issue[] = [];
      for (const key of Object.keys(value)) if (!(key in schema.properties)) out.push({ code: "unknown-field", path: `${path}.${key}` });
      for (const key of schema.required ?? []) if (value[key] === undefined) out.push({ code: "missing-field", path: `${path}.${key}` });
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (value[key] !== undefined) out.push(...validateValue(sub, value[key], `${path}.${key}`));
      }
      return out;
    }
    case "array":
      if (!Array.isArray(value)) return issue("invalid-type");
      if (value.length > schema.maxItems) return issue("too-many-items");
      if (schema.minItems !== undefined && value.length < schema.minItems) return issue("invalid-value");
      return value.flatMap((v, i) => validateValue(schema.items, v, `${path}[${i}]`));
    case "string":
      if (typeof value !== "string") return issue("invalid-type");
      if (schema.enum && !schema.enum.includes(value)) return issue("invalid-value");
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return issue("too-long");
      if (schema.minLength !== undefined && value.length < schema.minLength) return issue("invalid-value");
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return issue("invalid-value");
      return [];
    case "integer":
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) return issue("invalid-type");
      if ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) return issue("invalid-value");
      return [];
    case "boolean":
      return typeof value === "boolean" ? [] : issue("invalid-type");
  }
}

/**
 * True when every value valid for `producer` is also valid for `consumer` on the fields the consumer requires and
 * declares. Used to check that an agent's input satisfies its entry tool, and the tool's output satisfies the agent's
 * declared output. Conservative: when unsure, incompatible.
 */
export function isCompatible(producer: Schema, consumer: Schema): boolean {
  if (producer.type !== consumer.type) return producer.type === "integer" && consumer.type === "number";
  switch (consumer.type) {
    case "object": {
      const p = producer as Extract<Schema, { type: "object" }>;
      const pRequired = new Set(p.required ?? []);
      for (const [key, sub] of Object.entries(consumer.properties)) {
        const ps = p.properties[key];
        if ((consumer.required ?? []).includes(key) && !pRequired.has(key)) return false;
        // the consumer is closed: the producer may not emit fields it does not know
        if (ps && !isCompatible(ps, sub)) return false;
      }
      return Object.keys(p.properties).every((k) => k in consumer.properties);
    }
    case "array": {
      const p = producer as Extract<Schema, { type: "array" }>;
      return p.maxItems <= consumer.maxItems && (consumer.minItems ?? 0) <= (p.minItems ?? 0) && isCompatible(p.items, consumer.items);
    }
    case "string": {
      const p = producer as Extract<Schema, { type: "string" }>;
      if (consumer.enum) return !!p.enum && p.enum.every((v) => consumer.enum!.includes(v));
      if (consumer.pattern && p.pattern !== consumer.pattern) return false;
      if ((consumer.minLength ?? 0) > (p.minLength ?? 0)) return false;
      if (consumer.maxLength === undefined) return true;
      return p.maxLength !== undefined ? p.maxLength <= consumer.maxLength : !!p.enum && p.enum.every((v) => v.length <= consumer.maxLength!);
    }
    case "integer":
    case "number": {
      const p = producer as { minimum?: number; maximum?: number };
      return (consumer.minimum === undefined || (p.minimum !== undefined && p.minimum >= consumer.minimum)) &&
        (consumer.maximum === undefined || (p.maximum !== undefined && p.maximum <= consumer.maximum));
    }
    case "boolean":
      return true;
  }
}

/** Copy of `value` with every free-text string (no enum, no pattern) passed through `clean`. Ids and hashes stay exact. */
export function sanitizeFreeText(schema: Schema, value: unknown, clean: (text: string, max: number) => string): unknown {
  switch (schema.type) {
    case "object":
      if (!isObject(value)) return value;
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, schema.properties[k] ? sanitizeFreeText(schema.properties[k]!, v, clean) : v]));
    case "array":
      return Array.isArray(value) ? value.map((v) => sanitizeFreeText(schema.items, v, clean)) : value;
    case "string":
      return typeof value === "string" && !schema.enum && !schema.pattern ? clean(value, schema.maxLength ?? SCHEMA_LIMITS.maxStringLength) : value;
    default:
      return value;
  }
}
