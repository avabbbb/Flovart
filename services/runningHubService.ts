/**
 * RunningHub API Service
 * Docs: https://www.runninghub.cn/ (ComfyUI-based API)
 */

const RH_BASE = 'https://www.runninghub.cn/openapi/v2';
const POLL_INTERVAL = 5000; // 5s
const MAX_POLL_ATTEMPTS = 120; // 10 minutes max

// 已通过实跑验证的 RunningHub 标准模型端点（2026-06-24 验证）
// 这些端点使用 /openapi/v2/<endpoint> + Bearer 认证，字段为 prompt/resolution/imageUrls
export const BUILTIN_RUNNINGHUB_MODELS: Array<{ id: string; capability: 'image' | 'video'; description: string }> = [
  { id: 'rhart-image-n-g31-flash/text-to-image', capability: 'image', description: 'Flash 文生图（快、便宜，1k/2k/4k）' },
  { id: 'rhart-image-n-g31-flash/image-to-image', capability: 'image', description: 'Flash 图生图（快、便宜，需 imageUrls + resolution）' },
  { id: 'rhart-image-g-2/image-to-image', capability: 'image', description: 'G-2 图生图（高质量，需 imageUrls）' },
  { id: 'rhart-video-v3.1-fast/image-to-video', capability: 'video', description: 'V3.1 Fast 图生视频（需 imageUrls + prompt）' },
  { id: 'rhart-video-v3.1-fast/start-end-to-video', capability: 'video', description: 'V3.1 Fast 首尾帧生视频（需 firstFrameUrl/lastFrameUrl）' },
  { id: 'rhart-video/sparkvideo-2.0/image-to-video', capability: 'video', description: 'SparkVideo 2.0 图生视频（需 imageUrls）' },
  { id: 'rhart-video/sparkvideo-2.0/multimodal-video', capability: 'video', description: 'SparkVideo 2.0 多模态视频（需 imageUrls/videoUrls/audioUrls）' },
];

export interface RHTaskResult {
  url: string;
  nodeId: string;
  outputType: string; // png, mp4, txt, etc.
  text: string | null;
}

export interface RHTaskResponse {
  taskId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  errorCode: string;
  errorMessage: string;
  results: RHTaskResult[] | null;
  clientId: string;
  usage?: {
    consumeMoney: string | null;
    consumeCoins: string | null;
    taskCostTime: string;
    thirdPartyConsumeMoney: string | null;
  };
}

export interface RHSubmitPayload {
  webhookUrl?: string;
  [key: string]: unknown; // RunningHub standard model fields, e.g. 12##text
}

export interface RHRunOptions {
  baseUrl?: string;
  signal?: AbortSignal;
  onProgress?: (status: RHTaskResponse['status'], attempt: number) => void;
}

type RHDebugContext = {
  baseUrl: string;
  modelEndpoint?: string;
  submitUrl?: string;
  taskId?: string;
  payload?: RHSubmitPayload;
  response?: Partial<RHTaskResponse> & Record<string, unknown>;
};

function rhHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function rhResponseError(json: any, phase: string) {
  const code = firstString(json?.errorCode, json?.code);
  const directMessage = firstString(
    json?.errorMessage,
    json?.msg,
    json?.message,
    json?.failedReason?.exception_message,
    json?.failedReason?.message,
  );
  const message = firstString(
    directMessage,
    json?.promptTips,
  );
  const failed = String(json?.status || '').toUpperCase() === 'FAILED';
  if (!failed && (!code || code === '0') && !directMessage) return '';
  const codeText = code && code !== '0' ? ` (${code})` : '';
  return `${phase} failed${codeText}: ${message || 'Unknown error'}`;
}

function rhBase(baseUrl?: string) {
  return (baseUrl || RH_BASE).trim().replace(/\/+$/, '');
}

function truncateDebugText(value: string, max = 120) {
  return value.length <= max ? value : `${value.slice(0, max)}...(${value.length})`;
}

