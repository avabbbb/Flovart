// 节点引用解析（P1-3）：把用户/Agent 写的「A02」「S01」「shot:3」「@"主角定妆"」或节点 id 解析成 nodeId。
// 纯函数；锚点编号来自 anchor.code，旧数据按 deriveAnchorCodes 确定性推导。
import { deriveAnchorCodes, normalizeAnchorCode } from '../../services/anchorApproval';
import type { WorkflowNode } from './types';

type RefNode = Pick<WorkflowNode, 'id' | 'title' | 'anchor' | 'shot' | 'type'>;

export type NodeRefMatch = 'id' | 'code' | 'shot' | 'name';
export interface NodeRefCandidate { nodeId: string; title: string; type: string; code?: string }
export type NodeRefResult =
  | { ok: true; nodeId: string; via: NodeRefMatch }
  | { ok: false; code: 'NOT_FOUND' | 'AMBIGUOUS_NODE_NAME'; ref: string; candidates: NodeRefCandidate[] };

export type NodeRefMiss = Extract<NodeRefResult, { ok: false }>;
/** 类型守卫（项目未开 strictNullChecks，布尔判别联合不能自动收窄）。 */
export const isNodeRefMiss = (result: NodeRefResult): result is NodeRefMiss => result.ok === false;

export interface NodeRefIndex {
  nodes: readonly RefNode[];
  codes: Map<string, string>;
  byCode: Map<string, string>;
}

export function buildNodeRefIndex(nodes: readonly RefNode[]): NodeRefIndex {
  const codes = deriveAnchorCodes(nodes);
  const byCode = new Map([...codes].map(([nodeId, code]) => [code, nodeId]));
  return { nodes, codes, byCode };
}

const unquote = (value: string) => {
  let ref = value.trim();
  if (ref.startsWith('@')) ref = ref.slice(1).trim();
  const quoted = /^["“「『'](.*)["”」』']$/u.exec(ref);
  return quoted ? quoted[1].trim() : ref;
};

const candidateOf = (index: NodeRefIndex, node: RefNode): NodeRefCandidate => ({
  nodeId: node.id,
  title: node.title,
  type: node.type,
  ...(index.codes.get(node.id) ? { code: index.codes.get(node.id) } : {}),
});

/** 解析单个引用。优先级：精确 id → 锚点编号 → shot:N（或「第N镜」）→ 节点名（重名报 AMBIGUOUS_NODE_NAME）。 */
export function resolveNodeRef(input: string, nodesOrIndex: readonly RefNode[] | NodeRefIndex): NodeRefResult {
  const index = Array.isArray(nodesOrIndex) ? buildNodeRefIndex(nodesOrIndex as readonly RefNode[]) : nodesOrIndex as NodeRefIndex;
  const raw = String(input ?? '').trim();
  const ref = unquote(raw);
  if (!ref) return { ok: false, code: 'NOT_FOUND', ref: raw, candidates: [] };
  const plain = ref.startsWith('ref:') ? ref.slice(4) : ref;
  if (index.nodes.some(node => node.id === plain)) return { ok: true, nodeId: plain, via: 'id' };

  const code = normalizeAnchorCode(plain);
  if (code && index.byCode.has(code)) return { ok: true, nodeId: index.byCode.get(code)!, via: 'code' };

  const shotMatch = /^(?:shot[:#\s]*|第\s*)(\d+)\s*镜?$/i.exec(plain);
  if (shotMatch) {
    const shotIndex = Number(shotMatch[1]);
    const hits = index.nodes.filter(node => node.shot?.index === shotIndex);
    if (hits.length === 1) return { ok: true, nodeId: hits[0].id, via: 'shot' };
    return { ok: false, code: hits.length ? 'AMBIGUOUS_NODE_NAME' : 'NOT_FOUND', ref: raw, candidates: hits.map(node => candidateOf(index, node)) };
  }

  const named = index.nodes.filter(node => (node.title || '').trim() === plain);
  if (named.length === 1) return { ok: true, nodeId: named[0].id, via: 'name' };
  if (named.length > 1) return { ok: false, code: 'AMBIGUOUS_NODE_NAME', ref: raw, candidates: named.map(node => candidateOf(index, node)) };
  return { ok: false, code: 'NOT_FOUND', ref: raw, candidates: [] };
}

export interface ExtractedNodeRefs {
  /** 已把可解析引用改写成 `@ref:<id>` 的文本。 */
  text: string;
  nodeIds: string[];
  /** 写成编号/shot/带引号名称但找不到的引用，原样保留。 */
  unresolved: string[];
  ambiguous: Array<{ ref: string; candidates: NodeRefCandidate[] }>;
}

// @A01 / @shot:3 / @"名称" / @「名称」；@ref:<id> 与普通 @标签 交给 promptDocument。
const MENTION_PATTERN = /(?<![\w@])@(?:(["“「『])([^"”」』\n]+)["”」』]|(shot:\d+)|([ASPTaspt]\d{1,4})(?![\w-]))/gu;

/** 在提示词里找节点引用并改写成 `@ref:<id>`；不认识的普通 @文字不动。 */
export function extractNodeRefs(text: string, nodesOrIndex: readonly RefNode[] | NodeRefIndex): ExtractedNodeRefs {
  const index = Array.isArray(nodesOrIndex) ? buildNodeRefIndex(nodesOrIndex as readonly RefNode[]) : nodesOrIndex as NodeRefIndex;
  const nodeIds: string[] = [];
  const unresolved: string[] = [];
  const ambiguous: ExtractedNodeRefs['ambiguous'] = [];
  const rewritten = String(text ?? '').replace(MENTION_PATTERN, (whole, _quote, quotedName, shot, code) => {
    const ref = quotedName ?? shot ?? code;
    const result = resolveNodeRef(ref, index);
    if (!isNodeRefMiss(result)) {
      if (!nodeIds.includes(result.nodeId)) nodeIds.push(result.nodeId);
      return '@ref:' + result.nodeId;
    }
    if (result.code === 'AMBIGUOUS_NODE_NAME') ambiguous.push({ ref: whole, candidates: result.candidates });
    else unresolved.push(whole);
    return whole;
  });
  return { text: rewritten, nodeIds, unresolved, ambiguous };
}
