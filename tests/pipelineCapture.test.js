import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertCaptureUrl, normalizeCaptureArgs } from '../tools/flovart/pipeline/capture.js';

const root = mkdtempSync(join(tmpdir(), 'capture-'));
writeFileSync(join(root, 'page.html'), '<h1>x</h1>');

describe('capture.ui argument boundary', () => {
  it('only opens loopback pages or files inside an authorized folder', () => {
    expect(assertCaptureUrl('http://localhost:5173/app', [root])).toBe('http://localhost:5173/app');
    expect(assertCaptureUrl('http://127.0.0.1:3000', [root])).toBe('http://127.0.0.1:3000/');
    expect(() => assertCaptureUrl('https://example.com', [root])).toThrow(expect.objectContaining({ code: 'PATH_NOT_AUTHORIZED' }));
    expect(() => assertCaptureUrl('http://192.168.1.2', [root])).toThrow(expect.objectContaining({ code: 'PATH_NOT_AUTHORIZED' }));
    expect(assertCaptureUrl(pathToFileURL(join(root, 'page.html')).href, [root])).toMatch(/^file:/);
    expect(() => assertCaptureUrl(pathToFileURL('/etc/hosts').href, [root])).toThrow(expect.objectContaining({ code: 'PATH_NOT_AUTHORIZED' }));
    expect(() => assertCaptureUrl(pathToFileURL(join(root, 'page.html')).href, [])).toThrow(expect.objectContaining({ code: 'PATH_NOT_AUTHORIZED' }));
    expect(() => assertCaptureUrl('javascript:alert(1)', [root])).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('normalizes steps, adds a final screenshot, and checks every step against the same boundary', () => {
    const plan = normalizeCaptureArgs({ url: 'http://localhost:5173', steps: [{ action: 'click', selector: '#go' }, { action: 'wait', ms: '200' }] }, [root]);
    expect(plan).toEqual({
      url: 'http://localhost:5173/', mode: 'screenshot', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
      steps: [{ action: 'click', selector: '#go' }, { action: 'wait', ms: 200 }, { action: 'screenshot' }],
    });
    expect(normalizeCaptureArgs({ url: 'http://localhost', mode: 'video', steps: [] }, [root]).steps).toEqual([]);
    expect(() => normalizeCaptureArgs({ url: 'http://localhost', steps: [{ action: 'goto', url: 'https://evil.test' }] }, [root])).toThrow(expect.objectContaining({ code: 'PATH_NOT_AUTHORIZED' }));
    expect(() => normalizeCaptureArgs({ url: 'http://localhost', steps: [{ action: 'eval', script: '1' }] }, [root])).toThrow(/action/);
    expect(() => normalizeCaptureArgs({ url: 'http://localhost', steps: [{ action: 'wait', ms: 60000 }] }, [root])).toThrow(/wait.ms/);
    expect(() => normalizeCaptureArgs({ url: 'http://localhost', viewport: { width: 50, height: 800 } }, [root])).toThrow(/viewport.width/);
    expect(() => normalizeCaptureArgs({ url: 'http://localhost', mode: 'gif' }, [root])).toThrow(/mode/);
  });
});
