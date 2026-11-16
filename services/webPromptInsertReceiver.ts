// 插件内反推的结果落到网页画布（审计 T9）：反推出来的是提示词，所以写进生成节点的 Prompt Bar，
// 而不是新建文本节点让用户再手动搬运。
// - 插件给了 targetNodeId（图片/视频生成节点）：只改该节点的 prompt；原有 @chip 由 workflow.apply 的 update_node 保留。
// - 没给目标：在当前视口左上方新建一个空的 image 生成节点，提示词写进它的 Prompt Bar（只建不跑）。
// 只有类型依赖，dispatch 与 id 生成由调用方注入，便于在 node 环境测试。
import { buildWorkflowPromptDocument } from '../components/workflow/promptDocument';
import type { WorkflowProject } from '../components/workflow/types';
import type { ExtensionBridge, ExtensionBridgeMessage } from './extensionBridge';
import type { WorkflowCommandEnvelope, WorkflowCommandResult } from './workflowDispatcher';

const MAX_PROMPT_LENGTH = 20_000;
const GENERATION_TYPES = new Set(['image', 'video']);

export interface PromptInsertDependencies {
  getActiveProject(): WorkflowProject | null;
  dispatch(envelope: WorkflowCommandEnvelope): Promise<WorkflowCommandResult>;
  createId(): string;
}

export interface PromptInsertResult {
  nodeId: string;
  projectId: string;
  /** created = 新建了 image 生成节点；updated = 写进了插件指定的生成节点 */
  mode: 'created' | 'updated';
}

/** 新建一个 image 生成节点，反推结果写进它的 Prompt Bar 文档。 */
export function createPromptGenerationNodeMutation(project: WorkflowProject, text: string, nodeId: string): WorkflowCommandEnvelope {
  const zoom = Math.max(project.viewport.k, 0.12);
  const document = buildWorkflowPromptDocument({ text, targetNodeId: nodeId, nodes: [], connections: [] });
  return {
    id: 'command-' + nodeId,
    command: 'workflow.node.create',
    source: 'ui',
    idempotencyKey: 'reverse-prompt:' + nodeId,
    args: {
      projectId: project.id,
      id: nodeId,
      type: 'image',
      title: '反推提示词',
      x: (220 - project.viewport.x) / zoom,
      y: (180 - project.viewport.y) / zoom,
      metadata: { prompt: document.prompt, richTextDocument: document.richTextDocument, status: 'idle' },
    },
  };
}

/** 把反推结果写进已有生成节点的 Prompt Bar（只给 prompt，update_node 会保留原有 @引用）。 */
export function writePromptToNodeMutation(project: WorkflowProject, text: string, nodeId: string, mutationId: string): WorkflowCommandEnvelope {
  return {
    id: 'command-' + mutationId,
    command: 'workflow.apply',
    source: 'ui',
    idempotencyKey: 'reverse-prompt:' + mutationId,
    args: {
      projectId: project.id,
      expectedRevision: project.draftVersion || 1,
      mutationId: 'reverse-prompt:' + mutationId,
      intent: '反推提示词写入 ' + nodeId,
      operations: [{ type: 'update_node', id: nodeId, metadata: { prompt: text } }],
    },
  };
}

export async function insertPromptFromExtension(
  message: ExtensionBridgeMessage,
  dependencies: PromptInsertDependencies,
): Promise<PromptInsertResult> {
  const text = typeof message.text === 'string' ? message.text.trim().slice(0, MAX_PROMPT_LENGTH) : '';
  if (!text) throw new Error('反推结果为空');
  const project = dependencies.getActiveProject();
  if (!project) throw new Error('网页画布当前没有打开的 Workflow 项目');
  const targetId = typeof message.targetNodeId === 'string' ? message.targetNodeId.trim() : '';
  const target = targetId ? project.nodes?.find(node => node.id === targetId) : undefined;
  if (targetId && !target) throw new Error('目标节点不存在：' + targetId);
  if (target && !GENERATION_TYPES.has(target.type)) throw new Error('目标节点不是图片/视频生成节点，反推提示词只能写进生成节点的 Prompt Bar');
  const id = dependencies.createId();
  const result = target
    ? await dependencies.dispatch(writePromptToNodeMutation(project, text, target.id, id))
    : await dependencies.dispatch(createPromptGenerationNodeMutation(project, text, id));
  if (result && result.ok === false) throw new Error(result.error?.message || '写入画布失败');
  return target
    ? { nodeId: target.id, projectId: project.id, mode: 'updated' }
    : { nodeId: id, projectId: project.id, mode: 'created' };
}

export function registerWebPromptInsertReceiver(
  bridge: Pick<ExtensionBridge, 'onRequest'>,
  dependencies: PromptInsertDependencies,
): () => void {
  return bridge.onRequest('prompt.insert', message => insertPromptFromExtension(message, dependencies));
}
