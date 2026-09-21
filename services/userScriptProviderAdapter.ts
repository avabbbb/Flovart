import type { ProductModelMode, UserApiKey } from '../types';
import type {
  CanonicalGenerationInput,
  WorkflowGenerationCapability,
} from '../components/workflow/inputResolver';
import type {
  WorkflowGenerationReferenceRole,
} from '../components/workflow/types';
import type {
  ProviderAdapterContext,
  ProviderMaterializedReference,
  ProviderValidationResult,
  ProviderWireRequest,
  ProviderReferenceKind,
} from './providerGenerationAdapter';
import type { ProviderCancelResult, ProviderTaskHandle } from './providerAdapter';
import {
  providerGenerationAdapter,
  serializeProviderGenerationRequest,
  validateReferenceSet,
} from './providerGenerationAdapter';
import { displayError } from './displayError';

/**
 * User Provider 的“脚本”是受限 JSON mapping，而不是任意 JavaScript。
 * 这样浏览器只执行固定的请求解释器，不需要 eval/new Function，也不给配置读取
 * Canvas、React、localforage 或原始凭据的机会。
 */
export type UserScriptValue =
  | string
  | number
  | boolean
  | null
  | { $path: string }
  | { $map: { path: string; item: UserScriptValue } }
  | UserScriptValue[]
  | { [key: string]: UserScriptValue };

export interface UserScriptRequestDefinition {
  method?: 'POST' | 'PUT' | 'PATCH' | 'GET' | 'DELETE';
  path?: string;
  headers?: Record<string, UserScriptValue>;
  body?: UserScriptValue;
}

export interface UserScriptResponseDefinition {
  kind: 'image' | 'video' | 'text';
  mediaUrlPath?: string;
  base64Path?: string;
  mimeTypePath?: string;
  textPath?: string;
  taskIdPath?: string;
  statusPath?: string;
  errorPath?: string;
  successStatuses?: string[];
  failureStatuses?: string[];
}

export interface UserScriptCancelDefinition {
  request: UserScriptRequestDefinition;
  successPath?: string;
}

export interface UserScriptProviderDefinition {
  id: string;
  name?: string;
  version?: string;
  /** 只允许 HTTPS，禁止把任意本机/内网地址交给用户配置。 */
  endpoint: string;
  capabilities: readonly WorkflowGenerationCapability[];
  supportedReferenceKinds: readonly ProviderReferenceKind[];
  supportedReferenceRoles: readonly WorkflowGenerationReferenceRole[];
  maxReferences: Readonly<Record<ProviderReferenceKind, number>>;
  auth?: { header: string; prefix?: string };
  request: UserScriptRequestDefinition;
  response: UserScriptResponseDefinition;
  poll?: {
    request: UserScriptRequestDefinition;
    response: UserScriptResponseDefinition;
    intervalMs?: number;
    timeoutMs?: number;
  };
  cancel?: UserScriptCancelDefinition;
}

export interface UserScriptCredential {
  /** 只用于审计/错误关联；mapping 不可通过 path 访问它。 */
  referenceId: string;
  /** 由宿主在发出 HTTP 请求的最后一步读取，永不进入脚本 mapping context。 */
  read: () => string | undefined;
}

export interface UserScriptExecutionOptions {
  credential?: UserScriptCredential;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export type UserScriptProviderResult = {
  status: 'succeeded';
  result: { mediaUrl?: string; mimeType?: string; text?: string };
};

const DEFAULT_SUCCESS_STATUSES = ['succeeded', 'success', 'completed', 'complete', 'done', 'finished'];
const DEFAULT_FAILURE_STATUSES = ['failed', 'failure', 'error', 'canceled', 'cancelled', 'expired'];
const MEDIA_KINDS = new Set<ProviderReferenceKind>(['image', 'video', 'audio']);
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '::1' || host === '127.0.0.1' || host.startsWith('127.');
}

function assertSafeEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('User Provider endpoint 必须是完整 HTTPS URL。');
  }
  if (url.protocol !== 'https:') throw new Error('User Provider endpoint 只允许 HTTPS。');
  if (url.username || url.password || isLoopback(url.hostname)) {
    throw new Error('User Provider endpoint 不得包含凭据或指向本机地址。');
  }
  return url;
}

function assertRelativePath(path: string | undefined, label: string): void {
  if (!path) return;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) {
    throw new Error(`${label} 只能是同一 Provider endpoint 下的相对路径。`);
  }
}

