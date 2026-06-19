import { nanoid } from 'nanoid';
import { WORKFLOW_MUTATION_COMMANDS, workflowCommandSummary } from '../components/workflow/agentOps';
import { createWorkflowNode } from '../components/workflow/constants';
import { applyWorkflowOps } from '../components/workflow/ops';
import { getWorkflowPersistenceError, useWorkflowStore } from '../components/workflow/store';
import type { WorkflowNode, WorkflowNodeMetadata, WorkflowNodeType, WorkflowProject } from '../components/workflow/types';

export interface WorkflowCommandEnvelope {
  id: string;
  command: string;
  args: Record<string, unknown>;
  source: 'ui' | 'cli' | 'agent' | 'mcp';
  idempotencyKey?: string;
}

export interface WorkflowCommandResult {
  ok: boolean;
  commandId: string;
  result?: unknown;
  confirmation?: { required: boolean; summary: string };
  error?: { code: string; message: string };
}

export interface WorkflowDispatcherDependencies {
  getState: () => { projects: WorkflowProject[]; activeProjectId: string | null };
  createProject: (title?: string) => string;
  setActiveProject: (id: string | null) => void;
  deleteProjects: (ids: string[]) => void;
  updateProject: (id: string, patch: Partial<Omit<WorkflowProject, 'id' | 'createdAt'>>) => void;
  runNode?: (projectId: string, nodeId: string) => Promise<void> | void;
  stopNode?: (projectId: string, nodeId: string) => Promise<void> | void;
  persistenceError?: () => unknown;
}

const MAX_IDEMPOTENCY_ENTRIES = 256;
const NODE_TYPES: WorkflowNodeType[] = ['image', 'text', 'video', 'audio', 'config'];
const SENSITIVE_KEY = /(?:api.?key|authorization|token|secret|password|storage.?key|file.?path|local.?path|data.?url)/i;
const MEDIA_KEY = /^(?:href|poster|src|url)$/i;
const LOCAL_PATH = /^(?:[a-z]:\\|\\\\|\/home\/|\/Users\/|\/tmp\/)/i;

export function redactWorkflowAgentValue<T>(value: T, key = ''): T {
  if (SENSITIVE_KEY.test(key)) return '[redacted]' as T;
  if (typeof value === 'string') {
    if (MEDIA_KEY.test(key) || /^(?:data:|blob:|file:)/i.test(value) || LOCAL_PATH.test(value)) return '[media]' as T;
    return value
      .replace(/(?:data|blob|file):[^\s"']+/gi, '[media]')
      .replace(/(?:[a-z]:\\|\\\\)[^\r\n"']+/gi, '[local-path]') as T;
  }
  if (Array.isArray(value)) return value.map(item => redactWorkflowAgentValue(item)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redactWorkflowAgentValue(child, childKey)])) as T;
}

const redactProject = (project: WorkflowProject) => ({
  ...redactWorkflowAgentValue(project),
  nodes: project.nodes.map(node => ({
    ...redactWorkflowAgentValue(node),
    metadata: {
      ...redactWorkflowAgentValue(node.metadata),
      hasMedia: Boolean(node.metadata.href || node.metadata.poster || node.metadata.storageKey),
    },
  })),
});

const error = (commandId: string, code: string, message: string): WorkflowCommandResult => ({ ok: false, commandId, error: { code, message } });
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const requiredString = (value: unknown, label: string) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label}不能为空`);
  return text;
};
const finiteNumber = (value: unknown, label: string, fallback?: number) => {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label}必须是有限数字`);
  return number;
};
const positiveNumber = (value: unknown, label: string) => {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new Error(`${label}必须大于 0`);
  return number;
};
const recordArg = (value: unknown, label: string) => {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`${label}必须是对象`);
  return value;
};

function validatedNode(args: Record<string, unknown>): WorkflowNode {
  const type = String(args.type || 'text') as WorkflowNodeType;
  if (!NODE_TYPES.includes(type)) throw new Error(`不支持的节点类型：${type}`);
  const metadata = recordArg(args.metadata, 'metadata') as WorkflowNodeMetadata;
  const node = createWorkflowNode(String(args.id || nanoid()), type, {
    x: finiteNumber(args.x, 'x', 0),
    y: finiteNumber(args.y, 'y', 0),
  }, metadata);
  if (args.title !== undefined) node.title = requiredString(args.title, 'title');
  if (args.width !== undefined) node.width = positiveNumber(args.width, 'width');
  if (args.height !== undefined) node.height = positiveNumber(args.height, 'height');
  return node;
}

