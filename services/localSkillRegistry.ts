// Local Skill registry — browser-side client for the local Agent service's
// /api/skills* endpoints. The browser cannot read/write the filesystem, so
// scanning, installing and uninstalling all happen inside the local Agent service
// (loopback HTTP + token, same transport as the Workflow workspace tools).

import { getManagedAgentConnection, type ManagedAgentConnection } from './managedAgentConnection';
import { SkillHubError } from './skillHubClient';
import type { SkillInputSlot } from './skillInputs';

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
  inputs?: SkillInputSlot[];
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
  /** 画布（当前或历史工程）→ 标准 Skill 包；验收通过且 install=true 才入库。 */
  draftFromCanvas?(input: CanvasSkillDraftInput): Promise<CanvasSkillDraftResult>;
}

export interface CanvasSkillDraftNode {
  id: string;
  type: string;
  title?: string;
  metadata: { prompt?: string; content?: string; config?: Record<string, unknown> };
}

export interface CanvasSkillDraftInput {
  id: string;
  name: string;
  description?: string;
  projectId: string;
  nodes: CanvasSkillDraftNode[];
  connections: Array<{ fromNodeId: string; toNodeId: string }>;
  nodeIds?: string[];
  install?: boolean;
}

export interface CanvasSkillDraftResult {
  installed: boolean;
  evaluation: { ok: boolean; checks: Array<{ id: string; ok: boolean; message?: string }> };
  draft: { id: string; handle: string; files: string[]; skillMd?: string };
  skill?: LocalSkillEntry;
}

/** 只把 Skill 需要的字段送出浏览器：不带媒体、存储键或本地路径。 */
export function canvasSkillDraftPayload(
  project: { id: string; nodes: ReadonlyArray<{ id: string; type: string; title?: string; metadata?: object }>; connections: ReadonlyArray<{ fromNodeId: string; toNodeId: string }> },
  nodeIds?: string[],
): Pick<CanvasSkillDraftInput, 'projectId' | 'nodes' | 'connections' | 'nodeIds'> {
  const wanted = nodeIds?.length ? new Set(nodeIds) : null;
  const nodes = project.nodes
    .filter(node => !wanted || wanted.has(node.id))
    .map(node => {
      const metadata = (node.metadata || {}) as Record<string, unknown>;
      const text = (value: unknown) => (typeof value === 'string' && !/^(?:data|blob|file):/i.test(value) ? value : undefined);
      const config = metadata.config && typeof metadata.config === 'object' && !Array.isArray(metadata.config) ? metadata.config as Record<string, unknown> : undefined;
      return { id: node.id, type: node.type, title: node.title, metadata: { prompt: text(metadata.prompt), content: text(metadata.content), ...(config ? { config } : {}) } };
    });
  const ids = new Set(nodes.map(node => node.id));
  return {
    projectId: project.id,
    nodes,
    connections: project.connections.filter(connection => ids.has(connection.fromNodeId) && ids.has(connection.toNodeId)).map(({ fromNodeId, toNodeId }) => ({ fromNodeId, toNodeId })),
    ...(nodeIds?.length ? { nodeIds } : {}),
  };
}

/** 画布 Skill 的本机 id：community.canvas-<时间戳>，满足包名规则且不随中文标题变化。 */
export function canvasSkillId(now = Date.now()): string {
  return `community.canvas-${now.toString(36)}`;
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

  async draftFromCanvas(input: CanvasSkillDraftInput): Promise<CanvasSkillDraftResult> {
    const { nodes, connections, ...rest } = input;
    const body = await this.request('/api/skills/draft', {
      method: 'POST',
      body: JSON.stringify({ ...rest, project: { id: input.projectId, nodes, connections } }),
    }) as Partial<CanvasSkillDraftResult>;
    if (!body.evaluation || !body.draft) throw new SkillRegistryError('FAILED', '画布转 Skill 失败：本机 Agent 没有返回草稿。');
    return { installed: Boolean(body.installed), evaluation: body.evaluation, draft: body.draft, ...(body.skill ? { skill: body.skill } : {}) };
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