function validateDefinition(definition: UserScriptProviderDefinition): void {
  if (!SAFE_ID.test(definition.id)) throw new Error('User Provider id 只能包含字母、数字、点、下划线和短横线。');
  const endpoint = assertSafeEndpoint(definition.endpoint);
  for (const request of [definition.request, definition.poll?.request, definition.cancel?.request]) {
    assertRelativePath(request?.path, 'User Provider request path');
  }
  if (definition.poll?.intervalMs !== undefined && (!Number.isFinite(definition.poll.intervalMs) || definition.poll.intervalMs < 0)) {
    throw new Error('User Provider poll interval 必须是非负数字。');
  }
  if (definition.poll?.timeoutMs !== undefined && (!Number.isFinite(definition.poll.timeoutMs) || definition.poll.timeoutMs <= 0)) {
    throw new Error('User Provider poll timeout 必须是正数。');
  }
  if (!definition.capabilities.length) throw new Error('User Provider 至少需要声明一个 generation capability。');
  for (const headerName of Object.keys(definition.request.headers || {})) {
    if (/^(?:cookie|host|proxy-|sec-)/i.test(headerName)) throw new Error(`User Provider 不允许声明受限 header：${headerName}`);
  }
  for (const request of [definition.poll?.request, definition.cancel?.request]) {
    for (const headerName of Object.keys(request?.headers || {})) {
      if (/^(?:cookie|host|proxy-|sec-)/i.test(headerName)) throw new Error(`User Provider 不允许声明受限 header：${headerName}`);
    }
  }
  for (const kind of MEDIA_KINDS) {
    const max = definition.maxReferences[kind];
    if (!Number.isInteger(max) || max < 0 || max > 64) throw new Error(`User Provider ${kind} reference limit 无效。`);
  }
  for (const kind of definition.supportedReferenceKinds) {
    if (!MEDIA_KINDS.has(kind)) throw new Error(`User Provider reference kind 无效：${kind}`);
  }
  if (definition.supportedReferenceKinds.some(kind => definition.maxReferences[kind] <= 0)) {
    throw new Error('声明为 supported 的 reference kind 必须有大于 0 的 maxReferences。');
  }
  if (!endpoint.pathname) throw new Error('User Provider endpoint 无效。');
}

function readPath(value: unknown, path?: string, item?: unknown): unknown {
  if (!path) return undefined;
  const normalized = path.trim();
  if (normalized === '$item') return item;
  const root = normalized.startsWith('$item.') ? item : undefined;
  const parts = normalized.startsWith('$item.') ? normalized.slice('$item.'.length).split('.') : normalized.split('.');
  let current: unknown = root === undefined ? value : root;
  for (const part of parts) {
    if (!part) continue;
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else if (isRecord(current)) current = current[part];
    else return undefined;
  }
  return current;
}

function resolveMapping(value: UserScriptValue, root: Record<string, unknown>, item?: unknown): unknown {
  if (Array.isArray(value)) return value.map(entry => resolveMapping(entry, root, item));
  if (!isRecord(value)) return value;
  const pathValue = value as { $path?: unknown };
  if (typeof pathValue.$path === 'string' && Object.keys(value).length === 1) {
    return readPath(root, pathValue.$path, item);
  }
  const mapValue = (value as { $map?: unknown }).$map;
  if (isRecord(mapValue) && typeof mapValue.path === 'string' && 'item' in mapValue) {
    const source = readPath(root, mapValue.path);
    if (!Array.isArray(source)) return [];
    return source.map(entry => resolveMapping(mapValue.item as UserScriptValue, root, entry));
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveMapping(entry, root, item)]));
}

function interpolatePath(path: string | undefined, taskId?: string): string | undefined {
  if (!path) return undefined;
  return path.replace(/\{\{taskId\}\}/g, encodeURIComponent(taskId || ''));
}

function requestUrl(endpoint: URL, path?: string): string {
  const resolved = new URL(endpoint.toString());
  const suffix = (interpolatePath(path) || '').replace(/^\/+/, '');
  if (suffix.includes('..')) throw new Error('User Provider request path 不得包含父级路径。');
  if (suffix) resolved.pathname = `${endpoint.pathname.replace(/\/$/, '')}/${suffix}`;
  if (resolved.origin !== endpoint.origin || resolved.protocol !== 'https:') {
    throw new Error('User Provider request 试图离开已声明的 HTTPS endpoint。');
  }
  return resolved.toString();
}

