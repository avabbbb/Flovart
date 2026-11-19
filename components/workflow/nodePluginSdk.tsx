import localforage from 'localforage';
import type { ReactNode } from 'react';
import { registerWorkflowNodeDefinition } from './resourceContract';
import type {
  WorkflowConnection,
  WorkflowDocumentOperation,
  WorkflowGenerationReferenceRole,
  WorkflowNode,
  WorkflowNodeDefinition,
  WorkflowNodeMetadata,
  WorkflowProject,
  WorkflowResourceKind,
} from './types';

export interface NodePluginStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface NodePluginEvents {
  on(event: string, handler: (payload: unknown) => void): () => void;
  emit(event: string, payload?: unknown): void;
}

export interface WorkflowNodePluginContext {
  readonly projectId: string;
  readonly node: Readonly<WorkflowNode>;
  getNodes(): readonly WorkflowNode[];
  getUpstream(): readonly WorkflowNode[];
  updateMetadata(patch: Partial<WorkflowNodeMetadata>): boolean;
  applyOps(ops: WorkflowDocumentOperation[]): boolean;
  storage: NodePluginStorage;
  events: NodePluginEvents;
}

export interface NodePluginRenderProps {
  node: Readonly<WorkflowNode>;
  context: WorkflowNodePluginContext;
}

export interface WorkflowNodePluginInput {
  id: string;
  label: string;
  kind?: WorkflowResourceKind;
  role?: WorkflowGenerationReferenceRole;
  required?: boolean;
  multiple?: boolean;
}

export interface WorkflowNodePluginDefinition extends Omit<WorkflowNodeDefinition, 'output'> {
  pluginId: string;
  version: string;
  title: string;
  description?: string;
  /** SDK 命名；宿主会把它归一化为既有 Resource Contract 的 output。 */
  outputs?: (node: WorkflowNode) => ReturnType<WorkflowNodeDefinition['output']>;
  /** 仅用于迁移已有内部定义，新插件应使用 outputs。 */
  output?: WorkflowNodeDefinition['output'];
  inputs?: WorkflowNodePluginInput[];
  render: (props: NodePluginRenderProps) => ReactNode;
  panel?: (props: NodePluginRenderProps) => ReactNode;
  toolbar?: (props: NodePluginRenderProps) => ReactNode;
  onDoubleClick?: (context: WorkflowNodePluginContext) => void;
}

export interface WorkflowNodePluginInfo {
  pluginId: string;
  type: string;
  title: string;
  version: string;
  enabled: boolean;
}

const pluginStorage = localforage.createInstance({ name: 'iris', storeName: 'workflow_node_plugins' });
const eventChannels = new Map<string, Map<string, Set<(payload: unknown) => void>>>();

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function eventChannel(projectId: string, pluginId: string) {
  const key = `${projectId}:${pluginId}`;
  let channel = eventChannels.get(key);
  if (!channel) {
    channel = new Map();
    eventChannels.set(key, channel);
  }
  return channel;
}

function createEvents(projectId: string, pluginId: string): NodePluginEvents {
  const channel = eventChannel(projectId, pluginId);
  return {
    on(event, handler) {
      const handlers = channel.get(event) || new Set();
      handlers.add(handler);
      channel.set(event, handlers);
      return () => handlers.delete(handler);
    },
    emit(event, payload) {
      channel.get(event)?.forEach(handler => handler(payload));
    },
  };
}

function createStorage(projectId: string, pluginId: string, nodeId: string): NodePluginStorage {
  const prefix = `${projectId}/${pluginId}/${nodeId}/`;
  return {
    async get<T>(key) {
      return (await pluginStorage.getItem<T>(`${prefix}${key}`)) ?? undefined;
    },
    async set<T>(key, value) {
      await pluginStorage.setItem(`${prefix}${key}`, value);
    },
    async remove(key) {
      await pluginStorage.removeItem(`${prefix}${key}`);
    },
  };
}

function snapshotNode(node: WorkflowNode): WorkflowNode {
  return clone(node);
}

function registerPluginOutput(definition: WorkflowNodePluginDefinition) {
  return registerWorkflowNodeDefinition({ type: definition.type, output: definition.outputs || definition.output! });
}

export function createWorkflowNodePluginContext(input: {
  project: Pick<WorkflowProject, 'id' | 'nodes' | 'connections'>;
  node: WorkflowNode;
  pluginId: string;
  applyOps: (ops: WorkflowDocumentOperation[]) => boolean;
}): WorkflowNodePluginContext {
  const currentNode = snapshotNode(input.node);
  const getNodes = () => input.project.nodes.map(snapshotNode);
  return {
    projectId: input.project.id,
    node: currentNode,
    getNodes,
    getUpstream: () => {
      const upstreamIds = new Set(input.project.connections.filter(connection => connection.toNodeId === input.node.id).map(connection => connection.fromNodeId));
      return getNodes().filter(node => upstreamIds.has(node.id));
    },
    updateMetadata: patch => input.applyOps([{ type: 'update_node', id: input.node.id, metadata: clone(patch) }]),
    applyOps: input.applyOps,
    storage: createStorage(input.project.id, input.pluginId, input.node.id),
    events: createEvents(input.project.id, input.pluginId),
  };
}

