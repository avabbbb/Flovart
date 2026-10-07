const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function normalizeCanvasUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { return null; }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null;
  url.pathname = '/';
  url.search = '';
  url.hash = '/app';
  return url.toString();
}

function resolveCanvasUrl({ env = process.env, fsApi = fs, homeDir = os.homedir() } = {}) {
  let raw = String(env.FLOVART_CANVAS_URL || '').trim();
  if (!raw) {
    const discoveryFile = env.FLOVART_WEB_DISCOVERY || path.join(homeDir, '.flovart', 'web.json');
    try { raw = JSON.parse(fsApi.readFileSync(discoveryFile, 'utf8'))?.url || ''; } catch {}
  }
  const url = normalizeCanvasUrl(raw);
  if (!url) throw new Error('未找到已启动的 Iris WebUI，请先运行 Iris 启动器并连接 Link。');
  return url;
}

const SAFE_LOCATOR_KEY = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const SAFE_LOCATOR_VALUE = /^[\w.:\-/ ]{1,200}$/u;

/**
 * Open in Iris 交接：把当前片段的 opaque locator 放进 hash 查询参数（只在本机 loopback 上传递）。
 * 不含路径、Token 或素材字节；Canvas 侧按同一白名单解析（components/workflow/hostLink.ts）。
 */
function buildCanvasHandoffUrl(baseUrl, selection, host = 'resolve') {
  const url = normalizeCanvasUrl(baseUrl);
  if (!url) return null;
  if (!selection || typeof selection !== 'object' || !selection.locator || typeof selection.locator !== 'object') return url;
  const params = new URLSearchParams();
  params.set('host', host);
  if (selection.label) params.set('label', String(selection.label).slice(0, 120));
  params.set('kind', selection.kind === 'image' ? 'image' : 'video');
  let count = 0;
  for (const [key, value] of Object.entries(selection.locator)) {
    const text = String(value ?? '');
    if (!SAFE_LOCATOR_KEY.test(key) || !SAFE_LOCATOR_VALUE.test(text)) continue;
    params.set(`loc.${key}`, text);
    count += 1;
  }
  return count ? `${url}?${params.toString()}` : url;
}

module.exports = { normalizeCanvasUrl, resolveCanvasUrl, buildCanvasHandoffUrl };
