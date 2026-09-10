import { Validator } from '@cfworker/json-schema';
import { createHash } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';

import envelopeSchema from './contracts/runtime/schemas/command-envelope.v1.json' with { type: 'json' };
import crewIntentSchema from './contracts/runtime/schemas/crew-intent.v1.json' with { type: 'json' };
import crewReceiptSchema from './contracts/runtime/schemas/crew-receipt.v1.json' with { type: 'json' };
import runtimeErrorSchema from './contracts/runtime/schemas/runtime-error.v1.json' with { type: 'json' };
import runtimeEventSchema from './contracts/runtime/schemas/runtime-event.v1.json' with { type: 'json' };
import runtimeStatusSchema from './contracts/runtime/schemas/runtime-status.v1.json' with { type: 'json' };
import runtimeTaskSchema from './contracts/runtime/schemas/runtime-task.v1.json' with { type: 'json' };
import taskReceiptSchema from './contracts/runtime/schemas/task-receipt.v1.json' with { type: 'json' };
import productionTaskSchema from './contracts/runtime/schemas/production-task.v1.json' with { type: 'json' };
import productionTaskResumeSchema from './contracts/runtime/schemas/production-task-resume.v1.json' with { type: 'json' };
import { getCanonicalRegistry } from './registry.js';

function createRuntimeValidator(schema, name) {
  const expectedId = `https://flovart.local/schemas/runtime/${name}.v1.json`;
  if (schema.$id !== expectedId) throw new Error(`Invalid ${name} schema ID: ${String(schema.$id)}`);
  return new Validator(schema, '2020-12', false);
}

const envelopeValidator = createRuntimeValidator(envelopeSchema, 'command-envelope');
const productionTaskResumeDocument = {
  ...productionTaskResumeSchema,
  properties: {
    ...productionTaskResumeSchema.properties,
    task: productionTaskSchema,
  },
};
const outputValidators = Object.freeze({
  'crew-intent': createRuntimeValidator(crewIntentSchema, 'crew-intent'),
  'crew-receipt': createRuntimeValidator(crewReceiptSchema, 'crew-receipt'),
  'runtime-error': createRuntimeValidator(runtimeErrorSchema, 'runtime-error'),
  'runtime-event': createRuntimeValidator(runtimeEventSchema, 'runtime-event'),
  'runtime-status': createRuntimeValidator(runtimeStatusSchema, 'runtime-status'),
  'runtime-task': createRuntimeValidator(runtimeTaskSchema, 'runtime-task'),
  'task-receipt': createRuntimeValidator(taskReceiptSchema, 'task-receipt'),
  'production-task': createRuntimeValidator(productionTaskSchema, 'production-task'),
  'production-task-resume': createRuntimeValidator(productionTaskResumeDocument, 'production-task-resume'),
});

function invalid(code, message, details) {
  return {
    ok: false,
    error: { code, message, retryable: false, details, actionUrl: null },
  };
}

export function validateCommandEnvelope(envelope) {
  if (envelope && typeof envelope === 'object' && 'protocolVersion' in envelope && envelope.protocolVersion !== getCanonicalRegistry().protocolVersion) {
    return invalid('PROTOCOL_MISMATCH', `Unsupported protocol version: ${String(envelope.protocolVersion)}`);
  }
  const result = envelopeValidator.validate(envelope);
  if (!result.valid) {
    return invalid('INVALID_ARGUMENT', 'CommandEnvelope does not match protocol v1.', result.errors);
  }
  if (!getCanonicalRegistry().commands[envelope.command]) {
    return invalid('UNKNOWN_COMMAND', `Unknown Flovart command: ${envelope.command}`);
  }
  return { ok: true, value: envelope };
}

export function hashCanonicalPayload(payload) {
  return createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex');
}

export function hashCanonicalRegistryDocument(document) {
  const { registryHash: _declaredHash, ...content } = document;
  return hashCanonicalPayload(content);
}

export function validateRuntimeContract(kind, value) {
  const validator = outputValidators[kind];
  if (!validator) return invalid('INVALID_ARGUMENT', `Unknown runtime contract: ${kind}`);
  const result = validator.validate(value);
  return result.valid
    ? { ok: true, value }
    : invalid('INVALID_ARGUMENT', `${kind} does not match protocol v1.`, result.errors);
}
