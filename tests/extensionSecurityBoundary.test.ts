// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));

describe('thin browser extension security boundary', () => {
  it('uses Native Messaging without permanent page access or an embedded Flovart WebUI', () => {
    expect(manifest.permissions).toContain('nativeMessaging');
    expect(manifest).not.toHaveProperty('content_scripts');
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest).not.toHaveProperty('externally_connectable');
    expect(manifest).not.toHaveProperty('web_accessible_resources');
    expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);

    const buildScript = readFileSync('extension/build.mjs', 'utf8');
    expect(buildScript).not.toContain('vite build');
    expect(buildScript).not.toContain("resolve(output, 'app')");
  });

  it('contains no extension-side Provider credential or direct Provider call path', () => {
    const worker = readFileSync('extension/background/service-worker.js', 'utf8');
    const popup = readFileSync('extension/popup/popup.js', 'utf8');
    expect(`${worker}\n${popup}`).not.toMatch(/api.?key|openai|anthropic|gemini|openrouter/i);
    expect(worker).toContain('let offset = transfer.receivedBytes || 0;');
    expect(worker).not.toMatch(/sequence\s*\*\s*transfer\.chunkBytes/);
  });
});
