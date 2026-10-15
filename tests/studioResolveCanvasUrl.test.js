import { describe, expect, it } from 'vitest';
import { buildCanvasHandoffUrl, normalizeCanvasUrl, resolveCanvasUrl } from '../integrations/studio/resolve/canvas-url.js';
import { resolveTestTempRoot } from '../scripts/test-temp-root.mjs';

const testTempRoot = resolveTestTempRoot(process.cwd(), 'vitest');

describe('Resolve canvas URL discovery', () => {
  it('normalizes an explicit loopback URL to the Workflow route', () => {
    expect(normalizeCanvasUrl('http://localhost:49210/old?token=secret')).toBe('http://localhost:49210/#/app');
  });

  it('reads the launcher discovery file when no explicit URL is configured', () => {
    const fsApi = { readFileSync: () => JSON.stringify({ url: 'http://127.0.0.1:49211' }) };
    expect(resolveCanvasUrl({ env: { FLOVART_WEB_DISCOVERY: testTempRoot + '/flovart-web.json' }, fsApi, homeDir: testTempRoot })).toBe('http://127.0.0.1:49211/#/app');
  });

  it('fails closed when no discovered WebUI exists or the address is not loopback', () => {
    expect(() => resolveCanvasUrl({ env: {}, fsApi: { readFileSync: () => JSON.stringify({ url: 'https://example.com' }) }, homeDir: testTempRoot })).toThrow('未找到已启动的 Iris WebUI');
  });

  it('adds a whitelisted clip handoff for Open in Iris and drops unsafe locator values', () => {
    const url = buildCanvasHandoffUrl('http://127.0.0.1:49211', {
      label: 'Shot 04', kind: 'video', locator: { projectId: 'resolve-a', timelineItemId: 'item-7', bad: '<x>', 'no-dash': '1' },
    });
    expect(url).toBe('http://127.0.0.1:49211/#/app?host=resolve&label=Shot+04&kind=video&loc.projectId=resolve-a&loc.timelineItemId=item-7');
    expect(buildCanvasHandoffUrl('http://127.0.0.1:49211', null)).toBe('http://127.0.0.1:49211/#/app');
    expect(buildCanvasHandoffUrl('https://example.com', { locator: { a: '1' } })).toBeNull();
  });
});
