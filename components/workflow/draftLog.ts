import type { WorkflowDraftLogEntry, WorkflowProject } from './types';

export const WORKFLOW_DRAFT_LOG_LIMIT = 200;

export interface DraftLogEntryInput {
  source: 'agent' | 'mcp' | 'cli' | 'ui';
  command: string;
  args: Record<string, unknown>;
  ok: boolean;
  message?: string;
  nodeIds?: string[];
  connectionIds?: string[];
}

const createId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** 把一条 Workflow Draft Action 转成设计师可读的中文摘要。 */
export function describeWorkflowDraftCommand(command: string, args: Record<string, unknown>): string {
  const nodeId = String(args.nodeId || args.id || args.fromNodeId || args.toNodeId || args.connectionId || '');
  const title = String(args.title || '');
  const type = String(args.type || '');
  switch (command) {
    case 'workflow.project.create':
      return title ? `新建项目「${title}」` : '新建项目';
    case 'workflow.project.use':
      return '切换当前项目';
    case 'workflow.project.delete':
      return `删除项目「${nodeId}」`;
    case 'workflow.node.create':
      return `创建${type}节点${title ? `「${title}」` : ''}`;
    case 'workflow.node.create-connected':
      return `创建${type}节点${title ? `「${title}」` : ''}并连线`;
    case 'workflow.node.update':
      return `更新节点「${nodeId}」`;
    case 'workflow.node.delete':
      return `删除节点「${nodeId}」`;
    case 'workflow.node.move':
      return `移动节点「${nodeId}」`;
    case 'workflow.node.resize':
      return `调整节点「${nodeId}」尺寸`;
    case 'workflow.node.run':
      return `运行节点「${nodeId}」`;
    case 'workflow.node.stop':
      return `停止节点「${nodeId}」`;
    case 'workflow.node.tool':
      return `对节点「${nodeId}」执行 ${String(args.tool || '')} 工具`;
    case 'workflow.connect':
      return `连接 ${String(args.fromNodeId || args.from || '')} → ${String(args.toNodeId || args.to || '')}`;
    case 'workflow.disconnect':
      return `断开连接「${nodeId}」`;
    case 'workflow.select': {
      const ids = Array.isArray(args.ids) ? args.ids.length : 0;
      return ids ? `选中 ${ids} 个节点` : '清空选中';
    }
    case 'workflow.viewport.set':
      return '调整画布视口';
    default:
      return `${command}${nodeId ? `：${nodeId}` : ''}`;
  }
}

export function createWorkflowDraftLogEntry(input: DraftLogEntryInput): WorkflowDraftLogEntry {
  return {
    id: createId(),
    at: new Date().toISOString(),
    source: input.source,
    command: input.command,
    summary: describeWorkflowDraftCommand(input.command, input.args),
    ok: input.ok,
    message: input.message,
    nodeIds: input.nodeIds?.length ? input.nodeIds : undefined,
    connectionIds: input.connectionIds?.length ? input.connectionIds : undefined,
  };
}

/** 把一条记录追加到项目草稿动作日志（仅保留最近 WORKFLOW_DRAFT_LOG_LIMIT 条）。 */
export function appendWorkflowDraftLog(project: WorkflowProject, entry: WorkflowDraftLogEntry): WorkflowProject {
  const draftLog = [...(project.draftLog || []), entry].slice(-WORKFLOW_DRAFT_LOG_LIMIT);
  return { ...project, draftLog };
}