function summarizeDebugUrl(value: string) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${truncateDebugText(parsed.pathname || '/', 72)}`;
  } catch {
    return truncateDebugText(value);
  }
}

function summarizePayloadValue(key: string, value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      count: value.length,
      sample: value.slice(0, 3).map(item => summarizePayloadValue(key, item)),
    };
  }
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) return summarizeDebugUrl(value);
    if (/(^|##)(text|prompt)$/i.test(key) || /(?:prompt|description|caption)/i.test(key)) {
      return `[text ${value.length} chars]`;
    }
    return truncateDebugText(value, 48);
  }
  if (value && typeof value === 'object') {
    return '[object]';
  }
  return value;
}

function summarizePayload(payload?: RHSubmitPayload) {
  if (!payload) return undefined;
  return Object.fromEntries(
    Object.entries(payload)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, summarizePayloadValue(key, value)]),
  );
}

function summarizeResponse(response?: Partial<RHTaskResponse> & Record<string, unknown>) {
  if (!response) return undefined;
  return {
    status: firstString(response.status),
    taskId: firstString(response.taskId),
    errorCode: firstString(response.errorCode, response.code),
    errorMessage: firstString(
      response.errorMessage,
      response.message,
      response.msg,
      (response as any)?.failedReason?.exception_message,
      (response as any)?.failedReason?.message,
    ),
    resultCount: Array.isArray(response.results) ? response.results.length : undefined,
  };
}

function runningHubDebugContext(baseUrl: string, modelEndpoint?: string, payload?: RHSubmitPayload): RHDebugContext {
  const normalizedEndpoint = modelEndpoint ? normalizeRunningHubModelEndpoint(modelEndpoint) : '';
  const normalizedBaseUrl = rhBase(baseUrl);
  return {
    baseUrl: normalizedBaseUrl,
    modelEndpoint: normalizedEndpoint || undefined,
    submitUrl: normalizedEndpoint ? `${normalizedBaseUrl}/${normalizedEndpoint}` : undefined,
    payload,
  };
}

function formatRunningHubDebug(context: RHDebugContext) {
  return `\n[RunningHub Debug] ${JSON.stringify({
    baseUrl: context.baseUrl,
    modelEndpoint: context.modelEndpoint,
    submitUrl: context.submitUrl,
    taskId: context.taskId,
    payload: summarizePayload(context.payload),
    response: summarizeResponse(context.response),
  }, null, 2)}`;
}

function withRunningHubDebug(message: string, context: RHDebugContext) {
  const debug = formatRunningHubDebug(context);
  if (typeof console !== 'undefined') {
    console.error('[RunningHub Debug]', {
      baseUrl: context.baseUrl,
      modelEndpoint: context.modelEndpoint,
      submitUrl: context.submitUrl,
      taskId: context.taskId,
      payload: summarizePayload(context.payload),
      response: summarizeResponse(context.response),
    });
  }
  return `${message}${debug}`;
}

export function normalizeRunningHubModelEndpoint(modelEndpoint?: string) {
  let value = (modelEndpoint || '').trim().replace(/\\/g, '/');
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      value = parsed.pathname || '';
    } catch {
      return '';
    }
  }
  value = value
    .split('#')[0]
    .split('?')[0]
    .trim()
    .replace(/^\/+/, '')
    .replace(/^openapi\/v2\/?/i, '')
    .replace(/^runninghub\/+/i, '')
    .replace(/\/+$/, '');
  return value;
}

export function isLikelyRunningHubModelEndpoint(modelEndpoint?: string) {
  const normalized = normalizeRunningHubModelEndpoint(modelEndpoint);
  if (!normalized) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) return false;
  if (/^(query|page-api)$/i.test(normalized)) return false;
  if (/^media\/upload\/binary$/i.test(normalized)) return false;
  if (/^(call-api|search-api|runninghub-api-doc)/i.test(normalized)) return false;
  return true;
}

export function assertRunningHubModelEndpoint(modelEndpoint?: string) {
  const normalized = normalizeRunningHubModelEndpoint(modelEndpoint);
  if (!isLikelyRunningHubModelEndpoint(normalized)) {
    throw new Error('RunningHub 模型 ID 无效，请先在设置中点击"获取模型"并重新选择官方标准模型。');
  }
  return normalized;
}

function rhTaskUrl(baseUrl: string, modelEndpoint: string) {
  return `${rhBase(baseUrl)}/${assertRunningHubModelEndpoint(modelEndpoint)}`;
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason || new DOMException('RunningHub request aborted', 'AbortError');
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException('RunningHub request aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('RunningHub request aborted', 'AbortError'));
    }, { once: true });
  });
}

/** Submit a task to a RunningHub model endpoint */
export async function rhSubmitTask(
  apiKey: string,
  modelEndpoint: string,
  payload: RHSubmitPayload,
  options: Pick<RHRunOptions, 'baseUrl' | 'signal'> = {},
): Promise<RHTaskResponse> {
  assertNotAborted(options.signal);
  const debugContext = runningHubDebugContext(options.baseUrl || RH_BASE, modelEndpoint, payload);
  const url = rhTaskUrl(options.baseUrl || RH_BASE, modelEndpoint);

  const res = await fetch(url, {
    signal: options.signal,
    method: 'POST',
    headers: rhHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(withRunningHubDebug(`RunningHub submit failed (${res.status}): ${text}`, debugContext));
  }
  const json = await res.json();
  const error = rhResponseError(json, 'RunningHub submit');
  if (error) throw new Error(withRunningHubDebug(error, { ...debugContext, response: json }));
  return json;
}

/** Query task status */
export async function rhQueryTask(
  apiKey: string,
  taskId: string,
  options: Pick<RHRunOptions, 'baseUrl' | 'signal'> = {},
): Promise<RHTaskResponse> {
  assertNotAborted(options.signal);
  const res = await fetch(`${rhBase(options.baseUrl)}/query`, {
    signal: options.signal,
    method: 'POST',
    headers: rhHeaders(apiKey),
    body: JSON.stringify({ taskId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(withRunningHubDebug(`RunningHub query failed (${res.status}): ${text}`, {
      baseUrl: rhBase(options.baseUrl),
      taskId,
    }));
  }
  const json = await res.json();
  const error = rhResponseError(json, 'RunningHub query');
  if (error) throw new Error(withRunningHubDebug(error, {
    baseUrl: rhBase(options.baseUrl),
    taskId,
    response: json,
  }));
  return json;
}

/** Upload a file and get a temporary URL (valid 24h) */
export async function rhUploadFile(
  apiKey: string,
  file: File | Blob,
  fileName?: string,
  options: Pick<RHRunOptions, 'baseUrl' | 'signal'> = {},
): Promise<string> {
  assertNotAborted(options.signal);
  const formData = new FormData();
  formData.append('file', file, fileName || 'upload.png');
  const uploadUrl = `${rhBase(options.baseUrl)}/media/upload/binary`;

  const res = await fetch(uploadUrl, {
    signal: options.signal,
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(withRunningHubDebug(`RunningHub upload failed (${res.status}): ${text}`, {
      baseUrl: rhBase(options.baseUrl),
      submitUrl: uploadUrl,
    }));
  }

  const json = await res.json();
  const error = rhResponseError(json, 'RunningHub upload');
  if (error) throw new Error(withRunningHubDebug(error, {
    baseUrl: rhBase(options.baseUrl),
    submitUrl: uploadUrl,
    response: json,
  }));
  const url = firstString(json.data?.download_url, json.data?.fileUrl, json.data?.url, json.download_url, json.fileUrl, json.url);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(withRunningHubDebug('RunningHub upload failed: 未返回可用媒体 URL。', {
      baseUrl: rhBase(options.baseUrl),
      submitUrl: uploadUrl,
      response: json,
    }));
  }
  return url;
}

/** Convert a data URL to a Blob for upload */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Upload a data URL image and get a temporary URL */
export async function rhUploadDataUrl(
  apiKey: string,
  dataUrl: string,
  options: Pick<RHRunOptions, 'baseUrl' | 'signal'> = {},
): Promise<string> {
  const blob = dataUrlToBlob(dataUrl);
  const ext = blob.type.split('/')[1] || 'png';
  return rhUploadFile(apiKey, blob, `upload.${ext}`, options);
}

/**
 * Submit a task and poll until completion.
 * Returns the final task response with results.
 */
export async function rhRunTask(
  apiKey: string,
  modelEndpoint: string,
  payload: RHSubmitPayload,
  onProgressOrOptions?: ((status: string, attempt: number) => void) | RHRunOptions,
): Promise<RHTaskResponse> {
  const options: RHRunOptions = typeof onProgressOrOptions === 'function'
    ? { onProgress: onProgressOrOptions as RHRunOptions['onProgress'] }
    : onProgressOrOptions || {};
  const debugContext = runningHubDebugContext(options.baseUrl || RH_BASE, modelEndpoint, payload);
  const submitResult = await rhSubmitTask(apiKey, modelEndpoint, payload, options);
  if (submitResult.status === 'SUCCESS') return submitResult;
  if (submitResult.status === 'FAILED') {
    throw new Error(withRunningHubDebug(`RunningHub task failed: ${submitResult.errorMessage || 'Unknown error'}`, {
      ...debugContext,
      response: submitResult,
    }));
  }
  const taskId = submitResult.taskId;
  if (!taskId) {
    throw new Error(withRunningHubDebug('RunningHub submit failed: 未返回 taskId，请检查模型端点和输入媒体 URL。', {
      ...debugContext,
      response: submitResult,
    }));
  }

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await delay(POLL_INTERVAL, options.signal);

    const result = await rhQueryTask(apiKey, taskId, options);
    options.onProgress?.(result.status, i + 1);

    if (result.status === 'SUCCESS') return result;
    if (result.status === 'FAILED') {
      throw new Error(
        withRunningHubDebug(`RunningHub task failed: ${result.errorMessage || 'Unknown error'}`, {
          ...debugContext,
          taskId,
          response: result,
        }),
      );
    }
    // QUEUED or RUNNING — continue polling
  }

  throw new Error(withRunningHubDebug('RunningHub task timed out after polling', {
    ...debugContext,
    taskId,
  }));
}

/** Quick test: verify API key validity */
export async function rhTestApiKey(apiKey: string, baseUrl?: string): Promise<boolean> {
  try {
    // Use a lightweight query with a dummy task ID to test auth
    const res = await fetch(`${rhBase(baseUrl)}/query`, {
      method: 'POST',
      headers: rhHeaders(apiKey),
      body: JSON.stringify({ taskId: 'test-0000' }),
    });
    // If 401/403 → bad key; any other response (including 404 for bad taskId) → key works
    return res.status !== 401 && res.status !== 403;
  } catch {
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════
// RunningHub WebApp（AI 应用）API — 工作流编排接口
//
// 与上方 v2 标准模型 API 独立：
// - 认证方式不同（apiKey in body/query，非 Bearer header）
// - 基址不同（task/openapi + api/webapp，非 openapi/v2）
// - 交互模式不同（获取节点 → 修改参数 → 提交 → 轮询结果）
// ════════════════════════════════════════════════════════════════════

const RH_HOST = 'https://www.runninghub.cn';
const WEBAPP_POLL_INTERVAL = 5000; // 5s
const WEBAPP_MAX_POLL_ATTEMPTS = 120; // 10 min max

/** WebApp 节点信息 — 描述一个可修改的工作流节点 */
export interface RHWebAppNodeInfo {
  nodeId: string;
  nodeName: string;
  fieldName: string;
  fieldValue: string;
  fieldType: 'IMAGE' | 'AUDIO' | 'VIDEO' | 'STRING' | 'LIST';
  description: string;
  fieldData?: unknown; // LIST 类型时包含可选值列表
}

/** WebApp 提交响应 */
export interface RHWebAppSubmitResult {
  taskId: string;
  promptTips?: string; // JSON 字符串，包含 node_errors 等
}

/** WebApp 任务输出项 */
export interface RHWebAppOutputItem {
  fileUrl: string;
  fileType?: string;
  nodeId?: string;
}

/** WebApp 查询响应码含义 */
export type RHWebAppTaskStatus = 'SUCCESS' | 'RUNNING' | 'QUEUED' | 'FAILED' | 'UNKNOWN';

/**
 * 获取 WebApp 的可修改节点列表
 *
 * @param apiKey - RunningHub API Key
 * @param webappId - AI 应用 ID（WebApp 链接末尾数字）
 * @returns nodeInfoList — 所有可修改的节点
 */
export async function rhGetWebAppNodes(
  apiKey: string,
  webappId: string,
): Promise<RHWebAppNodeInfo[]> {
  const url = `${RH_HOST}/api/webapp/apiCallDemo?apiKey=${encodeURIComponent(apiKey)}&webappId=${encodeURIComponent(webappId)}`;
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RunningHub WebApp 获取节点失败 (${res.status}): ${text || res.statusText}`);
  }

  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`RunningHub WebApp 错误: ${json.msg || JSON.stringify(json)}`);
  }

  return json.data?.nodeInfoList || [];
}

