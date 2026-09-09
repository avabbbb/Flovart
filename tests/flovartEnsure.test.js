import { describe, expect, it, vi } from 'vitest';
import { ensureFlovart, parseJsonOutput, startArguments } from '../tools/flovart/ensure.js';

describe('flovart ensure', () => {
  it('parses the existing start JSON without leaking its transport details', () => {
    expect(parseJsonOutput(`starting\n${JSON.stringify({ ok: true, agent: { url: 'http://127.0.0.1:17373' } }, null, 2)}`)).toEqual({
      ok: true,
      agent: { url: 'http://127.0.0.1:17373' },
    });
  });

  it('reuses a ready session without starting another Runtime', async () => {
    const startRunner = vi.fn();
    const statusReader = vi.fn().mockResolvedValue({ ready: true, agent: { status: 'ready' }, browserConnected: true, frontend: { status: 'ready' }, projectId: 'project-1', revision: 4 });
    await expect(ensureFlovart({ statusReader, startRunner })).resolves.toMatchObject({ ok: true, state: 'ready', browser: 'ready', projectId: 'project-1', revision: 4 });
    expect(startRunner).not.toHaveBeenCalled();
  });

  it('starts through the existing source launcher and returns only public readiness', async () => {
    const statusReader = vi.fn()
      .mockResolvedValueOnce({ ready: false, agent: { status: 'offline' }, browserConnected: false, frontend: { status: 'offline' } })
      .mockResolvedValueOnce({ ready: true, agent: { status: 'ready', url: 'http://127.0.0.1:17373' }, browserConnected: true, frontend: { status: 'ready', url: 'http://127.0.0.1:2818' }, projectId: 'project-1', revision: 42 });
    const startRunner = vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify({ ok: true }), stderr: '' });
    const result = await ensureFlovart({ statusReader, startRunner, cwd: process.cwd(), open: false });
    expect(result).toMatchObject({ ok: true, state: 'ready', frontend: 'ready', agent: 'ready', browser: 'ready' });
    expect(JSON.stringify(result)).not.toContain('17373');
    expect(startRunner).toHaveBeenCalledWith(expect.arrayContaining(['start', '--source', '--web', '--json', '--no-open']), expect.anything());
  });

  it('keeps the stable command separate from the developer command registry', () => {
    expect(startArguments(process.cwd(), true)).toEqual(['start', '--source', '--web', '--json', '--open']);
  });
});
