import type { WorkflowGenerationCapability } from '../components/workflow/inputResolver';
import type { WorkflowGenerationReferenceRole } from '../components/workflow/types';
import {
  UserScriptProviderAdapter,
  registerUserScriptProvider,
  type UserScriptProviderDefinition,
} from './userScriptProviderAdapter';

/**
 * Agent 编写适配脚本的宿主侧：解析、持久化、启动时重新注册，以及给外部 Agent 的写脚本说明。
 * 脚本只是 UserScriptProviderDefinition JSON；执行仍由 UserScriptProviderAdapter 的固定解释器完成。
 * 定义里不含凭据，Key 仍保存在加密的 keyVault 中，发请求时最后注入。
 */
const STORAGE_KEY = 'flovart.userScriptProviders.v1';

const CAPABILITIES: readonly WorkflowGenerationCapability[] = [
  'text-generate', 'audio-generate', 'text-to-image', 'image-edit', 'text-to-video',
  'image-to-video', 'reference-to-video', 'first-last-frame', 'video-extension',
];

const REFERENCE_ROLES: readonly WorkflowGenerationReferenceRole[] = [
  'first_frame', 'last_frame', 'reference', 'character', 'style', 'mask', 'source_video', 'source_audio',
];

const EXAMPLE_ENDPOINT = ['https:', '', 'api.example.com', 'v1'].join('/');
const CODE_FENCE = String.fromCharCode(96).repeat(3);

type StoredDefinitions = Record<string, UserScriptProviderDefinition>;

function readStore(): StoredDefinitions {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as StoredDefinitions : {};
  } catch {
    return {};
  }
}