function validatePlugin(definition: WorkflowNodePluginDefinition): void {
  if (!definition.pluginId || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(definition.pluginId)) throw new Error('Node Plugin pluginId 无效。');
  if (!definition.type || !/^[a-z0-9][a-z0-9._:-]{1,63}$/i.test(definition.type)) throw new Error('Node Plugin type 无效。');
  if (!definition.version.trim()) throw new Error('Node Plugin version 不能为空。');
  if (typeof (definition.outputs || definition.output) !== 'function' || typeof definition.render !== 'function') throw new Error('Node Plugin 必须声明 outputs 与 render。');
}

type InstalledPlugin = {
  definition: WorkflowNodePluginDefinition;
  restoreOutput: () => void;
  enabled: boolean;
  history: WorkflowNodePluginDefinition[];
};

export class WorkflowNodePluginRegistry {
  private readonly plugins = new Map<string, InstalledPlugin>();

  install(definition: WorkflowNodePluginDefinition): WorkflowNodePluginInfo {
    validatePlugin(definition);
    if (this.plugins.has(definition.pluginId)) throw new Error(`Node Plugin「${definition.pluginId}」已安装。`);
    if ([...this.plugins.values()].some(item => item.definition.type === definition.type)) throw new Error(`Node Plugin type「${definition.type}」已被占用。`);
    this.plugins.set(definition.pluginId, { definition, restoreOutput: registerPluginOutput(definition), enabled: true, history: [] });
    return this.info(definition.pluginId)!;
  }

  update(definition: WorkflowNodePluginDefinition): WorkflowNodePluginInfo {
    validatePlugin(definition);
    const current = this.plugins.get(definition.pluginId);
    if (!current) throw new Error(`Node Plugin「${definition.pluginId}」尚未安装。`);
    if (current.definition.type !== definition.type) throw new Error('Node Plugin 更新不能改变 type。');
    const previousDefinition = current.definition;
    current.restoreOutput();
    try {
      current.restoreOutput = registerPluginOutput(definition);
      current.definition = definition;
      current.history.push(previousDefinition);
    } catch (error) {
      current.restoreOutput = registerPluginOutput(previousDefinition);
      throw error;
    }
    return this.info(definition.pluginId)!;
  }

  rollback(pluginId: string): WorkflowNodePluginInfo {
    const current = this.require(pluginId);
    const previousDefinition = current.history.pop();
    if (!previousDefinition) throw new Error(`Node Plugin「${pluginId}」没有可回滚版本。`);
    current.restoreOutput();
    current.restoreOutput = registerPluginOutput(previousDefinition);
    current.definition = previousDefinition;
    return this.info(pluginId)!;
  }

  enable(pluginId: string): WorkflowNodePluginInfo {
    const current = this.require(pluginId);
    current.enabled = true;
    return this.info(pluginId)!;
  }

  disable(pluginId: string): WorkflowNodePluginInfo {
    const current = this.require(pluginId);
    current.enabled = false;
    return this.info(pluginId)!;
  }

  uninstall(pluginId: string): boolean {
    const current = this.plugins.get(pluginId);
    if (!current) return false;
    current.restoreOutput();
    this.plugins.delete(pluginId);
    return true;
  }

  getForNodeType(type: string): WorkflowNodePluginDefinition | undefined {
    const plugin = [...this.plugins.values()].find(item => item.definition.type === type && item.enabled);
    return plugin?.definition;
  }

  list(): WorkflowNodePluginInfo[] {
    return [...this.plugins.keys()].map(pluginId => this.info(pluginId)!).filter(Boolean);
  }

  clear(): void {
    [...this.plugins.keys()].forEach(pluginId => this.uninstall(pluginId));
  }

