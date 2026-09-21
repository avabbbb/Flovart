import { getBrowserWorkflowBinding } from './browserWorkflowBinding';
import { loadDockConnection } from './dockCrewClient';
import { getWorkflowPersistenceError, useWorkflowStore } from '../components/workflow/store';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface SupportDiagnosticsInput {
  appVersion?: string;
  connectionUrl?: string | null;
  connectionStatus: string;
  connectionErrorCode?: string | null;
  clientId?: string | null;
  projectId?: string | null;
  revision?: number | null;
  activeHostIdentity?: string | null;
  writerStatus?: string | null;
  project?: { id: string; draftVersion?: number } | null;
  providerStatus?: string;
}

export interface SupportDiagnostics {
  schemaVersion: 1;
  generatedAt: string;
  app: { version: string; online: boolean; platform: string };
  runtime: { status: string; endpoint: string };
  host: { identity: string | null; writerStatus: string | null; clientId: string | null };
  project: { id: string | null; revision: number | null; draftVersion: number | null };
  provider: { status: string };
  recentErrorCodes: string[];
}

function loopbackOrigin(value: string | null | undefined) {
  if (!value) return 'not-connected';
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) ? url.origin : 'redacted';
  } catch {
    return 'redacted';
  }
}

function browserValue(read: () => string, fallback: string) {
  try {
    return read() || fallback;
  } catch {
    return fallback;
  }
}

export function buildSupportDiagnostics(input: SupportDiagnosticsInput): SupportDiagnostics {
  const projectId = input.projectId || input.project?.id || null;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: {
      version: input.appVersion || 'development',
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      platform: typeof navigator === 'undefined' ? 'unknown' : browserValue(() => navigator.platform, 'unknown'),
    },
    runtime: {
      status: input.connectionStatus,
      endpoint: loopbackOrigin(input.connectionUrl),
    },
    host: {
      identity: input.activeHostIdentity || null,
      writerStatus: input.writerStatus || null,
      clientId: input.clientId || null,
    },
    project: {
      id: projectId,
      revision: input.revision ?? null,
      draftVersion: input.project?.draftVersion ?? null,
    },
    provider: { status: input.providerStatus || 'not-observed' },
    recentErrorCodes: [input.connectionErrorCode].filter((code): code is string => Boolean(code)),
  };
}

export function serializeSupportDiagnostics(input: SupportDiagnosticsInput) {
  return JSON.stringify(buildSupportDiagnostics(input), null, 2);
}

/**
 * 实时采集脱敏诊断载荷 —— supportDiagnostics 的“重连”入口。
 *
 * `#/dock` 路由下线后该模块失去了唯一的调用方。这里提供一个 async collector，
 * 让任何设置/诊断表面只需一行 `serializeSupportDiagnostics(await collectSupportDiagnostics())`
 * 就能拿到已经过 redaction gate 的诊断 JSON——而不要求调用方自己拼装连接对象或读浏览器存储。
 *
 * 安全边界不变（`scripts/release-red-team.mjs` 静态扫描）：endpoint 只回传 loopback
 * origin 或 'redacted'；密钥 / 鉴权头 / bootstrap 令牌永不进入 payload。
 */
export async function collectSupportDiagnostics(options: {
  appVersion?: string;
  connectionStatus?: string;
  connectionErrorCode?: string | null;
  activeHostIdentity?: string | null;
  writerStatus?: string | null;
  clientId?: string | null;
  providerStatus?: string;
} = {}): Promise<SupportDiagnosticsInput> {
  const binding = getBrowserWorkflowBinding();
  const dock = binding ? null : loadDockConnection();
  const connectionUrl = binding?.url || dock?.url || null;
  const state = useWorkflowStore.getState();
  const project = state.projects.find(item => item.id === state.activeProjectId) || null;
  const persistence = getWorkflowPersistenceError();
  return {
    appVersion: options.appVersion,
    connectionUrl,
    connectionStatus: options.connectionStatus || (binding || dock ? 'ready' : 'offline'),
    connectionErrorCode: options.connectionErrorCode ?? (persistence ? persistence.operation : null),
    clientId: options.clientId ?? null,
    projectId: project?.id ?? null,
    revision: project?.draftVersion ?? null,
    activeHostIdentity: options.activeHostIdentity ?? null,
    writerStatus: options.writerStatus ?? null,
    project: project ? { id: project.id, draftVersion: project.draftVersion } : null,
    providerStatus: options.providerStatus,
  };
}
