import type {
  WorkflowNode,
  WorkflowNodeDefinition,
  WorkflowResource,
  WorkflowResourceKind,
  WorkflowResourceLocator,
} from './types';

export function workflowNodeOutputResourceId(nodeId: string, index = 0) {
  return `${nodeId}:output:${index}`;
}

function mediaLocator(node: WorkflowNode): WorkflowResourceLocator {
  const metadata = node.metadata;
  if (metadata.resourceLocator) return metadata.resourceLocator;
  if (metadata.sourceType === 'assetLibrary' && metadata.assetId) return { kind: 'asset', assetId: metadata.assetId };
  if (metadata.storageKey) return { kind: 'workflow-storage', storageKey: metadata.storageKey };
  if (metadata.artifactRef?.taskId) return { kind: 'runtime-artifact', artifactRef: metadata.artifactRef };
  if (metadata.href) return /^(?:https?:|blob:|data:)/i.test(metadata.href)
    ? { kind: 'remote-url', href: metadata.href }
    : { kind: 'legacy-href', href: metadata.href };
  return { kind: 'missing', reason: '节点没有可用媒体' };
}

function mediaOutput(node: WorkflowNode, kind: Extract<WorkflowResourceKind, 'image' | 'video' | 'audio'>): WorkflowResource[] {
  return [{
    resourceId: workflowNodeOutputResourceId(node.id),
    title: node.title,
    kind,
    locator: mediaLocator(node),
    mimeType: node.metadata.mimeType || node.metadata.artifactRef?.mimeType,
  }];
}

function textOutput(node: WorkflowNode): WorkflowResource[] {
  const text = (node.type === 'text' ? node.metadata.content : node.metadata.prompt)?.trim();
  if (!text) return [];
  return [{
    resourceId: workflowNodeOutputResourceId(node.id),
    title: node.title,
    kind: 'text',
    locator: { kind: 'inline-text', text },
  }];
}

const definitions = new Map<string, WorkflowNodeDefinition>([
  ['image', { type: 'image', output: node => mediaOutput(node, 'image') }],
  ['video', { type: 'video', output: node => mediaOutput(node, 'video') }],
  ['audio', { type: 'audio', output: node => mediaOutput(node, 'audio') }],
  ['text', { type: 'text', output: textOutput }],
  ['config', { type: 'config', output: textOutput }],
  ['script', { type: 'script', output: () => [] }],
  ['operation', { type: 'operation', output: () => [] }],
]);

/** 插件可注册同一输出契约；调用方只依赖这个接口，不依赖节点 metadata。 */
export function registerWorkflowNodeDefinition(definition: WorkflowNodeDefinition) {
  const previous = definitions.get(definition.type);
  definitions.set(definition.type, definition);
  return () => {
    if (previous) definitions.set(definition.type, previous);
    else definitions.delete(definition.type);
  };
}

export function findWorkflowNodeDefinition(type: string) {
  return definitions.get(type);
}

export function getWorkflowNodeDefinition(type: string): WorkflowNodeDefinition {
  const definition = findWorkflowNodeDefinition(type);
  if (!definition) throw new Error(`节点「${type}」没有注册输出契约`);
  return definition;
}