function requestUrlForTask(endpoint: URL, path: string | undefined, taskId: string): string {
  const resolved = new URL(endpoint.toString());
  const suffix = (interpolatePath(path, taskId) || '').replace(/^\/+/, '');
  if (suffix.includes('..')) throw new Error('User Provider poll/cancel path 不得包含父级路径。');
  if (suffix) resolved.pathname = `${endpoint.pathname.replace(/\/$/, '')}/${suffix}`;
  if (resolved.origin !== endpoint.origin || resolved.protocol !== 'https:') {
    throw new Error('User Provider poll/cancel path 试图离开已声明的 HTTPS endpoint。');
  }
  return resolved.toString();
}

function headerValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const result = String(value);
  if (/[\r\n]/.test(result)) throw new Error('User Provider header 不得包含换行。');
  return result;
}

function buildScriptInput(input: CanonicalGenerationInput, references: readonly ProviderMaterializedReference[]) {
  const materializedById = new Map(references.map(reference => [reference.resourceId, reference]));
  return {
    nodeId: input.nodeId,
    capability: input.capability,
    prompt: input.prompt,
    parameters: { ...input.parameters },
    textInputs: input.textInputs.map(resource => ({
      resourceId: resource.resourceId,
      kind: resource.kind,
      title: resource.title,
      text: resource.text,
      mimeType: resource.mimeType,
    })),
    references: input.references.map(reference => {
      const materialized = materializedById.get(reference.resource.resourceId);
      return {
        resourceId: reference.resource.resourceId,
        type: reference.resource.kind,
        role: reference.role,
        order: reference.order,
        label: reference.label || reference.resource.title,
        mimeType: materialized?.mimeType || reference.resource.mimeType,
        href: materialized?.href,
      };
    }),
  };
}

function defaultMime(kind: UserScriptResponseDefinition['kind']): string {
  return kind === 'video' ? 'video/mp4' : kind === 'image' ? 'image/png' : 'text/plain';
}

function safeMediaUrl(value: string): string {
  if (value.startsWith('data:')) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('User Provider 返回的媒体地址不是合法 URL。');
  }
  if (url.protocol !== 'https:' || isLoopback(url.hostname)) {
    throw new Error('User Provider 媒体地址只允许 HTTPS 公网地址或 data URL。');
  }
  return value;
}

function toDataUrl(value: string, mimeType: string): string {
  return value.startsWith('data:') ? value : `data:${mimeType};base64,${value}`;
}

function responseStatus(raw: unknown, definition: UserScriptResponseDefinition): string {
  const value = readPath(raw, definition.statusPath);
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function parseResponse(raw: unknown, definition: UserScriptResponseDefinition) {
  const status = responseStatus(raw, definition);
  const failures = (definition.failureStatuses || DEFAULT_FAILURE_STATUSES).map(value => value.toLowerCase());
  if (status && failures.includes(status)) {
    const detail = readPath(raw, definition.errorPath || 'error.message') || readPath(raw, 'message') || status;
    throw new Error(`User Provider ${String(detail).slice(0, 240)}`);
  }
  const taskId = readPath(raw, definition.taskIdPath);
  const mimeType = typeof readPath(raw, definition.mimeTypePath) === 'string'
    ? String(readPath(raw, definition.mimeTypePath))
    : defaultMime(definition.kind);
  const mediaUrl = readPath(raw, definition.mediaUrlPath);
  const base64 = readPath(raw, definition.base64Path);
  const text = readPath(raw, definition.textPath);
  const result = {
    status: status || undefined,
    taskId: typeof taskId === 'string' || typeof taskId === 'number' ? String(taskId) : undefined,
    mediaUrl: typeof mediaUrl === 'string' && mediaUrl ? safeMediaUrl(mediaUrl) : typeof base64 === 'string' && base64 ? toDataUrl(base64, mimeType) : undefined,
    mimeType,
    text: typeof text === 'string' ? text : undefined,
  };
  return result;
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text) return response.json?.().catch(() => ({})) || {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`User Provider 返回了非 JSON 响应 (${response.status})。`);
  }
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return;
  if (signal?.aborted) throw signal.reason || new DOMException('生成已停止', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('生成已停止', 'AbortError'));
    }, { once: true });
  });
}

export class UserScriptProviderAdapter {
  readonly kind = 'user-script' as const;
  readonly id: string;
  readonly definition: UserScriptProviderDefinition;
  private readonly endpoint: URL;

  constructor(definition: UserScriptProviderDefinition) {
    validateDefinition(definition);
    this.id = definition.id;
    this.definition = definition;
    this.endpoint = new URL(definition.endpoint);
  }

  getCapabilities(context: ProviderAdapterContext, _mode?: ProductModelMode) {
    return {
      provider: context.provider,
      routeId: context.routeId,
      productModelId: context.productModelId,
      supportedCapabilities: [...this.definition.capabilities],
      supportedReferenceKinds: [...this.definition.supportedReferenceKinds],
      supportedReferenceRoles: [...this.definition.supportedReferenceRoles],
      maxReferences: { ...this.definition.maxReferences },
    };
  }