  private require(pluginId: string): InstalledPlugin {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Node Plugin「${pluginId}」尚未安装。`);
    return plugin;
  }

  private info(pluginId: string): WorkflowNodePluginInfo | undefined {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return undefined;
    return {
      pluginId,
      type: plugin.definition.type,
      title: plugin.definition.title,
      version: plugin.definition.version,
      enabled: plugin.enabled,
    };
  }
}

export const workflowNodePluginRegistry = new WorkflowNodePluginRegistry();

export function getWorkflowNodePlugin(type: string): WorkflowNodePluginDefinition | undefined {
  return workflowNodePluginRegistry.getForNodeType(type);
}

export function installWorkflowNodePlugin(definition: WorkflowNodePluginDefinition): WorkflowNodePluginInfo {
  return workflowNodePluginRegistry.install(definition);
}

export function updateWorkflowNodePlugin(definition: WorkflowNodePluginDefinition): WorkflowNodePluginInfo {
  return workflowNodePluginRegistry.update(definition);
}

export function rollbackWorkflowNodePlugin(pluginId: string): WorkflowNodePluginInfo {
  return workflowNodePluginRegistry.rollback(pluginId);
}

export function enableWorkflowNodePlugin(pluginId: string): WorkflowNodePluginInfo {
  return workflowNodePluginRegistry.enable(pluginId);
}

export function disableWorkflowNodePlugin(pluginId: string): WorkflowNodePluginInfo {
  return workflowNodePluginRegistry.disable(pluginId);
}

export function uninstallWorkflowNodePlugin(pluginId: string): boolean {
  return workflowNodePluginRegistry.uninstall(pluginId);
}

function textOutput(node: WorkflowNode): ReturnType<WorkflowNodeDefinition['output']> {
  const text = (node.metadata.content || node.metadata.prompt || '').trim();
  return text ? [{ resourceId: `${node.id}:output:0`, title: node.title, kind: 'text', locator: { kind: 'inline-text', text } }] : [];
}

function PluginShell({ node, context, children, hint }: { node: Readonly<WorkflowNode>; context: WorkflowNodePluginContext; children?: ReactNode; hint: string }) {
  return <div className="workflow-node__plugin-card">
    <strong>{node.title}</strong>
    <span>{hint}</span>
    {children || <p>{String(node.metadata.content || node.metadata.prompt || '双击或使用工具栏编辑插件内容')}</p>}
    <button type="button" onPointerDown={event => event.stopPropagation()} onClick={() => context.updateMetadata({ content: node.metadata.content ? `${node.metadata.content}\n` : '' })}>插入一行</button>
  </div>;
}

export const referenceWorkflowNodePlugins: WorkflowNodePluginDefinition[] = [
  {
    pluginId: 'flovart.markdown', type: 'plugin:markdown', version: '1.0.0', title: 'Markdown', description: '可编辑的 Markdown 生产笔记。',
    outputs: textOutput,
    inputs: [{ id: 'context', label: '上下文', kind: 'text', role: 'reference', multiple: true }],
    render: ({ node, context }) => <PluginShell node={node} context={context} hint="Markdown 生产笔记" />,
    panel: ({ node }) => <span>{node.metadata.content ? '已填写内容' : '等待内容'}</span>,
    toolbar: ({ context }) => <button type="button" onClick={() => context.events.emit('focus-editor')}>编辑</button>,
  },
  {
    pluginId: 'flovart.storyboard-card', type: 'plugin:storyboard-card', version: '1.0.0', title: 'Storyboard Card', description: '镜头卡片的文本化节点。',
    outputs: textOutput,
    inputs: [{ id: 'brief', label: '镜头描述', kind: 'text', required: true }],
    render: ({ node, context }) => <PluginShell node={node} context={context} hint="镜头卡片" />,
    panel: ({ node }) => <span>{node.metadata.content ? '镜头描述已就绪' : '补充镜头描述'}</span>,
    toolbar: ({ context }) => <button type="button" onClick={() => context.events.emit('add-shot')}>新增镜头</button>,
  },
  {
    pluginId: 'flovart.style-bible', type: 'plugin:style-bible', version: '1.0.0', title: 'Style Bible', description: '跨镜头视觉规则节点。',
    outputs: textOutput,
    inputs: [{ id: 'references', label: '参考资料', kind: 'text', role: 'style', multiple: true }],
    render: ({ node, context }) => <PluginShell node={node} context={context} hint="视觉规则" />,
    panel: ({ node }) => <span>{node.metadata.content ? '风格规则已填写' : '补充颜色、材质和镜头规则'}</span>,
    toolbar: ({ context }) => <button type="button" onClick={() => context.events.emit('focus-style-bible')}>聚焦规则</button>,
  },
];

export function installReferenceWorkflowNodePlugins(): WorkflowNodePluginInfo[] {
  return referenceWorkflowNodePlugins.map(definition => {
    const existing = workflowNodePluginRegistry.list().find(item => item.pluginId === definition.pluginId);
    return existing ? existing : workflowNodePluginRegistry.install(definition);
  });
}

installReferenceWorkflowNodePlugins();

export function workflowNodePluginContextFromProject(input: {
  project: Pick<WorkflowProject, 'id' | 'nodes' | 'connections'>;
  node: WorkflowNode;
  applyOps: (ops: WorkflowDocumentOperation[]) => boolean;
}): WorkflowNodePluginContext | undefined {
  const plugin = getWorkflowNodePlugin(input.node.type);
  return plugin ? createWorkflowNodePluginContext({ ...input, pluginId: plugin.pluginId }) : undefined;
}

export function workflowPluginConnections(project: Pick<WorkflowProject, 'connections'>, nodeId: string): WorkflowConnection[] {
  return project.connections.filter(connection => connection.toNodeId === nodeId || connection.fromNodeId === nodeId).map(clone);
}
