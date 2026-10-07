import { createWorkflowNode } from './constants';
import type { WorkflowNode, WorkflowNodeMetadata, WorkflowProject } from './types';

/**
 * Canvas ↔ 创作宿主（Resolve 首发）的纯数据规则。
 *
 * - 宿主片段在 Canvas 里只用 `creative-host` locator 表示（host + opaque locator），不按文件名猜。
 * - 宿主时间线条（HostStrip）是这些 locator 节点的投影，不另存状态。
 * - “Send to timeline” 只在项目文档里登记一个发送请求；真正写入宿主由宿主面板读取请求、
 *   经用户确认后执行（默认安全：写入 Media Pool，不改原时间线）。
 * 见 docs/design/10-canvas-workflow.md §8 与 14-creative-hosts.md §3.4。
 */

type Graph = Pick<WorkflowProject, 'nodes' | 'connections'>;

export interface WorkflowHostSource {
  nodeId: string;
  host: string;
  label: string;
  locator: Record<string, string | number>;
}

export interface WorkflowHostClip extends WorkflowHostSource {
  /** 该片段下游已有结果的节点数（结果 = 有媒体的节点）。 */
  resultCount: number;
  /** 下游已登记发送到宿主的节点数。 */
  sentCount: number;
}

export type { WorkflowHostSendRequest, WorkflowHostSendStatus } from './types';

export function workflowHostSourceOf(node: WorkflowNode): WorkflowHostSource | null {
  const locator = node.metadata.resourceLocator;
  if (!locator || locator.kind !== 'creative-host') return null;
  return {
    nodeId: node.id,
    host: locator.host,
    label: node.metadata.name || node.title,
    locator: { ...locator.locator },
  };
}

function hasMedia(node: WorkflowNode) {
  return Boolean(node.metadata.storageKey || node.metadata.href || node.metadata.artifactRef);
}

function downstreamIds(graph: Graph, startId: string): string[] {
  const outgoing = new Map<string, string[]>();
  for (const connection of graph.connections) {
    const list = outgoing.get(connection.fromNodeId) || [];
    list.push(connection.toNodeId);
    outgoing.set(connection.fromNodeId, list);
  }
  const seen = new Set<string>([startId]);
  const queue = [startId];
  const result: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of outgoing.get(id) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      result.push(next);
      queue.push(next);
    }
  }
  return result;
}

/** HostStrip 数据：项目中所有宿主片段，按画布从左到右排序。 */
export function listWorkflowHostClips(project: Graph): WorkflowHostClip[] {
  const byId = new Map(project.nodes.map(node => [node.id, node]));
  return project.nodes
    .map(node => ({ node, source: workflowHostSourceOf(node) }))
    .filter((item): item is { node: WorkflowNode; source: WorkflowHostSource } => Boolean(item.source))
    .sort((left, right) => left.node.position.x - right.node.position.x || left.node.position.y - right.node.position.y)
    .map(({ source }) => {
      const downstream = downstreamIds(project, source.nodeId).map(id => byId.get(id)).filter((node): node is WorkflowNode => Boolean(node));
      return {
        ...source,
        resultCount: downstream.filter(hasMedia).length,
        sentCount: downstream.filter(node => Boolean(node.metadata.hostSend)).length,
      };
    });
}

/** 沿连线向上找最近的宿主片段（广度优先，最近的优先）。 */
export function findWorkflowHostSourceFor(project: Graph, nodeId: string): WorkflowHostSource | null {
  const byId = new Map(project.nodes.map(node => [node.id, node]));
  const incoming = new Map<string, string[]>();
  for (const connection of project.connections) {
    const list = incoming.get(connection.toNodeId) || [];
    list.push(connection.fromNodeId);
    incoming.set(connection.toNodeId, list);
  }
  const start = byId.get(nodeId);
  if (!start) return null;
  const operationSource = start.metadata.sourceOperationNodeId;
  const queue = [nodeId, ...(operationSource ? [operationSource] : [])];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (node && id !== nodeId) {
      const source = workflowHostSourceOf(node);
      if (source) return source;
    }
    for (const previous of incoming.get(id) || []) {
      if (seen.has(previous)) continue;
      seen.add(previous);
      queue.push(previous);
    }
  }
  return null;
}

export type WorkflowHostSendEligibility =
  | { ok: true; source: WorkflowHostSource }
  | { ok: false; reason: 'no-media' | 'no-host-source' | 'is-host-source' | 'already-requested' };