  validate(input: CanonicalGenerationInput, context: ProviderAdapterContext): ProviderValidationResult {
    const capabilities = this.getCapabilities(context, input.parameters.generationSubmode);
    const errors = validateReferenceSet(
      input.capability,
      capabilities,
      input.references.map(reference => ({ kind: reference.resource.kind as ProviderReferenceKind, role: reference.role })),
    );
    return { ok: errors.length === 0, capabilities, errors };
  }

  serialize(
    input: CanonicalGenerationInput,
    references: readonly ProviderMaterializedReference[],
    context: ProviderAdapterContext,
  ): ProviderWireRequest {
    return serializeProviderGenerationRequest(input, references, context);
  }

  private buildRequest(
    request: UserScriptRequestDefinition,
    root: Record<string, unknown>,
    options: UserScriptExecutionOptions,
    taskId?: string,
  ): { url: string; init: RequestInit } {
    const headers = Object.fromEntries(Object.entries(request.headers || {}).flatMap(([name, value]) => {
      const resolved = headerValue(resolveMapping(value, root));
      return resolved === undefined ? [] : [[name, resolved]];
    }));
    if (this.definition.auth) {
      const secret = options.credential?.read();
      if (!secret) throw new Error('User Provider 需要一个可用的凭据引用。');
      headers[this.definition.auth.header] = `${this.definition.auth.prefix || 'Bearer '}${secret}`;
    }
    const mappedBody = request.body === undefined ? undefined : resolveMapping(request.body, root);
    const method = request.method || (mappedBody === undefined ? 'GET' : 'POST');
    if (mappedBody !== undefined && !Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
    return {
      url: taskId ? requestUrlForTask(this.endpoint, request.path, taskId) : requestUrl(this.endpoint, request.path),
      init: {
        method,
        headers,
        body: mappedBody === undefined || method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(mappedBody),
        signal: options.signal,
      },
    };
  }

  private async request(
    request: UserScriptRequestDefinition,
    root: Record<string, unknown>,
    options: UserScriptExecutionOptions,
    taskId?: string,
  ): Promise<{ response: Response; raw: unknown }> {
    const built = this.buildRequest(request, root, options, taskId);
    const fetcher = options.fetch || globalThis.fetch;
    if (!fetcher) throw new Error('当前环境没有可用的 fetch。');
    const response = await fetcher(built.url, built.init);
    const raw = await readResponse(response);
    if (!response.ok) {
      const detail = isRecord(raw) ? raw.message || raw.error : undefined;
      throw new Error(`User Provider 请求失败 (${response.status})${detail ? `：${String(detail).slice(0, 200)}` : ''}`);
    }
    return { response, raw };
  }

  async execute(
    input: CanonicalGenerationInput,
    references: readonly ProviderMaterializedReference[],
    context: ProviderAdapterContext,
    options: UserScriptExecutionOptions = {},
  ): Promise<UserScriptProviderResult> {
    const validation = this.validate(input, context);
    if (!validation.ok) throw new Error(validation.errors[0]?.message || 'User Provider 不支持当前生成输入。');
    const scriptInput = buildScriptInput(input, references);
    const root = { input: scriptInput };
    let taskHandle: ProviderTaskHandle | undefined;
    try {
      const submitted = await this.request(this.definition.request, root, options);
      let parsed = parseResponse(submitted.raw, this.definition.response);
      if (parsed.mediaUrl || parsed.text) {
        return { status: 'succeeded', result: { mediaUrl: parsed.mediaUrl, mimeType: parsed.mimeType, text: parsed.text } };
      }
      if (!parsed.taskId) throw new Error('User Provider 响应没有可用结果或 taskId。');
      if (!this.definition.poll) throw new Error('User Provider 返回了 taskId，但没有声明 poll parser。');

      const taskId = parsed.taskId;
      taskHandle = { providerId: this.id, modelId: context.routeId, taskId, metadata: { providerScriptId: this.id } };
      const startedAt = Date.now();
      const timeoutMs = this.definition.poll.timeoutMs || 600_000;
      let delay = this.definition.poll.intervalMs ?? 1000;
      while (Date.now() - startedAt <= timeoutMs) {
        await (options.sleep || wait)(delay, options.signal);
        const pollRoot = { ...root, taskId };
        const response = await this.request(this.definition.poll.request, pollRoot, options, taskId);
        parsed = parseResponse(response.raw, this.definition.poll.response);
        if (parsed.mediaUrl || parsed.text) {
          return { status: 'succeeded', result: { mediaUrl: parsed.mediaUrl, mimeType: parsed.mimeType, text: parsed.text } };
        }
        delay = Math.min(Math.max(delay * 2, 250), 8_000);
      }
      throw new Error('User Provider 任务轮询超时。');
    } catch (error) {
      if (taskHandle && options.signal?.aborted) await this.cancel(taskHandle, options);
      throw error;
    }
  }

  async cancel(handle: ProviderTaskHandle, options: UserScriptExecutionOptions = {}): Promise<ProviderCancelResult> {
    if (!this.definition.cancel) {
      return { canceled: false, reason: 'unsupported', upstreamStillRunning: true, message: 'User Provider 未声明取消映射。' };
    }
    try {
      const raw = await this.request(this.definition.cancel.request, { taskId: handle.taskId }, { ...options, signal: undefined }, handle.taskId);
      const success = this.definition.cancel.successPath ? readPath(raw.raw, this.definition.cancel.successPath) : true;
      return {
        canceled: success !== false,
        reason: success !== false ? 'ok' : 'not_cancellable',
        upstreamStillRunning: success === false,
        message: success === false ? 'User Provider 未确认取消。' : undefined,
      };
    } catch (error) {
      return {
        canceled: false,
        reason: 'network_error',
        upstreamStillRunning: true,
        message: displayError(error, 'User Provider 取消失败。'),
      };
    }
  }
}

export interface OfficialProviderAdapter {
  kind: 'official';
  id: 'official';
  generation: typeof providerGenerationAdapter;
}

export type ProviderGenerationExtension =
  | OfficialProviderAdapter
  | { kind: 'user-script'; id: string; generation: UserScriptProviderAdapter };

export const officialProviderAdapter: OfficialProviderAdapter = {
  kind: 'official',
  id: 'official',
  generation: providerGenerationAdapter,
};

export class ProviderGenerationExtensionRegistry {
  private readonly userScriptProviders = new Map<string, UserScriptProviderAdapter>();

