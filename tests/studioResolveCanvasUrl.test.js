import { describe, expect, it } from 'vitest';
import { normalizeCanvasUrl, resolveCanvasUrl } from '../integrations/studio/resolve/canvas-url.js';

const testTempRoot = 'H:/WorkSpace_For_VsCode/React/Floavrt/.tmp/vitest';

describe('Resolve canvas URL discovery', () => {
  it('normalizes an explicit loopback URL to the Workflow route', () => {
    expect(normalizeCanvasUrl('http://localhost:49210/old?token=secret')).toBe('http://localhost:49210/#/app');
  });

  it('reads the launcher discovery file when no explicit URL is configured', () => {
    const fsApi = { readFileSync: () => JSON.stringify({ url: 'http://127.0.0.1:49211' }) };
    expect(resolveCanvasUrl({ env: { FLOVART_WEB_DISCOVERY: testTempRoot + '/flovart-web.json' }, fsApi, homeDir: testTempRoot })).toBe('http://127.0.0.1:49211/#/app');
  });

  it('fails closed when no discovered WebUI exists or the address is not loopback', () => {
    expect(() => resolveCanvasUrl({ env: {}, fsApi: { readFileSync: () => JSON.stringify({ url: 'https://example.com' }) }, homeDir: testTempRoot })).toThrow('未找到已启动的 Flovart WebUI');
  });
});