/**
 * 上传文件到 RunningHub（用于 IMAGE/AUDIO/VIDEO 类型节点）
 *
 * @param apiKey - RunningHub API Key
 * @param file - 要上传的文件
 * @returns 上传后的文件名（如 api/xxxx.jpg），用作 fieldValue
 */
export async function rhUploadWebAppFile(
  apiKey: string,
  file: File | Blob,
  fileName?: string,
): Promise<string> {
  const formData = new FormData();
  formData.append('apiKey', apiKey);
  formData.append('fileType', 'input');
  formData.append('file', file, fileName || 'upload.png');

  const res = await fetch(`${RH_HOST}/task/openapi/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RunningHub WebApp 文件上传失败 (${res.status}): ${text || res.statusText}`);
  }

  const json = await res.json();
  if (json.code !== 0 || !json.data?.fileName) {
    throw new Error(`RunningHub WebApp 上传错误: ${json.msg || '未返回 fileName'}`);
  }

  return json.data.fileName;
}

/**
 * 上传 data URL 图片到 WebApp
 */
export async function rhUploadWebAppDataUrl(
  apiKey: string,
  dataUrl: string,
): Promise<string> {
  const blob = dataUrlToBlob(dataUrl);
  const ext = blob.type.split('/')[1] || 'png';
  return rhUploadWebAppFile(apiKey, blob, `upload.${ext}`);
}

