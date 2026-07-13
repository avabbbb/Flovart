import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BROWSER_COMMANDS, shouldWaitForBrowserCommand } from '../tools/flovart/browser-commands.js';

describe('Flovart provider browser routing', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flovart-provider-routing-'));
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses one shared browser command policy for CLI and MCP provider operations', () => {
    expect(['provider.status', 'provider.select-model', 'provider.test'].every(command => BROWSER_COMMANDS.has(command))).toBe(true);
    expect(shouldWaitForBrowserCommand('provider.status', undefined)).toBe(true);
    expect(shouldWaitForBrowserCommand('provider.select-model', undefined)).toBe(true);
    expect(shouldWaitForBrowserCommand('generate.image', undefined)).toBe(false);
    expect(shouldWaitForBrowserCommand('provider.status', false)).toBe(false);
  });

  it.each([
    ['provider.status', []],
    ['provider.select-model', ['--image-model', 'flovart:gpt-image-2']],
    ['provider.test', ['--purpose', 'both']],
  ])('queues %s for the Flovart browser instead of reading shadow provider state', (command, args) => {
    const cliPath = join(process.cwd(), 'tools', 'flovart', 'cli.js');
    const output = execFileSync(process.execPath, [cliPath, command, ...args, '--timeout-ms', '1', '--json'], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        FLOVART_SHADOW_STATE_FILE: join(tempDir, 'shadow-runtime-state.json'),
      },
    });

    const response = JSON.parse(output);
    const queue = JSON.parse(readFileSync(join(tempDir, '.flovart', 'command-queue.json'), 'utf8'));

    expect(response).toMatchObject({
      ok: true,
      command,
      runtime: 'file-bridge',
      data: { queued: true, pending: true, command },
    });
    expect(queue.entries.at(-1)).toMatchObject({ command, status: 'pending' });
    expect(JSON.stringify(response)).not.toMatch(/api[_-]?key|token|secret/i);
  });
});
