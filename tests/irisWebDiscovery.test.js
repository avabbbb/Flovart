import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearWebDiscovery, readWebDiscovery, writeWebDiscovery } from '../tools/iris/web-discovery.js';

describe('WebUI discovery record', () => {
  it('stores only a loopback URL and process metadata', () => {
    const directory = mkdtempSync(join(tmpdir(), 'iris-web-discovery-'));
    try {
      const env = { IRIS_WEB_DISCOVERY: join(directory, 'web.json') };
      expect(writeWebDiscovery({ url: 'http://127.0.0.1:43127/path', pid: 1234 }, env)).toMatchObject({ url: 'http://127.0.0.1:43127', pid: 1234 });
      expect(readWebDiscovery(env)).toMatchObject({ url: 'http://127.0.0.1:43127', pid: 1234 });
      expect(JSON.stringify(readWebDiscovery(env))).not.toMatch(/token|secret/i);
      expect(clearWebDiscovery(1234, env)).toBe(true);
      expect(readWebDiscovery(env)).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
