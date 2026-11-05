// WebDAV 设置同步：只同步渠道结构与模型列表，不上传 API Key 明文。
// 浏览器直连 WebDAV 需要服务端放行 CORS（Authorization、Depth、Content-Type 头与 PROPFIND/MKCOL/PUT 方法）。
import localforage from 'localforage';
import type { UserApiKey } from '../types';

export interface WebDavConfig {
  url: string;
  remoteDir: string;
  username: string;
  password: string;
  lastSyncAt?: number;
}

export const DEFAULT_WEBDAV_CONFIG: WebDavConfig = { url: '', remoteDir: 'flovart', username: '', password: '' };
export const WEBDAV_SYNC_FILE = 'flovart-settings.json';
export const WEBDAV_SYNC_VERSION = 1;

const configStore = localforage.createInstance({ name: 'flovart', storeName: 'webdav_config' });
const CONFIG_KEY = 'config';

export async function loadWebDavConfig(): Promise<WebDavConfig> {
  const saved = await configStore.getItem<Partial<WebDavConfig>>(CONFIG_KEY);
  return { ...DEFAULT_WEBDAV_CONFIG, ...(saved || {}) };
}

export async function saveWebDavConfig(config: WebDavConfig): Promise<void> {
  await configStore.setItem(CONFIG_KEY, config);
}

export type WebDavErrorCode = 'INVALID_CONFIG' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'NETWORK' | 'HTTP' | 'INVALID_PAYLOAD';

export class WebDavError extends Error {
  constructor(public readonly code: WebDavErrorCode, message: string, public readonly status?: number) {
    super(message);
    this.name = 'WebDavError';
  }
}

export function joinWebDavUrl(base: string, ...parts: string[]): string {
  const root = base.trim().replace(/\/+$/, '');
  const path = parts
    .flatMap(part => part.split('/'))
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return path ? root + '/' + path : root;
}

function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(username + ':' + password);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return 'Basic ' + btoa(binary);
}

function assertConfig(config: WebDavConfig): void {
  let parsed: URL;
  try {
    parsed = new URL(config.url.trim());
  } catch {
    throw new WebDavError('INVALID_CONFIG', 'WebDAV 地址无效');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new WebDavError('INVALID_CONFIG', 'WebDAV 地址需以 http 或 https 开头');
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function davRequest(fetchImpl: FetchLike, config: WebDavConfig, method: string, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (config.username || config.password) headers.set('Authorization', basicAuth(config.username, config.password));
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, method, headers });
  } catch (error) {
    throw new WebDavError('NETWORK', '无法连接 WebDAV 服务（网络不通，或服务端未放行跨域 CORS）：' + (error instanceof Error ? error.message : String(error)));
  }
  if (response.status === 401 || response.status === 403) {
    throw new WebDavError('UNAUTHORIZED', '用户名或密码错误，或没有该目录的权限', response.status);
  }
  return response;
}

function dirUrl(config: WebDavConfig): string {
  return joinWebDavUrl(config.url, config.remoteDir) + '/';
}

/** 测试连接：PROPFIND 远程目录，不存在时 MKCOL 创建（单层）。 */
export async function testWebDavConnection(config: WebDavConfig, fetchImpl: FetchLike = fetch): Promise<{ dirCreated: boolean }> {
  assertConfig(config);
  const url = dirUrl(config);
  const probe = await davRequest(fetchImpl, config, 'PROPFIND', url, { headers: { Depth: '0' } });
  if (probe.status === 207 || probe.ok) return { dirCreated: false };
  if (probe.status !== 404) throw new WebDavError('HTTP', 'WebDAV 返回 ' + probe.status, probe.status);
  const created = await davRequest(fetchImpl, config, 'MKCOL', url);
  if (created.status === 201 || created.ok) return { dirCreated: true };
  if (created.status === 409) throw new WebDavError('NOT_FOUND', '上级目录不存在，请先在网盘里建好上级目录', 409);
  throw new WebDavError('HTTP', '创建远程目录失败：' + created.status, created.status);
}

export interface SyncedChannel {
  id: string;
  provider: UserApiKey['provider'];
  name?: string;
  baseUrl?: string;
  capabilities: UserApiKey['capabilities'];
  models?: UserApiKey['models'];
  customModels?: string[];
  defaultModel?: string;
  isDefault?: boolean;
  extraConfig?: Record<string, string>;
  routeMappings?: UserApiKey['routeMappings'];
  pricingRules?: UserApiKey['pricingRules'];
  budgetPolicy?: UserApiKey['budgetPolicy'];
  streamUsage?: UserApiKey['streamUsage'];
  updatedAt: number;
}

export interface WebDavSyncPayload {
  app: 'flovart';
  version: number;
  exportedAt: number;
  channels: SyncedChannel[];
}

const SECRET_FIELD = /key|secret|token|password|credential/i;

function stripSecrets(extra: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!extra) return undefined;
  const entries = Object.entries(extra).filter(([field]) => !SECRET_FIELD.test(field));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** 生成同步快照：去掉 key、runtimeManaged、status 以及 extraConfig 中疑似密钥的字段。 */
