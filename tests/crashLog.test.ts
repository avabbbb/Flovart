// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { CRASH_LOG_LIMIT, clearCrashLog, exportCrashLog, installCrashLog, readCrashLog, recordCrash, redactSecrets } from '../utils/crashLog';

describe('crashLog', () => {
  afterEach(() => clearCrashLog());

  it('redacts API keys and bearer tokens', () => {
    const out = redactSecrets('key AIzaSyA1234567890abcdefghijklmn Bearer abcdefghijklmnop sk-abcdefghijklmnopqrst apiKey=supersecret123');
    expect(out).not.toMatch(/AIzaSy|abcdefghijklmnop|sk-abc|supersecret/);
    expect(out).toContain('[REDACTED]');
  });

  it('keeps a bounded ring buffer', () => {
    for (let i = 0; i < CRASH_LOG_LIMIT + 5; i += 1) recordCrash({ kind: 'error', message: 'e' + i });
    const log = readCrashLog();
    expect(log).toHaveLength(CRASH_LOG_LIMIT);
    expect(log[log.length - 1].message).toBe('e' + (CRASH_LOG_LIMIT + 4));
  });

  it('captures unhandled rejections and exports diagnostics', () => {
    const dispose = installCrashLog(window);
    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: new Error('boom AIzaSyA1234567890abcdefghijklmn') });
    window.dispatchEvent(event);
    dispose();
    const log = readCrashLog();
    expect(log[0].kind).toBe('unhandledrejection');
    expect(log[0].message).toContain('boom');
    expect(log[0].message).not.toContain('AIzaSy');
    expect(JSON.parse(exportCrashLog()).entries).toHaveLength(1);
  });
});
