import type { WorkflowAnchorKind, WorkflowNode } from '../components/workflow/types';

/** 锚点编号前缀：角色 A、场景 S、产品/道具 P、风格 T。 */
export const ANCHOR_CODE_PREFIX: Record<WorkflowAnchorKind, string> = { character: 'A', scene: 'S', product: 'P', style: 'T' };
const CODE_PATTERN = /^([ASPT])(\d{1,4})$/i;

/** 规范化编号写法：a1 / A001 / A01 → A01；不是编号返回 ''。 */
export function normalizeAnchorCode(value: string): string {
  const match = CODE_PATTERN.exec(String(value || '').trim());
  if (!match) return '';
  return match[1].toUpperCase() + String(Number(match[2])).padStart(2, '0');
}

type AnchorPeer = Pick<WorkflowNode, 'id' | 'anchor'>;

function nextCode(prefix: string, taken: Set<string>) {
  for (let index = 1; ; index += 1) {
    const code = prefix + String(index).padStart(2, '0');
    if (!taken.has(code)) return code;
  }
}

/**
 * 全部锚点的编号（nodeId → code）。已写入的 code 原样保留（重复时后者重新分配）；
 * 旧数据里已批准但没有 code 的锚点按节点数组顺序确定性补推导；未批准且没有 code 的锚点不编号。
 */
export function deriveAnchorCodes(nodes: readonly AnchorPeer[]): Map<string, string> {
  const result = new Map<string, string>();
  const taken = new Set<string>();
  const pending: AnchorPeer[] = [];
  for (const node of nodes) {
    if (!node.anchor) continue;
    const code = normalizeAnchorCode(node.anchor.code || '');
    if (code && code[0] === ANCHOR_CODE_PREFIX[node.anchor.kind] && !taken.has(code)) {
      taken.add(code);
      result.set(node.id, code);
    } else if (node.anchor.approved || node.anchor.code) {
      pending.push(node);
    }
  }
  for (const node of pending) {
    const code = nextCode(ANCHOR_CODE_PREFIX[node.anchor!.kind], taken);
    taken.add(code);
    result.set(node.id, code);
  }
  return result;
}

/**
 * 锚点「批准/取消批准」：生成整体替换 anchor 的 update_node patch，走 applyOps 即进入撤销历史。
 * 批准时若还没有编号，按 peers（画布全部节点）分配同类下一个空号写入 anchor.code。
 * 非锚点节点返回 null；不修改入参。
 */
export function anchorApprovalPatch(
  node: Pick<WorkflowNode, 'anchor'> & { id?: string },
  now: Date = new Date(),
  peers: readonly AnchorPeer[] = [],
): Pick<WorkflowNode, 'anchor'> | null {
  const anchor = node.anchor;
  if (!anchor) return null;
  const next = { ...anchor, approved: !anchor.approved };
  if (next.approved) {
    next.approvedAt = now.toISOString();
    if (!normalizeAnchorCode(next.code || '')) {
      const others = peers.filter(peer => peer.id !== node.id);
      const derived = deriveAnchorCodes(node.id ? [...others, { id: node.id, anchor: next }] : others);
      const taken = new Set(derived.values());
      next.code = (node.id && derived.get(node.id)) || nextCode(ANCHOR_CODE_PREFIX[next.kind], taken);
    }
  } else {
    delete next.approvedAt;
  }
  return { anchor: next };
}
