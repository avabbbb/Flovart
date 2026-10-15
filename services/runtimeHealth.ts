import { displayError } from './displayError';

/**
 * Agent 运行时 / 凭据就绪状态的产品语言层。
 *
 * 职责：把「冷启动失败 / 发送被拦 / Host 全部离线」归一成有限的
 * `AgentSetupBlocker` 分类，并给出面向用户的下一步文案。分类依据是
 * 执行层已有的错误 taxonomy（`WorkflowExecutionError.code`、
 * `LinkActivationError.code`、kernel 路由标记），而不是对任意
 * message 做裸字符串匹配；只有 taxonomy 未覆盖的原始错误才走
 * jargon 关键词兜底。
 *
 * 与 displayError 的分工：displayError 负责把单行错误译成中文产品
 * 文案；runtimeHealth 负责决定「这堵墙属于哪一类、用户下一步能点
 * 什么」。两者都只读输入、不碰全局状态。
 */

export type AgentSetupBlocker = 'credential' | 'offline' | 'unknown';

/** kernel 路由层（resolveBrowserAgentTextRoute / managed agent）发出的稳定凭据标记。 */
const AGENT_TEXT_ROUTE_MARKERS = [
    'no agent-text route',
    'no configured agent-text credential',
];

/** taxonomy 未覆盖时的兜底关键词（只判类别，不产出文案）。 */
const CREDENTIAL_HINT = /api ?key|access token|凭证|凭据|鉴权|未授权|unauthori[sz]ed|invalid key|模型映射|可用线路|agent-text/i;
function errorCode(cause: unknown): string | undefined {
    if (!cause || typeof cause !== 'object' || !('code' in cause)) return undefined;
    return typeof cause.code === 'string' ? cause.code : undefined;
}
const OFFLINE_HINT = /offline|未连接|未启动|尚未启动|仅桌面端|不可用|fetch|network|econnrefused|etimedout|离线|断开/i;

/**
 * 将冷启动 / 发送拦截 / Host 扫描错误归类为产品级阻塞类型：
 * - `credential`：缺少或无效的 AI 服务凭据 / 模型映射 —— 可走「添加 API Key」。
 * - `offline`：本地 Agent 服务或协作 Host 不在线 —— 可走「连接协作 Agent」。
 * - `unknown`：其它错误 —— 只展示 displayError 文案。
 */
export function classifyAgentSetupError(cause: unknown): AgentSetupBlocker {
    const code = errorCode(cause);
    if (code) {
        switch (code) {
            case 'HOST_NEEDS_SETUP':
            case 'HOST_NOT_FOUND':
            case 'HOST_UNAVAILABLE':
            case 'LINK_OFFLINE':
            case 'WORKSPACE_REQUIRED':
            case 'WORKSPACE_UNAVAILABLE':
            case 'RUNTIME_UNAVAILABLE':
            case 'RUNNER_UNAVAILABLE':
                return 'offline';
            case 'PROVIDER_REQUEST_FAILED':
            case 'PROVIDER_VALIDATION_FAILED':
                return 'credential';
            default:
                break;
        }
    }
    const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
    const message = displayError(cause, '');
    const haystack = `${raw}\n${message}`;
    const lowered = haystack.toLowerCase();
    if (AGENT_TEXT_ROUTE_MARKERS.some(marker => lowered.includes(marker))) return 'credential';
    if (CREDENTIAL_HINT.test(haystack)) return 'credential';
    if (OFFLINE_HINT.test(haystack) || /无法连接|没有返回|请求失败/i.test(message)) return 'offline';
    return 'unknown';
}

/** credential 阻塞的主文案：指路到 Settings 的添加访问凭证入口。 */
export const AGENT_CREDENTIAL_MESSAGE = '助手需要一个可用的 AI 服务访问凭证才能对话。添加一个 API Key 或完成模型映射后即可开始。';

/** offline 阻塞的主文案：指路到协作页签连接一个正在运行的 Host。 */
export const AGENTS_OFFLINE_MESSAGE = 'Flovart 需要一个正在运行的协作 Agent（如 Codex、Claude 或 OpenCode）才能继续。打开「协作」页签连接一个助手，或在设置中添加 AI 服务后使用内置助手。';

/** 按阻塞类别取主文案；unknown 回退到 displayError 译文。 */
export function agentSetupMessage(kind: AgentSetupBlocker, cause?: unknown): string {
    if (kind === 'credential') return AGENT_CREDENTIAL_MESSAGE;
    if (kind === 'offline') return AGENTS_OFFLINE_MESSAGE;
    return displayError(cause, 'Flovart Agent 暂时不可用，请稍后重试。');
}
