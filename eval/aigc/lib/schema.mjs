// Minimal JSON Schema (draft-07 subset) validator for the AIGC eval contracts.
//
// The schemas in eval/schema/aigc-*.schema.json are the reviewable contract.
// This validator implements exactly the keywords those files use, so the eval
// platform has no runtime dependency beyond Node: type, enum, const, required,
// properties, additionalProperties, minProperties, items, minItems, minLength,
// pattern, minimum, maximum, exclusiveMinimum, anyOf and local $ref.
// An unknown keyword is a contract error, not silently ignored.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_DIR = join(here, '..', '..', 'schema');

const KNOWN = new Set([
  '$schema', '$id', 'title', 'description', 'definitions', 'type', 'enum', 'const', 'required', 'properties',
  'additionalProperties', 'minProperties', 'items', 'minItems', 'minLength', 'pattern', 'minimum', 'maximum',
  'exclusiveMinimum', 'anyOf', '$ref',
]);

const typeOf = value => (value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value);
const matchesType = (value, type) => {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
};

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`only local $ref is supported: ${ref}`);
  return ref.slice(2).split('/').reduce((node, key) => node?.[key], root);
}

function check(root, schema, value, path, errors) {
  for (const key of Object.keys(schema)) if (!KNOWN.has(key)) throw new Error(`schema keyword ${key} at ${path} is not supported`);
  if (schema.$ref) return check(root, resolveRef(root, schema.$ref), value, path, errors);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => matchesType(value, type))) {
      errors.push(`${path}: expected ${types.join('|')}, got ${typeOf(value)}`);
      return;
    }
  }
  if (schema.enum && !schema.enum.some(option => option === value)) errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if ('const' in schema && schema.const !== value) errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path}: must be > ${schema.exclusiveMinimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} item(s)`);
    if (schema.items) value.forEach((entry, index) => check(root, schema.items, entry, `${path}[${index}]`, errors));
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}: missing ${key}`);
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) errors.push(`${path}: needs at least ${schema.minProperties} field(s)`);
    for (const [key, entry] of Object.entries(value)) {
      const sub = schema.properties?.[key];
      if (sub) check(root, sub, entry, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: unknown field ${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') check(root, schema.additionalProperties, entry, `${path}.${key}`, errors);
    }
  }
  if (schema.anyOf) {
    const ok = schema.anyOf.some(option => { const sub = []; check(root, option, value, path, sub); return sub.length === 0; });
    if (!ok) errors.push(`${path}: matches none of anyOf`);
  }
}

/** Validate a value against a schema object. Returns a list of error strings (empty = valid). */
export function validateAgainst(schema, value, path = '$') {
  const errors = [];
  check(schema, schema, value, path, errors);
  return errors;
}

const cache = new Map();
export function loadSchema(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(join(SCHEMA_DIR, `${name}.schema.json`), 'utf8')));
  return cache.get(name);
}

export const validateItemShape = item => validateAgainst(loadSchema('aigc-item'), item, `item(${item?.id ?? '?'})`);
export const validateTakeShape = take => validateAgainst(loadSchema('aigc-take'), take, `take(${take?.takeId ?? '?'})`);
export const validateRatingShape = rating => validateAgainst(loadSchema('aigc-rating'), rating, `rating(${rating?.takeId ?? '?'}/${rating?.dim ?? '?'})`);
