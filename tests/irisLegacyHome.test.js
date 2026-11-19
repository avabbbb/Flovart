// @vitest-environment node
// 2026-11-20 Flovart → Iris：本机 ~/.flovart 复制为 ~/.iris，FLOVART_* 环境变量回退为 IRIS_*。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyLegacyEnv, migrateLegacyHome } from '../tools/iris/legacy-home.js';

describe('Iris legacy home + env compatibility', () => {
  it('copies ~/.flovart to ~/.iris once and keeps the old directory', () => {
    const home = mkdtempSync(join(tmpdir(), 'iris-home-'));
    mkdirSync(join(home, '.flovart', 'toolkit'), { recursive: true });
    writeFileSync(join(home, '.flovart', 'agent.json'), '{"port":1}');
    writeFileSync(join(home, '.flovart', 'toolkit', 'current.json'), '{"v":"1"}');
    expect(migrateLegacyHome({ home })).toMatchObject({ migrated: true });
    expect(readFileSync(join(home, '.iris', 'agent.json'), 'utf8')).toBe('{"port":1}');
    expect(readFileSync(join(home, '.iris', 'toolkit', 'current.json'), 'utf8')).toBe('{"v":"1"}');
    expect(existsSync(join(home, '.flovart', 'agent.json'))).toBe(true);
    writeFileSync(join(home, '.flovart', 'agent.json'), '{"port":2}');
    expect(migrateLegacyHome({ home })).toMatchObject({ migrated: false });
    expect(readFileSync(join(home, '.iris', 'agent.json'), 'utf8')).toBe('{"port":1}');
  });

  it('does nothing without a legacy directory', () => {
    const home = mkdtempSync(join(tmpdir(), 'iris-home-'));
    expect(migrateLegacyHome({ home })).toMatchObject({ migrated: false });
    expect(existsSync(join(home, '.iris'))).toBe(false);
  });

  it('falls back to FLOVART_* only when IRIS_* is unset', () => {
    const env = { FLOVART_AGENT_CONFIG: '/old/agent.json', FLOVART_WEB_URL: 'old', IRIS_WEB_URL: 'new', FLOVARTBENCH_ALLOW_CODEX: 'true' };
    expect(applyLegacyEnv(env).sort()).toEqual(['IRISBENCH_ALLOW_CODEX', 'IRIS_AGENT_CONFIG']);
    expect(env).toMatchObject({ IRIS_AGENT_CONFIG: '/old/agent.json', IRIS_WEB_URL: 'new', IRISBENCH_ALLOW_CODEX: 'true' });
  });
});
