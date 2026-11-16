// Agent 面板「正在做什么」→ Thinking Orbs 点阵球状态 + 静态标签（参考 Inspora 5-8 · Jakub Antalik「Thinking orbs」）。
// 纯函数：只看本轮回合状态与本轮消息，面板与测试共用。状态全部来自真实事件，不用动画掩盖未知状态（AGENTS.md §6）。
import type { AgentTurnPhase } from './agentPanelState';

/** thinking-orbs 的九种状态。 */
export type AgentOrbState =
  | 'working'
  | 'searching'
  | 'solving'
  | 'listening'
  | 'connecting'
  | 'weaving'
  | 'composing'
  | 'breathing'
  | 'shaping';

/** 本轮里和状态判断有关的消息字段（WorkflowAgentDisplayMessage 的子集）。 */
export interface AgentPhaseMessage {
  role: string;
  text?: string;
  status?: string;
  toolName?: string;
  title?: string;
  thinking?: string;
  thinkingDone?: boolean;
}

export interface AgentWorkingInput {
  turnPhase: AgentTurnPhase;
  /** Agent 用 ask 工具在等用户填表。 */
  awaitingAsk?: boolean;
  /** 确认卡（写入 / 付费 / 删除）在等用户。 */
  awaitingConfirmation?: boolean;
  /** 托管 Agent 的工作区桥正在（重）连。 */
  reconnecting?: boolean;
  /** 整个会话的消息；只看最后一条用户消息之后的部分。 */
  messages: readonly AgentPhaseMessage[];
  language?: 'en' | 'zho';
}

export interface AgentWorkingPhase {
  state: AgentOrbState;
  label: string;
  /** 本轮已发起的工具调用数。 */
  steps: number;
}

type Copy = { zho: string; en: string };

const COPY = {
  stopping: { zho: '正在停止', en: 'Stopping' },
  ask: { zho: '等你回答', en: 'Waiting for your answer' },
  confirm: { zho: '等你确认', en: 'Waiting for your approval' },
  reconnect: { zho: '正在重连 Agent', en: 'Reconnecting' },
  thinking: { zho: '正在思考', en: 'Thinking' },
  nextStep: { zho: '正在思考下一步', en: 'Thinking about the next step' },
  composing: { zho: '正在撰写回复', en: 'Writing the reply' },
} satisfies Record<string, Copy>;

/** 工具 → 球的状态与文案。读 / 搜 → searching，规划 → solving，改画布 → shaping，等用户 → listening，其余调用 → working。 */
const TOOL_PHASES: Record<string, { state: AgentOrbState; copy: Copy }> = {
  flovart_workflow_inspect: { state: 'searching', copy: { zho: '正在读取画布', en: 'Reading the canvas' } },
  flovart_workflow_selection_get: { state: 'searching', copy: { zho: '正在读取选中节点', en: 'Reading the selection' } },
  flovart_workflow_search_nodes: { state: 'searching', copy: { zho: '正在查找节点', en: 'Finding nodes' } },
  flovart_workflow_media_view: { state: 'searching', copy: { zho: '正在查看画面', en: 'Looking at the media' } },
  flovart_web_search: { state: 'searching', copy: { zho: '正在联网搜索', en: 'Searching the web' } },
  flovart_grep: { state: 'searching', copy: { zho: '正在搜索本地文件', en: 'Searching local files' } },
  flovart_todo: { state: 'solving', copy: { zho: '正在规划任务', en: 'Planning the steps' } },
  flovart_skill_read: { state: 'searching', copy: { zho: '正在读取技能', en: 'Reading the skill' } },
  flovart_memory: { state: 'solving', copy: { zho: '正在整理项目记忆', en: 'Updating project memory' } },
  flovart_workflow_apply: { state: 'shaping', copy: { zho: '正在修改画布', en: 'Editing the canvas' } },
  flovart_workflow_node_run: { state: 'working', copy: { zho: '正在提交生成', en: 'Starting generation' } },
  flovart_ask: { state: 'listening', copy: { zho: '等你回答', en: 'Waiting for your answer' } },
};

/** 未登记工具按名字里的动词兜底：读 / 查 / 搜 → searching，计划 → solving，其余 → working。 */
function toolPhase(toolName: string | undefined, title: string | undefined): { state: AgentOrbState; copy: Copy } {
  const name = String(toolName || '');
  const known = TOOL_PHASES[name];
  if (known) return known;
  const label = title || name || 'tool';
  if (/inspect|search|grep|read|get|list|view|status|query|find/i.test(name)) {
    return { state: 'searching', copy: { zho: '正在读取「' + label + '」', en: 'Reading · ' + label } };
  }
  if (/plan|todo|projection/i.test(name)) return { state: 'solving', copy: { zho: '正在规划「' + label + '」', en: 'Planning · ' + label } };
  return { state: 'working', copy: { zho: '正在调用「' + label + '」', en: 'Running · ' + label } };
}

/** 最后一条用户消息之后的部分（本轮）。 */
export function currentTurnMessages<T extends { role: string }>(messages: readonly T[]): T[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return messages.slice(index + 1);
  }
  return [...messages];
}

/** 回合状态 + 本轮消息 → 点阵球状态、标签与步数。只在 turnPhase !== 'idle' 时有意义。 */
export function agentWorkingPhase(input: AgentWorkingInput): AgentWorkingPhase {
  const en = input.language === 'en';
  const text = (copy: Copy) => (en ? copy.en : copy.zho);
  const turn = currentTurnMessages(input.messages);
  const steps = turn.filter(message => message.role === 'tool').length;
  const result = (state: AgentOrbState, copy: Copy | string): AgentWorkingPhase => ({ state, label: typeof copy === 'string' ? copy : text(copy), steps });

  if (input.turnPhase === 'stopping') return result('breathing', COPY.stopping);
  if (input.awaitingAsk) return result('listening', COPY.ask);
  if (input.awaitingConfirmation || input.turnPhase === 'awaitingConfirmation') return result('listening', COPY.confirm);
  if (input.reconnecting) return result('connecting', COPY.reconnect);

  const last = [...turn].reverse().find(message => message.role === 'assistant' || message.role === 'tool');
  if (!last) return result('breathing', COPY.thinking);
  if (last.role === 'tool') {
    if (last.status === 'pending') {
      const phase = toolPhase(last.toolName, last.title);
      return result(phase.state, phase.copy);
    }
    return result('breathing', COPY.nextStep);
  }
  if (last.text && last.text.trim()) return result('composing', COPY.composing);
  return result('breathing', COPY.thinking);
}

/** 胶囊尾部的步数 / 用时："3 步 · 12s"；步数为 0 时只给用时。 */
export function agentWorkingMeta(steps: number, elapsedMs: number, language: 'en' | 'zho' = 'zho'): { steps: string; time: string } {
  const stepText = steps > 0 ? (language === 'en' ? `${steps} step${steps === 1 ? '' : 's'}` : `${steps} 步`) : '';
  return { steps: stepText, time: formatElapsed(elapsedMs) };
}

/** 12s / 1m 05s：思考计时与回合计时共用。 */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}
