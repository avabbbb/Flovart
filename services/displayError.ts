/**
 * 唯一的 jargon→product 错误映射层（error→UI boundary）。
 *
 * 规则：任何写到 `node.metadata.error`、store.error、agent chat、ErrorBoundary、
 * 持久化失败提示等用户可见表面的错误，都必须先经过 `displayError`。
 * 它把 HTTP 状态码 / 英文网络错 / provider 行话翻译为面向产品的中文提示；
 * `WorkflowExecutionError` 等已归一化的执行错误经 `Error.message` 透传后再过 jargon 层兜底。
 *
 * 该模块刻意不依赖 React / store：它接收 unknown，返回可展示的字符串。
 */


/**
 * 已知 provider/网络/执行层 jargon → 产品文案。
 * 顺序敏感：更具体的模式必须放在通用兜底之前。
 * `message === ''` 表示原文已是产品语言，命中后直接透传原文。
 */
const JARGON_RULES: ReadonlyArray<{ pattern: RegExp; message: string }> = [
    // 超时类（原始中文超时文案已是产品语言）
    { pattern: /视频生成超时|连接超时|AI 服务响应超时/, message: '' },
    { pattern: /\b401\b|unauthori[sz]ed|invalid api key|invalid key|authentication failed/i, message: 'API Key 无效或没有访问权限，请在 AI 服务设置中检查。' },
    { pattern: /\b403\b|forbidden|permission denied/i, message: '当前 API Key 没有执行此任务的权限，请检查 AI 服务设置。' },
    { pattern: /\b429\b|rate[ _-]?limit|too many requests|quota exceeded/i, message: 'AI 服务当前限流，请稍后重试。' },
    { pattern: /\b(?:500|502|503|504)\b|provider error|service unavailable|bad gateway|internal server error/i, message: 'AI 服务暂时不可用，任务已失败，可稍后重试。' },
    { pattern: /非 JSON|malformed response|invalid json/i, message: 'AI 服务返回了无法识别的结果，任务已失败，可重试或检查服务配置。' },
    { pattern: /\b400\b|bad request|invalid request/i, message: '当前 AI 服务不接受这组生成参数，请检查模型和参考素材。' },
    { pattern: /failed to fetch|networkerror|fetch failed|network request failed|econnrefused|enotfound|etimedout/i, message: '无法连接到该 AI 服务，请检查服务地址后重试。' },
    // 持久化 / 本地存储
    { pattern: /quotaexceeded|storage\s*(?:full|exceed|quota)|indexeddb|localstorage|localforage/i, message: '本地存储写入失败，请检查浏览器存储空间或权限后重试。' },
    // 草稿 / 版本冲突
    { pattern: /revision[_ ]?conflict|版本已变化|草稿版本/i, message: '画布已被其他操作更新，请刷新或重新读取后再试。' },
    { pattern: /idempotency[_ ]?key[_ ]?reuse|mutationId.*不同载荷/i, message: '该操作已提交过，请勿重复提交。' },
    // 注：中文产品文案（如「音频生成暂未支持」「当前 API 线路不支持首尾帧」「节点不存在」）
    // 不在此处重映射——它们已是面向用户的措辞，再套通用规则只会丢信息。
    // 该层只翻译 HTTP 状态码、英文网络/Provider 异常与内部符号名这类“行话”。
];

/** 去掉明显的内部实现词汇，避免把 stack 帧 / 模块名直接抛给用户。 */
function stripInternals(text: string): string {
    return text
        .replace(/Provider 线路/g, '当前 AI 服务')
        .replace(/\bProviderAdapter\b/g, 'AI 服务')
        .replace(/\bCanonicalGenerationInput\b/g, '生成参数')
        .replace(/\s+at\s+\S+\s+\([^)]*\)/g, '') // 掉一行内联 stack 帧
        .trim();
}

function rawMessage(cause: unknown): string {
    if (cause instanceof Error) return cause.message;
    if (typeof cause === 'string') return cause;
    if (cause && typeof cause === 'object' && 'message' in cause) {
        const value = cause.message;
        return typeof value === 'string' ? value : String(value);
    }
    return String(cause ?? '');
}

/**
 * 将任意 thrown/返回的错误值映射为可上屏的产品文案。
 *
 * - `WorkflowExecutionError`：message 已是面向用户的，再过 jargon 层兜底。
 * - `Error`：取 `.message`。
 * - 其它：直接 `String(cause)`。
 * - 命中空串时用 `fallback`。
 *
 * 该函数是纯函数：不抛、不读全局状态、不做 IO。
 */
export function displayError(cause: unknown, fallback = '操作失败，请重试。'): string {
    // WorkflowExecutionError 归一化由 normalizeWorkflowExecutionError 保证；
    // 这里只需要取它的 message，再统一过一遍 jargon 翻译。
    const raw = rawMessage(cause);
    let mapped = raw;
    for (const rule of JARGON_RULES) {
        if (rule.pattern.test(mapped)) {
            mapped = rule.message === '' ? mapped : rule.message;
            break;
        }
    }
    const cleaned = stripInternals(mapped);
    return cleaned || fallback;
}
