import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'integrations', 'studio');

describe('Studio host package contracts', () => {
  for (const host of ['photoshop', 'premiere', 'after-effects', 'resolve']) {
    it(`${host} declares a persistent panel and shared inspector`, () => {
      const manifest = JSON.parse(readFileSync(join(root, host, 'manifest.json'), 'utf8'));
      const html = readFileSync(join(root, host, 'index.html'), 'utf8');
      expect(manifest.entry || manifest.main).toBeTruthy();
      expect(manifest.panel || manifest.entrypoints).toBeTruthy();
      expect(existsSync(join(root, host, 'index.js'))).toBe(true);
      expect(html).toContain('shared/inspector.js');
      expect(readFileSync(join(root, host, 'index.js'), 'utf8')).not.toMatch(/api.?key|provider.?key|secret|token/i);
      if (host === 'after-effects') {
        expect(readFileSync(join(root, host, 'CSXS', 'manifest.xml'), 'utf8')).toContain('<Type>Panel</Type>');
        expect(readFileSync(join(root, host, 'CSXS', 'manifest.xml'), 'utf8')).toContain('<ScriptPath>./host.jsx</ScriptPath>');
        expect(existsSync(join(root, host, 'host.jsx'))).toBe(true);
        expect(existsSync(join(root, host, 'cep-bridge.js'))).toBe(true);
      }
      if (host === 'resolve') {
        expect(readFileSync(join(root, host, 'manifest.xml'), 'utf8')).toContain('<FilePath>main.js</FilePath>');
        expect(existsSync(join(root, host, 'main.js'))).toBe(true);
        expect(existsSync(join(root, host, 'canvas-url.js'))).toBe(true);
        expect(existsSync(join(root, host, 'preload.js'))).toBe(true);
      }
    });
  }
});
