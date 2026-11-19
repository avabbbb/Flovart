import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function webDiscoveryPath(env = process.env) {
  return env.IRIS_WEB_DISCOVERY || join(homedir(), '.iris', 'web.json');
}

function normalizeWebUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { return null; }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null;
  return url.origin;
}

export function readWebDiscovery(env = process.env) {
  const file = webDiscoveryPath(env);
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    const url = normalizeWebUrl(value?.url);
    if (!url) return null;
    return {
      url,
      pid: Number.isInteger(value?.pid) ? value.pid : null,
      startedAt: typeof value?.startedAt === 'string' ? value.startedAt : null,
      file,
    };
  } catch {
    return null;
  }
}

export function writeWebDiscovery({ url, pid } = {}, env = process.env) {
  const normalized = normalizeWebUrl(url);
  if (!normalized) throw new Error('WebUI discovery 只允许本机 loopback HTTP 地址。');
  const file = webDiscoveryPath(env);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify({ url: normalized, pid: Number.isInteger(pid) ? pid : null, startedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
  return { url: normalized, pid: Number.isInteger(pid) ? pid : null, file };
}

export function clearWebDiscovery(pid, env = process.env) {
  const current = readWebDiscovery(env);
  if (!current || (Number.isInteger(pid) && current.pid !== pid)) return false;
  try { unlinkSync(current.file); } catch { return false; }
  return true;
}
