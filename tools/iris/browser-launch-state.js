import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const BROWSER_LAUNCH_PENDING_MS = 60_000;

function statePath(env = process.env) {
  return env.IRIS_BROWSER_LAUNCH_STATE || join(homedir(), '.iris', 'browser-launch.json');
}

function origin(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' && new Set(['127.0.0.1', 'localhost', '[::1]']).has(url.hostname)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function tokenFingerprint(token) {
  return createHash('sha256').update(String(token || '')).digest('hex').slice(0, 16);
}

export function browserLaunchStatePath(env = process.env) {
  return statePath(env);
}

export function readBrowserLaunchState(env = process.env, now = Date.now()) {
  const file = statePath(env);
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    const openedAt = Number(value?.openedAt);
    const frontendUrl = origin(value?.frontendUrl);
    const agentUrl = value?.agentUrl ? origin(value.agentUrl) : null;
    if (!Number.isFinite(openedAt) || !frontendUrl || (value?.agentUrl && !agentUrl)) return null;
    if (now - openedAt < 0 || now - openedAt > BROWSER_LAUNCH_PENDING_MS) return null;
    return { frontendUrl, agentUrl, tokenFingerprint: String(value?.tokenFingerprint || ''), openedAt, file };
  } catch {
    return null;
  }
}

export function isBrowserLaunchPending(state, { frontendUrl, connection, now = Date.now() } = {}) {
  if (!state || state.frontendUrl !== origin(frontendUrl)) return false;
  const agentUrl = connection?.url ? origin(connection.url) : null;
  if (state.agentUrl !== agentUrl) return false;
  if (state.tokenFingerprint !== tokenFingerprint(connection?.token)) return false;
  return now - state.openedAt >= 0 && now - state.openedAt <= BROWSER_LAUNCH_PENDING_MS;
}

export function writeBrowserLaunchState({ frontendUrl, connection, openedAt = Date.now() } = {}, env = process.env) {
  const normalizedFrontendUrl = origin(frontendUrl);
  const agentUrl = connection?.url ? origin(connection.url) : null;
  if (!normalizedFrontendUrl || (connection?.url && !agentUrl)) return null;
  const file = statePath(env);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify({
    frontendUrl: normalizedFrontendUrl,
    agentUrl,
    tokenFingerprint: tokenFingerprint(connection?.token),
    openedAt,
  }, null, 2)}\n`, 'utf8');
  try {
    renameSync(temporary, file);
  } catch {
    try { unlinkSync(file); } catch {}
    renameSync(temporary, file);
  }
  return { frontendUrl: normalizedFrontendUrl, agentUrl, openedAt, file };
}

export function clearBrowserLaunchState(env = process.env) {
  const file = statePath(env);
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}
