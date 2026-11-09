import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistAgentConfig } from '../agent/persist-config.js';

const TOKEN = 'persistent-token-should-never-be-logged-1234';

function eperm() {
  const error = new Error('EPERM: operation not permitted, open agent.json token=' + TOKEN);
  error.code = 'EPERM';
  return error;
}

describe('persistAgentConfig', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('saves and returns true when the write succeeds', () => {
    const save = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = { url: '', token: TOKEN, origins: [''] };
    expect(persistAgentConfig(config, 'authorized origin', save)).toBe(true);
    expect(save).toHaveBeenCalledWith(config);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the in-memory config and returns false on EPERM, logging only code and context', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = { url: '', token: TOKEN, origins: [''], origin: '' };
    const before = JSON.parse(JSON.stringify(config));
    expect(() => persistAgentConfig(config, 'authorized origin', () => { throw eperm(); })).not.toThrow();
    expect(persistAgentConfig(config, 'authorized origin', () => { throw eperm(); })).toBe(false);
    expect(config).toEqual(before);
    const logged = warn.mock.calls.map(args => args.join(' ')).join('\n');
    expect(logged).toContain('EPERM');
    expect(logged).toContain('authorized origin');
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain('operation not permitted');
  });

  it('reports UNKNOWN for errors without a code and still does not throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(persistAgentConfig({ token: TOKEN }, 'listen url', () => { throw new Error('disk full ' + TOKEN); })).toBe(false);
    const logged = warn.mock.calls.map(args => args.join(' ')).join('\n');
    expect(logged).toContain('UNKNOWN');
    expect(logged).toContain('listen url');
    expect(logged).not.toContain(TOKEN);
  });
});
