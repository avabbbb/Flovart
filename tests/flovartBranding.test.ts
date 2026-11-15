import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeFlovartCommand } from '../tools/flovart/core.js';

/** 回归：skill.run 报错暴露旧代号 “Iris”，且没告诉 Agent 同一命名空间里有哪些命令可用。 */
const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Flovart naming on user/agent-facing surfaces', () => {
  it('unknown skill.* command lists the real skill.* commands and never says Iris', async () => {
    const error = await executeFlovartCommand('skill.run', {}, {}).then(() => null, cause => cause);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('UNKNOWN_COMMAND');
    expect(error.message).toContain('Unknown Flovart command: skill.run');
    expect(error.message).toContain('skill.list');
    expect(error.message).toContain('skill.draft');
    expect(error.availableCommands).toEqual(expect.arrayContaining(['skill.list', 'skill.install', 'skill.validate']));
    expect(error.availableCommands.every((name: string) => name.startsWith('skill.'))).toBe(true);
    expect(error.message).not.toMatch(/Iris/);

    const schema = await executeFlovartCommand('command.schema', { command: 'skill.run' }, {});
    expect(schema).toMatchObject({ ok: false, error: { code: 'UNKNOWN_COMMAND' } });
    expect(schema.error.message).not.toMatch(/Iris/);
    expect(schema.error.availableCommands).toContain('skill.list');
  });

  it('keeps the old codename out of the Agent prompt, TUI, DSH help and host projection', () => {
    for (const file of ['agent/kernel.js', 'tools/flovart/tui.js', 'tools/flovart/core.js', 'tools/flovart/cli.js', 'agent/host-projection.js', 'components/agent/AgentWorkspace.tsx']) {
      expect(read(file), file).not.toMatch(/\bIris\b/);
    }
    expect(read('agent/kernel.js')).toContain('你是 Flovart Agent');
  });
});