export function buildSyncPayload(keys: UserApiKey[], now: number = Date.now()): WebDavSyncPayload {
  return {
    app: 'flovart',
    version: WEBDAV_SYNC_VERSION,
    exportedAt: now,
    channels: keys.filter(item => !item.runtimeManaged).map(item => ({
      id: item.id,
      provider: item.provider,
      name: item.name,
      baseUrl: item.baseUrl,
      capabilities: item.capabilities,
      models: item.models,
      customModels: item.customModels,
      defaultModel: item.defaultModel,
      isDefault: item.isDefault,
      extraConfig: stripSecrets(item.extraConfig),
      routeMappings: item.routeMappings,
      pricingRules: item.pricingRules,
      budgetPolicy: item.budgetPolicy,
      streamUsage: item.streamUsage,
      updatedAt: item.updatedAt,
    })),
  };
}

export function parseSyncPayload(raw: unknown): WebDavSyncPayload {
  const value = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!value || typeof value !== 'object') throw new WebDavError('INVALID_PAYLOAD', '远程同步文件不是有效 JSON');
  const payload = value as Partial<WebDavSyncPayload>;
  if (payload.app !== 'flovart' || !Array.isArray(payload.channels)) {
    throw new WebDavError('INVALID_PAYLOAD', '远程同步文件不是 Flovart 设置');
  }
  if (typeof payload.version !== 'number' || payload.version > WEBDAV_SYNC_VERSION) {
    throw new WebDavError('INVALID_PAYLOAD', '远程同步文件版本过新，请先升级 Flovart');
  }
  return payload as WebDavSyncPayload;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface SyncMergeResult {
  merged: UserApiKey[];
  /** 远端较新、已覆盖到本机的渠道 id */
  updatedIds: string[];
  /** 远端有、本机没有（缺 Key，未导入）的渠道 */
  missingLocally: SyncedChannel[];
}

/** 合并：同 id 且远端 updatedAt 更新时覆盖非密钥字段，本机 Key 与 runtimeManaged 保持不变。 */
export function mergeSyncPayload(local: UserApiKey[], payload: WebDavSyncPayload): SyncMergeResult {
  const remoteById = new Map(payload.channels.map(channel => [channel.id, channel]));
  const updatedIds: string[] = [];
  const merged = local.map(item => {
    const remote = remoteById.get(item.id);
    if (!remote || remote.updatedAt <= item.updatedAt) return item;
    updatedIds.push(item.id);
    const secretExtra = Object.fromEntries(Object.entries(item.extraConfig || {}).filter(([field]) => SECRET_FIELD.test(field)));
    const extraConfig = { ...(remote.extraConfig || {}), ...secretExtra };
    return {
      ...item,
      name: remote.name,
      baseUrl: remote.baseUrl,
      capabilities: remote.capabilities,
      models: remote.models,
      customModels: remote.customModels,
      defaultModel: remote.defaultModel,
      isDefault: remote.isDefault,
      extraConfig: Object.keys(extraConfig).length ? extraConfig : undefined,
      routeMappings: remote.routeMappings,
      pricingRules: remote.pricingRules,
      budgetPolicy: remote.budgetPolicy,
      streamUsage: remote.streamUsage,
      updatedAt: remote.updatedAt,
    };
  });
  const localIds = new Set(local.map(item => item.id));
  return { merged, updatedIds, missingLocally: payload.channels.filter(channel => !localIds.has(channel.id)) };
}

export async function pullWebDavSync(config: WebDavConfig, fetchImpl: FetchLike = fetch): Promise<WebDavSyncPayload | null> {
  assertConfig(config);
  const response = await davRequest(fetchImpl, config, 'GET', joinWebDavUrl(config.url, config.remoteDir, WEBDAV_SYNC_FILE));
  if (response.status === 404) return null;
  if (!response.ok) throw new WebDavError('HTTP', '读取远程同步文件失败：' + response.status, response.status);
  return parseSyncPayload(await response.text());
}

export async function pushWebDavSync(config: WebDavConfig, payload: WebDavSyncPayload, fetchImpl: FetchLike = fetch): Promise<void> {
  assertConfig(config);
  await testWebDavConnection(config, fetchImpl);
  const response = await davRequest(fetchImpl, config, 'PUT', joinWebDavUrl(config.url, config.remoteDir, WEBDAV_SYNC_FILE), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload, null, 2),
  });
  if (!response.ok) throw new WebDavError('HTTP', '上传同步文件失败：' + response.status, response.status);
}

/** 立即同步：拉取远端 → 合并较新的渠道 → 把合并结果推回远端。 */
export async function syncWebDav(config: WebDavConfig, local: UserApiKey[], fetchImpl: FetchLike = fetch, now: number = Date.now()): Promise<SyncMergeResult> {
  const remote = await pullWebDavSync(config, fetchImpl);
  const result = remote ? mergeSyncPayload(local, remote) : { merged: local, updatedIds: [], missingLocally: [] };
  await pushWebDavSync(config, buildSyncPayload(result.merged, now), fetchImpl);
  return result;
}