function validateEnvelope(envelope: WorkflowCommandEnvelope): WorkflowCommandResult | null {
  if (!envelope || typeof envelope !== 'object') return error('', 'BAD_REQUEST', '命令 envelope 无效。');
  if (!String(envelope.id || '').trim()) return error('', 'BAD_REQUEST', '命令 id 不能为空。');
  if (!String(envelope.command || '').trim()) return error(envelope.id, 'BAD_REQUEST', '命令名称不能为空。');
  if (!isRecord(envelope.args)) return error(envelope.id, 'BAD_REQUEST', '命令参数必须是对象。');
  if (!['ui', 'cli', 'agent', 'mcp'].includes(envelope.source)) return error(envelope.id, 'BAD_REQUEST', '命令来源无效。');
  return null;
}

export function createWorkflowDispatcher(dependencies: WorkflowDispatcherDependencies) {
  const idempotencyCache = new Map<string, WorkflowCommandResult>();
  const cache = (key: string | undefined, result: WorkflowCommandResult) => {
    if (!key) return;
    idempotencyCache.set(key, result);
    while (idempotencyCache.size > MAX_IDEMPOTENCY_ENTRIES) idempotencyCache.delete(idempotencyCache.keys().next().value!);
  };

  return async (envelope: WorkflowCommandEnvelope): Promise<WorkflowCommandResult> => {
    const envelopeError = validateEnvelope(envelope);
    if (envelopeError) return envelopeError;
    const cacheKey = envelope.idempotencyKey && `${envelope.source}:${envelope.idempotencyKey}`;
    if (cacheKey && idempotencyCache.has(cacheKey)) return idempotencyCache.get(cacheKey)!;
    const { command, args } = envelope;
    if (WORKFLOW_MUTATION_COMMANDS.has(command) && (envelope.source === 'agent' || envelope.source === 'mcp') && args.confirmed !== true) {
      return { ok: true, commandId: envelope.id, confirmation: { required: true, summary: workflowCommandSummary(command, args) } };
    }

    try {
      const state = dependencies.getState();
      const projectId = String(args.projectId || state.activeProjectId || '');
      const project = state.projects.find(item => item.id === projectId);
      let result: WorkflowCommandResult;

      if (command === 'workflow.project.list') {
        result = { ok: true, commandId: envelope.id, result: state.projects.map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt })) };
      } else if (command === 'workflow.project.create') {
        const id = dependencies.createProject(args.title === undefined ? undefined : requiredString(args.title, 'title'));
        result = { ok: true, commandId: envelope.id, result: { projectId: id } };
      } else if (command === 'workflow.project.use') {
        if (!project) return error(envelope.id, 'NOT_FOUND', `Workflow 项目不存在：${projectId}`);
        dependencies.setActiveProject(projectId);
        result = { ok: true, commandId: envelope.id, result: { projectId } };
      } else if (command === 'workflow.project.delete') {
        if (!project) return error(envelope.id, 'NOT_FOUND', `Workflow 项目不存在：${projectId}`);
        dependencies.deleteProjects([projectId]);
        result = { ok: true, commandId: envelope.id, result: { projectId } };
      } else if (command === 'workflow.inspect') {
        if (!project) return error(envelope.id, 'NOT_FOUND', '当前没有可用的 Workflow 项目。');
        result = { ok: true, commandId: envelope.id, result: redactProject(project) };
      } else if (!project) {
        return error(envelope.id, 'NOT_FOUND', '当前没有可用的 Workflow 项目。');
      } else if (command === 'workflow.node.run' || command === 'workflow.node.stop') {
        const nodeId = requiredString(args.nodeId || args.id, 'nodeId');
        if (!project.nodes.some(node => node.id === nodeId)) return error(envelope.id, 'NOT_FOUND', `节点不存在：${nodeId}`);
        const runner = command === 'workflow.node.run' ? dependencies.runNode : dependencies.stopNode;
        if (!runner) return error(envelope.id, 'RUNNER_UNAVAILABLE', command === 'workflow.node.run' ? 'Workflow 生成适配器尚未连接。' : 'Workflow 停止适配器尚未连接。');
        await runner(project.id, nodeId);
        result = { ok: true, commandId: envelope.id, result: { projectId: project.id, nodeId } };
      } else {
        const requestedNodeId = String(args.nodeId || args.id || '');
        if (['workflow.node.update', 'workflow.node.delete', 'workflow.node.move', 'workflow.node.resize'].includes(command)
          && !project.nodes.some(node => node.id === requestedNodeId)) return error(envelope.id, 'NOT_FOUND', `节点不存在：${requestedNodeId}`);
        if (command === 'workflow.disconnect' && !project.connections.some(connection => connection.id === String(args.connectionId || args.id || ''))) {
          return error(envelope.id, 'NOT_FOUND', '指定的连接不存在。');
        }
        const snapshot = { projectId: project.id, title: project.title, nodes: project.nodes, connections: project.connections, selectedNodeIds: project.selectedNodeIds || [], viewport: project.viewport };
        let operation;
        if (command === 'workflow.node.create') {
          operation = { type: 'add_node' as const, node: validatedNode(args) };
        } else if (command === 'workflow.node.create-connected') {
          operation = { type: 'create_connected_node' as const, fromNodeId: requiredString(args.fromNodeId || args.from, 'fromNodeId'), node: validatedNode(args) };
        } else if (command === 'workflow.node.update') {
          const patch = recordArg(args.patch || args.updates, 'patch');
          if ('id' in patch) throw new Error('patch 不能修改节点 id');
          operation = { type: 'update_node' as const, id: requiredString(requestedNodeId, 'nodeId'), patch: patch as never };
        } else if (command === 'workflow.node.delete') {
          operation = { type: 'delete_nodes' as const, ids: [requiredString(requestedNodeId, 'nodeId')] };
        } else if (command === 'workflow.node.move') {
          operation = { type: 'update_node' as const, id: requiredString(requestedNodeId, 'nodeId'), patch: { position: { x: finiteNumber(args.x, 'x'), y: finiteNumber(args.y, 'y') } } };
        } else if (command === 'workflow.node.resize') {
          operation = { type: 'update_node' as const, id: requiredString(requestedNodeId, 'nodeId'), patch: { width: positiveNumber(args.width, 'width'), height: positiveNumber(args.height, 'height') } };
        } else if (command === 'workflow.connect') {
          operation = { type: 'connect_nodes' as const, id: args.id ? requiredString(args.id, 'id') : undefined, fromNodeId: requiredString(args.fromNodeId || args.from, 'fromNodeId'), toNodeId: requiredString(args.toNodeId || args.to, 'toNodeId') };
        } else if (command === 'workflow.disconnect') {
          operation = { type: 'delete_connections' as const, ids: [requiredString(args.connectionId || args.id, 'connectionId')] };
        } else if (command === 'workflow.select') {
          if (!Array.isArray(args.ids) || args.ids.some(id => typeof id !== 'string')) throw new Error('ids 必须是字符串数组');
          operation = { type: 'select_nodes' as const, ids: args.ids.map(String) };
        } else if (command === 'workflow.viewport.set') {
          const k = positiveNumber(args.k ?? args.zoom, 'k');
          operation = { type: 'set_viewport' as const, viewport: { x: finiteNumber(args.x, 'x'), y: finiteNumber(args.y, 'y'), k } };
        } else {
          return error(envelope.id, 'UNKNOWN_COMMAND', `未知 Workflow 命令：${command}`);
        }

        const applied = applyWorkflowOps(snapshot, [operation]);
        if (applied.rejections.length) return error(envelope.id, 'BAD_REQUEST', applied.rejections.map(item => item.reason).join('；'));
        dependencies.updateProject(project.id, {
          nodes: applied.snapshot.nodes,
          connections: applied.snapshot.connections,
          selectedNodeIds: applied.snapshot.selectedNodeIds,
          viewport: applied.snapshot.viewport,
        });
        const persistedError = dependencies.persistenceError?.();
        if (persistedError) return error(envelope.id, 'PERSISTENCE_FAILED', 'Workflow 持久化失败，请检查浏览器存储。');
        const committed = dependencies.getState().projects.find(item => item.id === project.id);
        if (!committed) return error(envelope.id, 'COMMIT_FAILED', 'Workflow 修改未提交。');
        result = { ok: true, commandId: envelope.id, result: { projectId: project.id, summary: workflowCommandSummary(command, args) } };
      }

      cache(cacheKey, result);
      return result;
    } catch (cause) {
      return error(envelope.id, 'BAD_REQUEST', cause instanceof Error ? cause.message : String(cause));
    }
  };
}

