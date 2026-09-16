import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HELP_TEXT } from '../tools/flovart/core.js';
import { RUNTIME_COMMANDS, RUNTIME_WRITE_COMMANDS } from '../tools/flovart/runtime-command-surface.js';

const RETIRED_COMMANDS: Array<[string, string[]]> = [
  ['provider.begin-setup', ['--provider', 'custom']],
  ['provider.select-model', ['--image-model', 'flovart:gpt-image-2']],
  ['provider.test', ['--purpose', 'both']],
  ['generate.images-batch', ['--items-json', '[{"name":"a","prompt":"p"}]']],
];

describe('Flovart retired browser Bridge commands', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flovart-provider-routing-'));
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('routes image/video generation and provider status to the Production Runtime surface', () => {
    expect(['provider.status', 'generate.image', 'generate.video'].every(command => RUNTIME_COMMANDS.has(command))).toBe(true);
    expect(RUNTIME_WRITE_COMMANDS.has('generate.image')).toBe(true);
    expect(RUNTIME_WRITE_COMMANDS.has('generate.video')).toBe(true);
    expect(RUNTIME_COMMANDS.has('provider.select-model')).toBe(false);
    expect(RUNTIME_COMMANDS.has('generate.images-batch')).toBe(false);
  });

  it('keeps default help focused while preserving compatibility discovery', () => {
    expect(HELP_TEXT).toContain('Bootstrap/admin:');
    expect(HELP_TEXT).toContain('Stable operations:');
    expect(HELP_TEXT).toContain('Compatibility commands remain callable and discoverable');
    expect(HELP_TEXT).not.toContain('provider.begin-setup');
    expect(HELP_TEXT).not.toContain('generate.images-batch');
  });

  it.each(RETIRED_COMMANDS)('rejects retired browser-Bridge command %s without queueing it', (command, args) => {
    const cliPath = join(process.cwd(), 'tools', 'flovart', 'cli.js');
    let output = '';
    try {
      output = execFileSync(process.execPath, [cliPath, command, ...args, '--timeout-ms', '1', '--json'], {
        cwd: tempDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          FLOVART_SHADOW_STATE_FILE: join(tempDir, 'shadow-runtime-state.json'),
        },
      });
    } catch (error) {
      output = error.stdout?.toString() || '';
    }

    const response = JSON.parse(output);
    expect(response).toMatchObject({
      ok: false,
      command,
      runtime: 'retired',
      error: { code: 'COMMAND_RETIRED', retryable: false },
    });
    expect(existsSync(join(tempDir, '.flovart', 'command-queue.json'))).toBe(false);
    expect(JSON.stringify(response)).not.toMatch(/api[_-]?key|token|secret/i);
  });
});
