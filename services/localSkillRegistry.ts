// Local Skill registry — browser-side client for the local Agent service's
// /api/skills* endpoints. The browser cannot read/write the filesystem, so
// scanning, installing and uninstalling all happen inside the local Agent service
// (loopback HTTP + token, same transport as the Workflow workspace tools).

import { getManagedAgentConnection, type ManagedAgentConnection } from './managedAgentConnection';
import { SkillHubError } from './skillHubClient';

export type LocalSkillKind = 'production' | 'coding-agent';

export interface LocalSkillEntry {
  id: string;
  name: string;
  description: string;
  version: string | null;
  kind: LocalSkillKind;
  trustTier: string;
  /** where the package lives: project .agents/skills, user coding-agent dir, app dir */
  location: 'project' | 'user-coding-agent' | 'app';
  packageDir: string;
  contentHash: string | null;
  fileCount: number;
  hubId?: string;
  installedAt?: string;
}

export interface LocalSkillManifest {
  id: string;
  version: string;
  contentHash: string;
  displayName: string;
  trustTier: string;
  capabilities: string[];
  gates: Array<{ id: string; type: string }>;
  permissions: { network: string; secrets: string; filesystem: string };
  files: Array<{ path: string; size: number }>;
}

export class SkillRegistryError extends Error {
  constructor(readonly code: 'UNAVAILABLE' | 'NOT_FOUND' | 'REJECTED' | 'FAILED', message: string) {
    super(message);
    this.name = 'SkillRegistryError';
  }
}

function asError(cause: unknown): SkillRegistryError {
  if (cause instanceof SkillRegistryError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new SkillRegistryError('FAILED', message);
}

export interface SkillRegistryClient {
  listLocalSkills(): Promise<LocalSkillEntry[]>;
  getSkillManifest(id: string): Promise<LocalSkillManifest>;
  installFromHub(id: string, hubUrl: string): Promise<LocalSkillEntry>;
  uninstallSkill(id: string): Promise<void>;
}

export class ManagedSkillRegistryClient implements SkillRegistryClient {
  constructor(
    private readonly connection: ManagedAgentConnection,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), 15_000);
    if (init?.signal) {
      if (init.signal.aborted) controller.abort();
      else init.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    let response: Response;
    try {
      response = await this.fetcher(`${this.connection.url}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'x-flovart-agent-token': this.connection.token,
          ...(init?.body ? { 'content-type': 'application/json' } : {}),
          ...(init?.headers || {}),
        },
      });
    } catch (err) {
      if (controller.signal.aborted && !(init?.signal?.aborted)) {
        throw new SkillRegistryError('UNAVAILABLE', '本机 Skill 注册表请求超时（15s），请确认本地 Agent 服务响应正常。');
      }
      throw new SkillRegistryError('UNAVAILABLE', '本机 Skill 注册表不可用：请确认桌面端与本地 Agent 服务已启动。');
    } finally {
      clearTimeout(timer);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || (body && typeof body === 'object' && (body as { ok?: boolean }).ok === false)) {
      const message = (body as { error?: { message?: string } })?.error?.message
        || (body as { error?: string })?.error
        || `本机 Skill 注册表返回 HTTP ${response.status}`;
      const code: SkillRegistryError['code'] = response.status === 404 ? 'NOT_FOUND' : 'FAILED';
      throw new SkillRegistryError(code, String(message));
    }
    return body;
  }

  async listLocalSkills(): Promise<LocalSkillEntry[]> {
    const body = await this.request('/api/skills');
    const skills = (body as { skills?: unknown }).skills;
    return Array.isArray(skills) ? skills as LocalSkillEntry[] : [];
  }

  async getSkillManifest(id: string): Promise<LocalSkillManifest> {
    const body = await this.request(`/api/skills/${encodeURIComponent(id)}`);
    const manifest = (body as { manifest?: unknown }).manifest;
    if (!manifest || typeof manifest !== 'object') throw new SkillRegistryError('NOT_FOUND', `Skill ${id} 不在本机注册表中。`);
    return manifest as LocalSkillManifest;
  }

  async installFromHub(id: string, hubUrl: string): Promise<LocalSkillEntry> {
    const body = await this.request('/api/skills/install', {
      method: 'POST',
      body: JSON.stringify({ id, hubUrl }),
    });
    const skill = (body as { skill?: unknown }).skill;
    if (!skill || typeof skill !== 'object') throw new SkillRegistryError('REJECTED', `安装 ${id} 失败。`);
    return skill as LocalSkillEntry;
  }

  async uninstallSkill(id: string): Promise<void> {
    await this.request('/api/skills/uninstall', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  }
}

/** Connect once and return a ready registry client, or null when no local Agent service exists. */
export async function createLocalSkillRegistry(
  options: { discover?: () => Promise<ManagedAgentConnection | null> } = {},
): Promise<SkillRegistryClient | null> {
  const discover = options.discover || getManagedAgentConnection;
  const connection = await discover();
  return connection ? new ManagedSkillRegistryClient(connection) : null;
}

export function skillRegistryErrorMessage(cause: unknown): string {
  if (cause instanceof SkillHubError) return cause.message;
  if (cause instanceof SkillRegistryError) return cause.message;
  return cause instanceof Error ? cause.message : String(cause);
}

export { SkillHubError };