/** 解析 Agent 返回的文本（允许外层代码围栏），并用运行时同一套校验完整检查。 */
export function parseUserScriptDefinition(text: string): UserScriptProviderDefinition {
  let source = text.trim();
  if (source.startsWith(CODE_FENCE)) {
    source = source.slice(source.indexOf('\n') + 1);
    if (source.trimEnd().endsWith(CODE_FENCE)) source = source.trimEnd().slice(0, -CODE_FENCE.length);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('不是合法 JSON。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('顶层必须是 JSON 对象。');
  const definition = parsed as UserScriptProviderDefinition;
  if (!definition.request || typeof definition.request !== 'object') throw new Error('缺少 request。');
  if (!definition.response || typeof definition.response !== 'object') throw new Error('缺少 response。');
  if (!Array.isArray(definition.capabilities) || !Array.isArray(definition.supportedReferenceKinds)
    || !Array.isArray(definition.supportedReferenceRoles) || !definition.maxReferences || typeof definition.maxReferences !== 'object') {
    throw new Error('缺少 capabilities、supportedReferenceKinds、supportedReferenceRoles 或 maxReferences。');
  }
  const unknownCapability = definition.capabilities.find(capability => !CAPABILITIES.includes(capability));
  if (unknownCapability) throw new Error('未知 capability：' + unknownCapability);
  const unknownRole = definition.supportedReferenceRoles.find(role => !REFERENCE_ROLES.includes(role));
  if (unknownRole) throw new Error('未知 reference role：' + unknownRole);
  // 构造即校验：HTTPS、非本机、相对路径、受限 header、引用上限等。
  new UserScriptProviderAdapter(definition);
  return definition;
}

export function saveUserScriptProvider(definition: UserScriptProviderDefinition): void {
  const store = readStore();
  store[definition.id] = definition;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  registerUserScriptProvider(definition);
}

export function getStoredUserScriptProvider(id?: string): UserScriptProviderDefinition | undefined {
  return id ? readStore()[id] : undefined;
}

/** 启动时把已保存的适配脚本注册回内存 registry；无效条目跳过，不阻塞启动。 */
export function loadStoredUserScriptProviders(): number {
  let loaded = 0;
  for (const definition of Object.values(readStore())) {
    try {
      registerUserScriptProvider(definition);
      loaded += 1;
    } catch {
      // 旧版本或被手改的定义：留在存储里，等用户在设置中重新保存。
    }
  }
  return loaded;
}

function exampleDefinitions(model: string): UserScriptProviderDefinition[] {
  const auth = { header: 'Authorization', prefix: 'Bearer ' };
  return [
    {
      id: 'my-image-provider',
      name: '示例：同步图片接口',
      version: '1',
      endpoint: EXAMPLE_ENDPOINT,
      capabilities: ['text-to-image', 'image-edit'],
      supportedReferenceKinds: ['image'],
      supportedReferenceRoles: ['reference'],
      maxReferences: { image: 4, video: 0, audio: 0 },
      auth,
      request: {
        method: 'POST',
        path: 'images/generations',
        body: {
          model,
          prompt: { $path: 'input.prompt' },
          size: { $path: 'input.parameters.size' },
          images: { $map: { path: 'input.references', item: { $path: '$item.href' } } },
        },
      },
      response: { kind: 'image', mediaUrlPath: 'data.0.url', base64Path: 'data.0.b64_json' },
    },
    {
      id: 'my-video-provider',
      name: '示例：异步视频任务',
      version: '1',
      endpoint: EXAMPLE_ENDPOINT,
      capabilities: ['text-to-video', 'image-to-video', 'first-last-frame'],
      supportedReferenceKinds: ['image'],
      supportedReferenceRoles: ['first_frame', 'last_frame', 'reference'],
      maxReferences: { image: 2, video: 0, audio: 0 },
      auth,
      request: {
        method: 'POST',
        path: 'contents/generations/tasks',
        body: {
          model,
          content: [{ type: 'text', text: { $path: 'input.prompt' } }],
          images: { $map: { path: 'input.references', item: { url: { $path: '$item.href' }, role: { $path: '$item.role' } } } },
          ratio: { $path: 'input.parameters.aspectRatio' },
          duration: { $path: 'input.parameters.duration' },
        },
      },
      response: { kind: 'video', taskIdPath: 'id' },
      poll: {
        request: { method: 'GET', path: 'contents/generations/tasks/{{taskId}}' },
        response: { kind: 'video', statusPath: 'status', mediaUrlPath: 'content.video_url', errorPath: 'error.message' },
        intervalMs: 5000,
        timeoutMs: 600000,
      },
      cancel: { request: { method: 'DELETE', path: 'contents/generations/tasks/{{taskId}}' } },
    },
  ];
}

/** 给外部 Agent 的写脚本说明：结构、上下文字段、规则、示例、当前草稿；不含任何凭据。 */
export function buildUserScriptAuthoringBrief({ modelName, draft }: { modelName?: string; draft?: string }): string {
  const model = modelName?.trim() || 'your-model-id';
  return [
    '请为 Flovart 编写一份 Provider 适配脚本。目标模型：' + (modelName?.trim() || '（由用户在 Flovart 中选择）') + '。',
    '适配脚本是一个 JSON 对象（UserScriptProviderDefinition），不是 JavaScript。Flovart 用固定解释器按它发请求、轮询和解析结果。我会附上要对接服务的接口文档。',
    '',
    '## 结构',
    '- id：2–64 位，只用字母、数字、点、下划线、短横线；name、version 可选。',
    '- endpoint：完整 HTTPS 公网地址，不含账号密码，不指向 localhost / 127.x。',
    '- capabilities：从 ' + CAPABILITIES.join('、') + ' 中选。',
    '- supportedReferenceKinds：image / video / audio 的子集；supportedReferenceRoles 从 ' + REFERENCE_ROLES.join('、') + ' 中选。',
    '- maxReferences：必须同时给出 image、video、audio（0–64 整数）；声明支持的类型上限必须大于 0。',
    '- auth：{ header, prefix }，例如 { "header": "Authorization", "prefix": "Bearer " }。Key 由宿主在发请求的最后一步注入。',
    '- request：{ method, path, headers, body }。path 是 endpoint 下的相对路径。',
    '- response：{ kind: image|video|text, mediaUrlPath, base64Path, mimeTypePath, textPath, taskIdPath, statusPath, errorPath, successStatuses, failureStatuses }。',
    '- poll（异步任务必填）：{ request, response, intervalMs, timeoutMs }；cancel（可选）：{ request, successPath }。',
    '',
    '## 可读取的上下文',
    '- input.prompt：提示词；input.capability：本次生成能力；input.nodeId：节点 ID。',
    '- input.parameters：节点参数（常见 aspectRatio、duration、resolution、size、generationSubmode，以实际节点为准）。',
    '- input.textInputs[]：{ resourceId, kind, title, text, mimeType }。',
    '- input.references[]：{ resourceId, type: image|video|audio, role, order, label, mimeType, href }，href 是 HTTPS 或 data URL。',
    '- taskId：仅 poll 阶段可用；poll / cancel 的 path 里用 {{taskId}} 占位。',
    '',
    '## 写法规则',
    '- 只输出一个完整 JSON 对象，不要注释、不要解释。',
    '- 动态值只能用 { "$path": "input.prompt" } 读取，或用 { "$map": { "path": "input.references", "item": ... } } 遍历数组（item 内用 $item 或 $item.字段）。没有函数和表达式，读不到的字段会被省略。',
    '- 不要把 API Key 写进 headers 或 body；不允许 Cookie、Host、Proxy-*、Sec-* header。',
    '- path 不能以协议或 // 开头，不能包含 ..。',
    '- body 以 JSON 发送，不支持 multipart 文件上传；如果接口只接受文件上传，请直接说明无法适配。',
    '- 同步接口在 response 里给出 mediaUrlPath / base64Path / textPath；异步接口用 taskIdPath 取任务 ID，再声明 poll。',
    '- 路径用点号和数字下标，例如 data.0.url。失败状态默认 failed / error / canceled / expired，错误信息默认读 error.message。',
    '',
    '## 完整示例（请按实际接口改写，不要原样照搬）',
    ...exampleDefinitions(model).map(example => JSON.stringify(example, null, 2)),
    '',
    '## 用户当前草稿（请在此基础上修改；若为空则从零编写）',
    draft?.trim() || '（空）',
  ].join('\n');
}
