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
  if (!url) throw new Error('未找到已启动的 Flovart WebUI，请先运行 Flovart 启动器并连接 Link。');
  return url;
}

module.exports = { normalizeCanvasUrl, resolveCanvasUrl };
