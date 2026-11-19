import { Validator } from '@cfworker/json-schema';

import registryJson from './contracts/runtime/command-registry.v1.json' with { type: 'json' };
import registrySchema from './contracts/runtime/schemas/command-registry.v1.json' with { type: 'json' };

const REGISTRY_SCHEMA_ID = 'https://flovart.local/schemas/runtime/command-registry.v1.json';
if (registrySchema.$id !== REGISTRY_SCHEMA_ID) {
  throw new Error(`Invalid canonical registry schema ID: ${String(registrySchema.$id)}`);
}
const registryValidator = new Validator(registrySchema, '2020-12', false);

export function normalizeCanonicalRegistry(document) {
  const result = registryValidator.validate(document);
  if (!result.valid) {
    throw new Error(`Invalid canonical registry: ${result.errors.map(error => error.error).join('; ')}`);
  }
  const commands = {};
  for (const { name, ...definition } of document.commands) {
    if (Object.hasOwn(commands, name)) throw new Error(`Duplicate command in canonical registry: ${name}`);
    commands[name] = Object.freeze({ ...definition, args: Object.freeze({ ...definition.args }) });
  }
  return Object.freeze({
    schemaVersion: document.schemaVersion,
    protocolVersion: document.protocolVersion,
    registryHash: document.registryHash,
    commands: Object.freeze(commands),
  });
}

const registry = normalizeCanonicalRegistry(registryJson);

export function getCanonicalRegistry() {
  return registry;
}

export const CANONICAL_COMMAND_REGISTRY = registry.commands;