let browserNodeRunner: WorkflowDispatcherDependencies['runNode'];
let browserNodeStopper: WorkflowDispatcherDependencies['stopNode'];

export function setWorkflowNodeRunner(runner?: WorkflowDispatcherDependencies['runNode'], stopper?: WorkflowDispatcherDependencies['stopNode']) {
  browserNodeRunner = runner;
  browserNodeStopper = stopper;
}

const browserDependencies: WorkflowDispatcherDependencies = {
  getState: () => useWorkflowStore.getState(),
  createProject: title => useWorkflowStore.getState().createProject(title),
  setActiveProject: id => useWorkflowStore.getState().setActiveProject(id),
  deleteProjects: ids => useWorkflowStore.getState().deleteProjects(ids),
  updateProject: (id, patch) => useWorkflowStore.getState().updateProject(id, patch),
  runNode: (projectId, nodeId) => {
    if (!browserNodeRunner) throw new Error('Workflow 生成适配器尚未连接。');
    return browserNodeRunner(projectId, nodeId);
  },
  stopNode: (projectId, nodeId) => {
    if (!browserNodeStopper) throw new Error('Workflow 停止适配器尚未连接。');
    return browserNodeStopper(projectId, nodeId);
  },
  persistenceError: getWorkflowPersistenceError,
};

export const dispatchWorkflowCommand = createWorkflowDispatcher(browserDependencies);