/**
 * 提交 WebApp 任务
 *
 * @param apiKey - RunningHub API Key
 * @param webappId - AI 应用 ID
 * @param nodeInfoList - 修改后的节点信息列表
 * @returns 包含 taskId 和 promptTips 的提交结果
 */
export async function rhSubmitWebAppTask(
  apiKey: string,
  webappId: string,
  nodeInfoList: RHWebAppNodeInfo[],
): Promise<RHWebAppSubmitResult> {
  const res = await fetch(`${RH_HOST}/task/openapi/ai-app/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      webappId,
      apiKey,
      nodeInfoList,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RunningHub WebApp 提交任务失败 (${res.status}): ${text || res.statusText}`);
  }

  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`RunningHub WebApp 提交错误: ${json.msg || JSON.stringify(json)}`);
  }

  const taskId = json.data?.taskId;
  if (!taskId) {
    throw new Error('RunningHub WebApp: 未返回 taskId');
  }

  // 检查 promptTips 中的 node_errors
  const promptTips = json.data?.promptTips;
  if (promptTips) {
    try {
      const tips = JSON.parse(promptTips);
      const nodeErrors = tips.node_errors;
      if (nodeErrors && Object.keys(nodeErrors).length > 0) {
        throw new Error(`RunningHub WebApp 节点错误: ${JSON.stringify(nodeErrors)}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('RunningHub WebApp 节点错误')) {
        throw e;
      }
      // promptTips 解析失败不阻塞
    }
  }

  return { taskId, promptTips };
}

/**
 * 查询 WebApp 任务输出（含状态判断）
 *
 * @returns status + outputs 数组（成功时）或 failedReason（失败时）
 */
export async function rhQueryWebAppOutputs(
  apiKey: string,
  taskId: string,
): Promise<{
  status: RHWebAppTaskStatus;
  outputs: RHWebAppOutputItem[];
  failedReason?: string;
}> {
  const res = await fetch(`${RH_HOST}/task/openapi/outputs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ apiKey, taskId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RunningHub WebApp 查询失败 (${res.status}): ${text || res.statusText}`);
  }

  const json = await res.json();
  const code = json.code;

  // code=0 → 成功，data 是输出数组
  if (code === 0 && Array.isArray(json.data)) {
    return {
      status: 'SUCCESS',
      outputs: json.data.map((item: Record<string, unknown>) => ({
        fileUrl: item.fileUrl || '',
        fileType: item.fileType,
        nodeId: item.nodeId,
      })),
    };
  }

  // code=805 → 失败
  if (code === 805) {
    const reason = json.data?.failedReason;
    return {
      status: 'FAILED',
      outputs: [],
      failedReason: reason
        ? `${reason.node_name}: ${reason.exception_message}`
        : json.msg || '任务失败',
    };
  }

  // code=804 → 运行中, code=813 → 排队中
  if (code === 804) return { status: 'RUNNING', outputs: [] };
  if (code === 813) return { status: 'QUEUED', outputs: [] };

  return { status: 'UNKNOWN', outputs: [] };
}

/**
 * 运行完整的 WebApp 工作流 — 提交任务 + 自动轮询直到完成
 *
 * @param apiKey - RunningHub API Key
 * @param webappId - AI 应用 ID
 * @param nodeInfoList - 修改后的节点信息列表
 * @param onProgress - 进度回调（状态, 轮询次数）
 * @returns 最终输出项数组
 */
export async function rhRunWebApp(
  apiKey: string,
  webappId: string,
  nodeInfoList: RHWebAppNodeInfo[],
  onProgress?: (status: RHWebAppTaskStatus, attempt: number) => void,
): Promise<RHWebAppOutputItem[]> {
  const { taskId } = await rhSubmitWebAppTask(apiKey, webappId, nodeInfoList);

  for (let i = 0; i < WEBAPP_MAX_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, WEBAPP_POLL_INTERVAL));

    const result = await rhQueryWebAppOutputs(apiKey, taskId);
    onProgress?.(result.status, i + 1);

    if (result.status === 'SUCCESS') return result.outputs;
    if (result.status === 'FAILED') {
      throw new Error(`RunningHub WebApp 任务失败: ${result.failedReason || '未知错误'}`);
    }
    // QUEUED / RUNNING → 继续轮询
  }

  throw new Error('RunningHub WebApp 任务超时（超过 10 分钟）');
}

/** 快速验证 WebApp API Key（尝试用一个随机 webappId 获取节点） */
export async function rhTestWebAppApiKey(apiKey: string): Promise<boolean> {
  try {
    // 用 dummy webappId 请求，如果 key 错误会返回非 0 code
    const url = `${RH_HOST}/api/webapp/apiCallDemo?apiKey=${encodeURIComponent(apiKey)}&webappId=test-0000`;
    const res = await fetch(url);
    // 401/403 → 无效 key
    return res.status !== 401 && res.status !== 403;
  } catch {
    return false;
  }
}
