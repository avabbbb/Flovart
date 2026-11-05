// 插件内反推的结果落到网页画布：在当前 Workflow 视口左上方新建文本节点，内容写入 metadata.content。
// 只有类型依赖，dispatch 与 id 生成由调用方注入，便于在 node 环境测试。
import type { WorkflowProject } from '../components/workflow/types';
import type { ExtensionBridge, ExtensionBridgeMessage } from './extensionBridge';
import type { WorkflowCommandEnvelope, WorkflowCommandResult } from './workflowDispatcher';

const MAX_PROMPT_LENGTH = 20_000;
const NODE_WIDTH = 360;
const NODE_HEIGHT = 240;

export interface PromptInsertDependencies {
  getActiveProject(): WorkflowProject | null;
  dispatch(envelope: WorkflowCommandEnvelope): Promise<WorkflowCommandResult>;
  createId(): string;
}

export interface PromptInsertResult {
  nodeId: string;
  projectId: string;
}

export function createPromptTextNodeMutation(project: WorkflowProject, text: string, nodeId: string): WorkflowCommandEnvelope {
  const zoom = Math.max(project.viewport.k, 0.12);
  return {
    id: 'command-' + nodeId,
    command: 'workflow.node.create',
    source: 'ui',
    idempotencyKey: 'reverse-prompt:' + nodeId,
    args: {
      projectId: project.id,
      id: nodeId,
      type: 'text',
      title: '反推提示词',
      x: (220 - project.viewport.x) / zoom,
      y: (180 - project.viewport.y) / zoom,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      metadata: { content: text, status: 'success' },
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
  const nodeId = dependencies.createId();
  await dependencies.dispatch(createPromptTextNodeMutation(project, text, nodeId));
  return { nodeId, projectId: project.id };
}

export function registerWebPromptInsertReceiver(
  bridge: Pick<ExtensionBridge, 'onRequest'>,
  dependencies: PromptInsertDependencies,
): () => void {
  return bridge.onRequest('prompt.insert', message => insertPromptFromExtension(message, dependencies));
}
