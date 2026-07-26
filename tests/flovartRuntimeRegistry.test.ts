// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  hashCanonicalPayload,
  hashCanonicalRegistryDocument,
  validateCommandEnvelope,
  validateRuntimeContract,
} from '../tools/flovart/contracts.js';
import registryDocument from '../tools/flovart/contracts/runtime/command-registry.v1.json';
import { COMMAND_REGISTRY, executeFlovartCommand } from '../tools/flovart/core.js';
import { getCanonicalRegistry, normalizeCanonicalRegistry } from '../tools/flovart/registry.js';
import {
  availableCommandEntries,
  RUNTIME_COMMAND_NAMES,
  RUNTIME_WRITE_COMMAND_NAMES,
} from '../tools/flovart/runtime-command-surface.js';
import {
  WORKSPACE_COMMAND_NAMES,
  WORKSPACE_WRITE_COMMAND_NAMES,
} from '../tools/flovart/workspace-command-surface.js';
import {
  RESEARCH_COMMAND_NAMES,
  RESEARCH_WRITE_COMMAND_NAMES,
} from '../tools/flovart/research-command-surface.js';

describe('Production Runtime canonical registry', () => {
  it('publishes the S1.1 durable-task contract without restoring removed surfaces', () => {
    const registry = getCanonicalRegistry();
    const commandNames = Object.keys(registry.commands);

    expect(registry.protocolVersion).toBe('1');
    expect(registry.registryHash).toBe('0f94bbc3c239bb90783962b49d8ef6f6f5db42fedcebfbe98c898d8c86855a8b');
    expect(hashCanonicalRegistryDocument(registryDocument)).toBe(registry.registryHash);
    expect(Object.isFrozen(registry.commands)).toBe(true);
    expect(Object.isFrozen(registry.commands['runtime.status'].args)).toBe(true);
    expect(commandNames).toEqual(expect.arrayContaining([
      'runtime.status',
      'command.list',
      'command.schema',
      'runtime.test.delay',
      'task.get',
      'task.list',
      'task.cancel',
      'event.stream',
    ]));
    for (const command of ['runtime.test.delay', 'task.get', 'task.list', 'task.cancel', 'event.stream']) {
      expect(registry.commands[command]?.availability).toBe('available');
    }
    expect(commandNames).not.toContain('workflow.run');
    expect(commandNames.some(command => /^(?:canvas|element)\./.test(command))).toBe(false);
  });

  it('is the single command metadata source used by the CLI', () => {
    const registry = getCanonicalRegistry();

    expect(COMMAND_REGISTRY).toEqual(registry.commands);
    expect(COMMAND_REGISTRY['workflow.node.create']?.availability).toBe('available');
  });

  it('keeps the public CLI and MCP adapters aligned with available registry commands', () => {
    const available = availableCommandEntries(COMMAND_REGISTRY).map(([name]) => name);

    expect(new Set(available)).toEqual(new Set([
      ...RUNTIME_COMMAND_NAMES,
      ...WORKSPACE_COMMAND_NAMES,
      ...RESEARCH_COMMAND_NAMES,
    ]));
    expect(RUNTIME_WRITE_COMMAND_NAMES).toEqual([
      'runtime.test.delay',
      'task.cancel',
      'production.dry-run',
      'generate.image',
      'generate.video',
    ]);
    expect(WORKSPACE_WRITE_COMMAND_NAMES).toContain('workflow.node.create');
    expect(RESEARCH_WRITE_COMMAND_NAMES).toEqual(['research.topic.collect']);
    expect(available).toContain('workflow.node.create');
    expect(available).toContain('research.topic.collect');
  });

  it('rejects unknown envelope fields and commands at the public contract seam', () => {
    const base = {
      protocolVersion: '1',
      commandId: 'cmd_019f72d7-1df3-7632-aaea-073f497b8140',
      command: 'runtime.status',
      args: {},
      actor: { kind: 'cli', instanceId: 'cli_local' },
    };

    expect(validateCommandEnvelope({ ...base, leaked: true })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(validateCommandEnvelope({ ...base, command: 'workflow.run' })).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_COMMAND' },
    });
  });

  it('reports protocol mismatch separately from invalid arguments', () => {
    expect(validateCommandEnvelope({
      protocolVersion: '2',
      commandId: 'cmd_future',
      command: 'runtime.status',
      args: {},
      actor: { kind: 'cli', instanceId: 'cli_local' },
    })).toMatchObject({
      ok: false,
      error: { code: 'PROTOCOL_MISMATCH', retryable: false },
    });
  });

  it('hashes semantically identical payloads independent of object key order', () => {
    const first = { prompt: 'hello', options: { width: 1024, height: 768 } };
    const reordered = { options: { height: 768, width: 1024 }, prompt: 'hello' };

    expect(hashCanonicalPayload(first)).toBe(hashCanonicalPayload(reordered));
    expect(hashCanonicalPayload(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails registry startup on duplicate commands or unknown metadata', () => {
    const command = {
      name: 'runtime.status',
      summary: 'status',
      args: {},
      availability: 'available',
    };

    expect(() => normalizeCanonicalRegistry({
      schemaVersion: '1',
      protocolVersion: '1',
      registryHash: '0'.repeat(64),
      commands: [command, command],
    })).toThrow(/duplicate command/i);
    expect(() => normalizeCanonicalRegistry({
      schemaVersion: '1',
      protocolVersion: '1',
      registryHash: '0'.repeat(64),
      commands: [{ ...command, unexpected: true }],
    })).toThrow(/registry/i);
  });

  it('reports runtime.status as unavailable without falling back to a legacy runtime', async () => {
    await expect(executeFlovartCommand('runtime.status', {}, {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUNTIME_UNAVAILABLE' },
    });
  });

  it('propagates local contract failures through the CLI process boundary', () => {
    const env = {
      ...process.env,
      FLOVART_RUNTIME_DISCOVERY: join(tmpdir(), `flovart-missing-discovery-${process.pid}.json`),
    };
    const unknownCommand = spawnSync(process.execPath, [
      join(process.cwd(), 'tools', 'flovart', 'cli.js'),
      'command.schema',
      '--command',
      'workflow.run',
      '--json',
    ], { encoding: 'utf8', env });
    const unknownOutput = JSON.parse(unknownCommand.stdout);
    const runtimeStatus = spawnSync(process.execPath, [
      join(process.cwd(), 'tools', 'flovart', 'cli.js'),
      'runtime.status',
      '--json',
    ], { encoding: 'utf8', env });
    const statusOutput = JSON.parse(runtimeStatus.stdout);

    expect(unknownCommand.status).toBe(1);
    expect(unknownOutput).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_COMMAND' },
      data: null,
      runtime: 'client-registry',
    });
    expect(runtimeStatus.status).toBe(1);
    expect(statusOutput).toMatchObject({
      ok: false,
      error: { code: 'RUNTIME_UNAVAILABLE' },
      runtime: 'production-runtime',
    });
  });

  it('validates the shared runtime output contracts', () => {
    expect(validateRuntimeContract('runtime-status', {
      protocolVersion: '1',
      runtimeVersion: '0.3.0',
      runtimeInstanceId: 'runtime_test',
      registryHash: getCanonicalRegistry().registryHash,
      authority: 'desktop-runtime',
      state: 'ready',
    })).toMatchObject({ ok: true });
    expect(validateRuntimeContract('task-receipt', {
      kind: 'task',
      commandId: 'cmd_test',
      taskId: 'task_test',
      status: 'queued',
      eventId: 1,
    })).toMatchObject({ ok: true });
    expect(validateRuntimeContract('runtime-task', {
      id: 'task_test',
      commandId: 'cmd_test',
      kind: 'runtime.test.delay',
      status: 'completed',
      progress: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      cancelRequestedAt: null,
      result: { delayedMs: 10 },
      error: null,
      createdAt: 1,
      updatedAt: 2,
    })).toMatchObject({ ok: true });
    expect(validateRuntimeContract('runtime-event', {
      eventId: 1,
      eventVersion: '1',
      eventType: 'task.completed',
      taskId: 'task_test',
      occurredAt: 2,
      data: { status: 'completed' },
    })).toMatchObject({ ok: true });
    expect(validateRuntimeContract('runtime-error', {
      code: 'RUNTIME_UNAVAILABLE',
      message: 'Runtime is offline.',
      retryable: false,
      unexpected: true,
    })).toMatchObject({ ok: false });
  });
});
