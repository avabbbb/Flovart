// Local, privacy-preserving crash log for closed-beta diagnostics.
// Captures uncaught errors and unhandled promise rejections into a bounded
// ring buffer in localStorage. Nothing is sent over the network.

export const CRASH_LOG_STORAGE_KEY = 'flovart:crash-log';
export const CRASH_LOG_LIMIT = 50;

export type CrashLogEntry = {
  at: string;
  kind: 'error' | 'unhandledrejection' | 'react';
  message: string;
  stack?: string;
  source?: string;
};

const GOOGLE_KEY = /AIza[0-9A-Za-z_-]{20,}/g;
const OPENAI_KEY = /\bsk-[0-9A-Za-z_-]{16,}/g;
const BEARER = /(Bearer\s+)[0-9A-Za-z._~+/-]{12,}={0,2}/gi;
const NAMED_SECRET = /((?:api[_-]?key|token|secret|password)[\x22']?\s{0,3}[:=]\s{0,3}[\x22']?)[^\s\x22'&,;]{6,}/gi;

export function redactSecrets(text: string): string {
  return String(text ?? '')
    .replace(GOOGLE_KEY, '[REDACTED]')
    .replace(OPENAI_KEY, '[REDACTED]')
    .replace(BEARER, '$1[REDACTED]')
    .replace(NAMED_SECRET, '$1[REDACTED]');
}

function clip(value: string | undefined, max: number): string | undefined {
  return value === undefined ? undefined : redactSecrets(value).slice(0, max);
}

export function readCrashLog(): CrashLogEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(CRASH_LOG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordCrash(entry: Omit<CrashLogEntry, 'at'> & { at?: string }): void {
  try {
    const next: CrashLogEntry = {
      at: entry.at ?? new Date().toISOString(),
      kind: entry.kind,
      message: clip(entry.message, 1000) || '(no message)',
      stack: clip(entry.stack, 4000),
      source: clip(entry.source, 300),
    };
    const log = [...readCrashLog(), next].slice(-CRASH_LOG_LIMIT);
    globalThis.localStorage?.setItem(CRASH_LOG_STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Storage full or unavailable: diagnostics must never break the app.
  }
}

export function clearCrashLog(): void {
  try {
    globalThis.localStorage?.removeItem(CRASH_LOG_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function exportCrashLog(): string {
  const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env) || {};
  return JSON.stringify({
    app: 'flovart',
    version: env.VITE_APP_VERSION ?? 'dev',
    commit: env.VITE_APP_COMMIT_SHA ?? 'local',
    exportedAt: new Date().toISOString(),
    userAgent: globalThis.navigator?.userAgent ?? 'unknown',
    entries: readCrashLog(),
  }, null, 2);
}

function describeReason(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: reason.name + ': ' + reason.message, stack: reason.stack };
  if (typeof reason === 'string') return { message: reason };
  try {
    return { message: JSON.stringify(reason) };
  } catch {
    return { message: String(reason) };
  }
}

let installed = false;

export function installCrashLog(target: Window = window): () => void {
  if (installed) return () => {};
  installed = true;
  const onError = (event: ErrorEvent) => {
    const d = describeReason(event.error ?? event.message);
    const source = event.filename ? event.filename + ':' + event.lineno + ':' + event.colno : undefined;
    recordCrash({ kind: 'error', message: d.message, stack: d.stack, source });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const d = describeReason(event.reason);
    recordCrash({ kind: 'unhandledrejection', message: d.message, stack: d.stack });
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
    installed = false;
  };
}
