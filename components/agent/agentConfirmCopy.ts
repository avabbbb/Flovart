import type { WorkflowNode } from '../workflow/types';
import type { AgentConfirmRequest } from '../../services/agentSpendMandate';
import { getWorkflowOperationCapabilityByNodeTool, localizeOperationLabel, parseWorkflowOperationNodeToolArguments } from '../workflow/operationRegistry';
import { planSummaryLine } from '../GenerationPlanCard';

type Language = 'en' | 'zho';
export type AgentConfirmScope = 'once' | 'session' | 'always';

export interface AgentConfirmCopy {
  /** 一句人话：动作 + 对象，例如「删除「海报 1」」。 */
  title: string;
  /** 一行补充：参数、费用或影响；没有就不显示。 */
  detail?: string;
}

const RISK_COPY: Record<string, { zho: string; en: string }> = {
  write: { zho: '修改画布', en: 'Edit the canvas' },
  delete: { zho: '删除内容', en: 'Delete content' },
  run: { zho: '运行生成', en: 'Run generation' },
  network: { zho: '联网搜索', en: 'Search the web' },
  'filesystem-read': { zho: '读取本地文件夹', en: 'Read your local folder' },
};

function nodeNames(nodes: readonly WorkflowNode[], ids: readonly string[], language: Language) {
  const titles = ids.map(id => nodes.find(node => node.id === id)?.title?.trim()).map(title => title || (language === 'en' ? 'Untitled node' : '未命名节点'));
  if (!titles.length) return language === 'en' ? 'a node' : '一个节点';
  const shown = titles.slice(0, 2).map(title => (language === 'en' ? `"${title}"` : `「${title}」`)).join(language === 'en' ? ', ' : '');
  const rest = titles.length - 2;
  if (rest <= 0) return shown;
  return language === 'en' ? `${shown} and ${rest} more` : `${shown} 等 ${titles.length} 个节点`;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map(item => item.trim()).filter(Boolean);
  return [];
}

function targetIds(args: Record<string, unknown>) {
  const many = stringList(args.nodeIds);
  if (many.length) return many;
  const one = args.nodeId ?? args.id;
  return one ? [String(one)] : [];
}

/** 内部命令名或 `命令：ID` 这类机器文本不直接给用户看。 */
function looksLikeMachineText(text: string) {
  return /^[a-z_]+(\.[a-z0-9_-]+)+/i.test(text.trim());
}

/**
 * 把 Agent 的确认请求翻译成用户看得懂的一句话。
 * 只依据命令与参数本身，节点 ID 一律换成节点标题；原始摘要只在它本来就是人话时兜底。
 */
