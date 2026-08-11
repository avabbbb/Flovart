import { describe, expect, it } from 'vitest';
import { getStudioRuntimeStatus } from '../services/studioRuntimeStatus';

describe('Studio Runtime status', () => {
  it('does not claim all systems are ready when desktop Agent is unavailable on the web', () => {
    expect(getStudioRuntimeStatus('zho', { kind: 'web' })).toEqual({
      tone: 'warning',
      label: 'Web 模式',
      detail: 'Agent 仅桌面端可用；Workflow 与 Table 仍可使用',
    });
  });

  it('separates checking, ready, and failed Desktop Runtime states', () => {
    expect(getStudioRuntimeStatus('zho', { kind: 'checking' }).label).toBe('连接中');
    expect(getStudioRuntimeStatus('zho', { kind: 'ready' })).toEqual({
      tone: 'ready',
      label: '就绪',
      detail: 'Desktop Runtime 与 Flovart Agent 可用',
    });
    expect(getStudioRuntimeStatus('zho', { kind: 'error', message: 'IPC 失败' })).toEqual({
      tone: 'warning',
      label: 'Agent 不可用',
      detail: 'Desktop Runtime 连接失败：IPC 失败',
    });
  });
});