  registerUserScript(definition: UserScriptProviderDefinition): UserScriptProviderAdapter {
    const adapter = new UserScriptProviderAdapter(definition);
    this.userScriptProviders.set(adapter.id, adapter);
    return adapter;
  }

  unregisterUserScript(id: string): boolean {
    return this.userScriptProviders.delete(id);
  }

  getUserScript(id?: string): UserScriptProviderAdapter | undefined {
    return id ? this.userScriptProviders.get(id) : undefined;
  }

  listUserScripts(): UserScriptProviderAdapter[] {
    return [...this.userScriptProviders.values()];
  }

  clear(): void {
    this.userScriptProviders.clear();
  }
}

export const providerGenerationExtensionRegistry = new ProviderGenerationExtensionRegistry();

export function registerUserScriptProvider(definition: UserScriptProviderDefinition): UserScriptProviderAdapter {
  return providerGenerationExtensionRegistry.registerUserScript(definition);
}

export function unregisterUserScriptProvider(id: string): boolean {
  return providerGenerationExtensionRegistry.unregisterUserScript(id);
}

export function getUserScriptProvider(id?: string): UserScriptProviderAdapter | undefined {
  return providerGenerationExtensionRegistry.getUserScript(id);
}

export function listUserScriptProviders(): UserScriptProviderAdapter[] {
  return providerGenerationExtensionRegistry.listUserScripts();
}

export function getUserScriptProviderId(key?: UserApiKey): string | undefined {
  if (!key || key.runtimeManaged || key.provider !== 'custom') return undefined;
  return key.extraConfig?.providerScriptId || key.extraConfig?.userScriptProviderId;
}

export function getUserScriptProviderForKey(key?: UserApiKey): UserScriptProviderAdapter | undefined {
  return getUserScriptProvider(getUserScriptProviderId(key));
}

export function resolveProviderGenerationExtension(key?: UserApiKey): ProviderGenerationExtension {
  const userScript = getUserScriptProviderForKey(key);
  return userScript
    ? { kind: 'user-script', id: userScript.id, generation: userScript }
    : officialProviderAdapter;
}

export function executeUserScriptProvider(
  adapter: UserScriptProviderAdapter,
  input: CanonicalGenerationInput,
  references: readonly ProviderMaterializedReference[],
  context: ProviderAdapterContext,
  options: UserScriptExecutionOptions = {},
): Promise<UserScriptProviderResult> {
  return adapter.execute(input, references, context, options);
}

export function clearUserScriptProviders(): void {
  providerGenerationExtensionRegistry.clear();
}