export function describeAgentConfirmation(
  request: AgentConfirmRequest | undefined,
  nodes: readonly WorkflowNode[],
  language: Language,
  fallback = '',
): AgentConfirmCopy {
  const en = language === 'en';
  const args = request?.args || {};
  switch (request?.command) {
    case 'workflow.node.run': {
      const ids = targetIds(args);
      const gates = request.gates || [];
      const tasks = gates.reduce((sum, gate) => sum + gate.taskCount, 0);
      return {
        title: en ? `Run ${nodeNames(nodes, ids, language)}` : `运行${nodeNames(nodes, ids, language)}`,
        detail: gates.length ? (en ? `${gates.length} node(s) · ${tasks} task(s) · billed by your AI service` : planSummaryLine(gates)) : undefined,
      };
    }
    case 'workflow.node.tool': {
      const tool = String(args.tool || '');
      const capability = getWorkflowOperationCapabilityByNodeTool(tool);
      const label = capability ? localizeOperationLabel(capability, language) : (en ? 'Run a canvas tool' : '运行画布工具');
      let parameters = '';
      if (capability) {
        try {
          parameters = capability.summarizeParameters(parseWorkflowOperationNodeToolArguments(capability.id, args));
        } catch {
          parameters = '';
        }
      }
      const paid = capability ? capability.executor !== 'local-transform' : false;
      const cost = paid ? (en ? 'Uses your AI service and may cost credits' : '会调用 AI 服务，可能产生费用') : '';
      return {
        title: `${label}${en ? ' · ' : ''}${nodeNames(nodes, targetIds(args), language)}`,
        detail: [parameters, cost].filter(Boolean).join(' · ') || undefined,
      };
    }
    case 'workflow.node.delete':
      return { title: en ? `Delete ${nodeNames(nodes, targetIds(args), language)}` : `删除${nodeNames(nodes, targetIds(args), language)}` };
    case 'workflow.project.delete':
      return { title: en ? 'Delete this project' : '删除这个项目' };
    case 'workflow.apply': {
      const rawOperations = args.operations || args.ops;
      const operations = Array.isArray(rawOperations) ? rawOperations as Array<{ type?: string; ids?: unknown; all?: boolean }> : [];
      const deletedNodes = operations.filter(op => op?.type === 'delete_nodes').flatMap(op => stringList(op.ids));
      const deletedLinks = operations.filter(op => op?.type === 'delete_connections');
      if (deletedNodes.length) {
        return { title: en ? `Delete ${nodeNames(nodes, deletedNodes, language)}` : `删除${nodeNames(nodes, deletedNodes, language)}`, detail: en ? `${operations.length} change(s) in this step` : `本次共 ${operations.length} 项改动` };
      }
      if (deletedLinks.length) return { title: en ? 'Remove connections' : '删除连线', detail: en ? `${operations.length} change(s) in this step` : `本次共 ${operations.length} 项改动` };
      return { title: en ? 'Edit the canvas' : '修改画布', detail: operations.length ? (en ? `${operations.length} change(s)` : `${operations.length} 项改动`) : undefined };
    }
    default:
      break;
  }
  const risk = request?.risk && RISK_COPY[request.risk];
  if (risk) return { title: risk[language] };
  if (fallback && !looksLikeMachineText(fallback)) return { title: fallback };
  return { title: en ? 'Run a canvas action' : '执行一个画布操作' };
}

/**
 * 授权范围：删除永远逐次确认；付费只到“本次对话”（自动模式下受任务上限约束）；
 * 其余可逆操作可以“始终允许”，并可在模式菜单里撤销。
 */
export function confirmScopesFor(request: AgentConfirmRequest | undefined, options: { offerMandate?: boolean } = {}): AgentConfirmScope[] {
  if (!request) return ['once'];
  if (request.kind === 'destructive' || request.risk === 'delete') return ['once'];
  if (request.kind === 'generation') return options.offerMandate ? ['once', 'session'] : ['once'];
  if (request.command === 'workflow.node.tool') {
    const capability = getWorkflowOperationCapabilityByNodeTool(String(request.args?.tool || ''));
    if (capability && capability.executor !== 'local-transform') return ['once', 'session'];
  }
  if (request.risk === 'run') return ['once'];
  return ['once', 'session', 'always'];
}

/** 记住授权用的键：同一类操作（同一命令、同一画布工具）共用一个键。 */
export function confirmGrantKey(request: AgentConfirmRequest | undefined): string | null {
  if (!request || request.kind === 'generation' || request.kind === 'destructive') return null;
  const tool = request.command === 'workflow.node.tool' ? String(request.args?.tool || '') : '';
  return [request.command, tool, request.risk || ''].filter(Boolean).join(':');
}

const ALWAYS_KEY = 'flovart.agent.alwaysAllow';

export function readAlwaysGrants(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): string[] {
  try {
    const parsed = JSON.parse(storage?.getItem(ALWAYS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function writeAlwaysGrants(grants: readonly string[], storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage) {
  try {
    if (grants.length) storage?.setItem(ALWAYS_KEY, JSON.stringify([...new Set(grants)]));
    else storage?.removeItem(ALWAYS_KEY);
  } catch {
    // 存储不可用（隐私模式）时只在本次对话内生效。
  }
}
