// @vitest-environment node
// 浏览器插件安全边界（网页画布通道上线后）：
// - 不注入 content script、不常驻页面权限、不暴露 web_accessible_resources、不内嵌 WebUI；
// - externally_connectable 只放行 Flovart 网页画布的几个 origin，不允许其他扩展连接；
// - Provider 请求只在 reverse-prompt.js，Key 只由 web-keys.js 处理；service worker 与 popup 不直接碰 Key 或厂商。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
const read = (path: string) => readFileSync(path, 'utf8');
const STAR = String.fromCharCode(42);
const scheme = (name: string) => name + ':' + '//';
const PROVIDER_PATTERN = /api.?key|openai|anthropic|gemini|openrouter/i;
const ALLOWED_WEB_HOSTS = ['flovart.avabbbb.com', '127.0.0.1:37522', 'localhost:37522'];

describe('browser extension security boundary', () => {
  it('keeps page access opt-in and lets only the Flovart web canvas connect', () => {
    expect(manifest.permissions).toContain('nativeMessaging');
    expect(manifest).not.toHaveProperty('content_scripts');
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest).not.toHaveProperty('web_accessible_resources');
    expect(manifest.optional_host_permissions).toEqual([
      scheme('http') + STAR + '/' + STAR,
      scheme('https') + STAR + '/' + STAR,
    ]);

    const connectable = manifest.externally_connectable;
    expect(connectable).not.toHaveProperty('ids');
    const matches: string[] = connectable?.matches ?? [];
    expect(matches.length).toBe(ALLOWED_WEB_HOSTS.length);
    for (const pattern of matches) {
      expect(pattern.endsWith('/' + STAR)).toBe(true);
      expect(pattern.slice(0, -2)).not.toContain(STAR);
      expect(ALLOWED_WEB_HOSTS).toContain(new URL(pattern.slice(0, -1)).host);
    }

    const buildScript = read('extension/build.mjs');
    expect(buildScript).not.toContain('vite build');
    expect(buildScript).not.toContain("resolve(output, 'app')");
  });

  it('confines Provider calls to reverse-prompt.js and keeps the shared core pure', () => {
    const worker = read('extension/background/service-worker.js');
    const popup = read('extension/popup/popup.js');
    expect(worker + '\n' + popup).not.toMatch(PROVIDER_PATTERN);

    const reverse = read('extension/background/reverse-prompt.js');
    expect(reverse).not.toMatch(/chrome\.storage|indexedDB/);

    const core = read('extension/background/reverse-prompt-core.js');
    expect(core).not.toMatch(/fetch\(|chrome\./);
  });

  it('resumes chunked transfers from the receiver offset', () => {
    const transfer = read('extension/background/media-transfer.js');
    const resumes = ['let offset = transfer?.receivedBytes || 0;', 'let offset = transfer.receivedBytes || 0;'];
    expect(resumes.some((line) => transfer.includes(line))).toBe(true);
    expect(transfer).not.toMatch(new RegExp('sequence\\s' + STAR + '\\' + STAR + '\\s' + STAR + 'transfer\\.chunkBytes'));
  });
});