export function workflowHostSendEligibility(project: Graph, nodeId: string): WorkflowHostSendEligibility {
  const node = project.nodes.find(item => item.id === nodeId);
  if (!node || !hasMedia(node)) return { ok: false, reason: 'no-media' };
  if (workflowHostSourceOf(node)) return { ok: false, reason: 'is-host-source' };
  if (node.metadata.hostSend?.status === 'requested') return { ok: false, reason: 'already-requested' };
  const source = findWorkflowHostSourceFor(project, nodeId);
  return source ? { ok: true, source } : { ok: false, reason: 'no-host-source' };
}

/** 生成“发送到宿主”的 metadata 补丁；不可发送时返回 null。 */
export function buildWorkflowHostSendPatch(
  project: Graph,
  nodeId: string,
  options: { requestId: string; now: string },
): Pick<WorkflowNodeMetadata, 'hostSend'> | null {
  const eligibility = workflowHostSendEligibility(project, nodeId);
  if (!eligibility.ok) return null;
  const { source } = eligibility;
  const hostProjectId = source.locator.projectId;
  return {
    hostSend: {
      requestId: options.requestId,
      host: source.host,
      ...(hostProjectId !== undefined ? { hostProjectId: String(hostProjectId) } : {}),
      sourceNodeId: source.nodeId,
      sourceLocator: { ...source.locator },
      target: 'media-pool',
      status: 'requested',
      requestedAt: options.now,
    },
  };
}

/** 宿主面板读取的待发送列表（只读投影）。 */
export function listWorkflowHostSendRequests(project: Pick<WorkflowProject, 'nodes'>, host?: string) {
  return project.nodes
    .filter(node => node.metadata.hostSend && (!host || node.metadata.hostSend.host === host))
    .map(node => ({ nodeId: node.id, title: node.title, request: node.metadata.hostSend! }));
}

// ───────────────────────── Open in Iris handoff ─────────────────────────

export interface WorkflowHostHandoff {
  host: string;
  label: string;
  kind: 'image' | 'video';
  locator: Record<string, string>;
}

const HANDOFF_PARAM = 'host';
const LOCATOR_PREFIX = 'loc.';
const SAFE_VALUE = /^[\w.:\-/ ]{1,200}$/u;

/**
 * 读取 `#/app?host=resolve&label=...&kind=video&loc.projectId=...` 形式的交接参数。
 * 只接受白名单字符，未知或缺字段时返回 null（不猜）。
 */
export function parseWorkflowHostHandoff(hash: string): WorkflowHostHandoff | null {
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) return null;
  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  const host = params.get(HANDOFF_PARAM) || '';
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(host)) return null;
  const locator: Record<string, string> = {};
  params.forEach((value, key) => {
    if (!key.startsWith(LOCATOR_PREFIX)) return;
    const name = key.slice(LOCATOR_PREFIX.length);
    if (/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(name) && SAFE_VALUE.test(value)) locator[name] = value;
  });
  if (Object.keys(locator).length === 0) return null;
  const rawLabel = params.get('label') || '';
  const label = rawLabel.slice(0, 120) || host;
  const kind = params.get('kind') === 'image' ? 'image' : 'video';
  return { host, label, kind, locator };
}

/** 只移除交接参数（host / label / kind / loc.*），保留 hash 中其他模块的参数。 */
export function stripWorkflowHostHandoff(hash: string): string {
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) return hash;
  const route = hash.slice(0, queryIndex);
  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  [...params.keys()].forEach(key => {
    if (key === HANDOFF_PARAM || key === 'label' || key === 'kind' || key.startsWith(LOCATOR_PREFIX)) params.delete(key);
  });
  const rest = params.toString();
  return rest ? `${route}?${rest}` : route;
}

function sameLocator(left: Record<string, string | number>, right: Record<string, string | number>) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && String(left[key]) === String(right[key]));
}

/** 已有同一宿主片段的节点（同 host + 同 locator）就复用，避免重复打开产生多份。 */
export function findWorkflowNodeForHandoff(project: Pick<WorkflowProject, 'nodes'>, handoff: WorkflowHostHandoff): WorkflowNode | null {
  return project.nodes.find(node => {
    const source = workflowHostSourceOf(node);
    return Boolean(source && source.host === handoff.host && sameLocator(source.locator, handoff.locator));
  }) || null;
}

export function createWorkflowHostSourceNode(id: string, handoff: WorkflowHostHandoff, position: { x: number; y: number }): WorkflowNode {
  const node = createWorkflowNode(id, handoff.kind, position, {
    name: handoff.label,
    resourceLocator: { kind: 'creative-host', host: handoff.host, locator: { ...handoff.locator } },
  });
  node.title = handoff.label;
  return node;
}
