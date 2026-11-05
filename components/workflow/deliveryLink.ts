// Agent 交付链接：#/app?project=<projectId>&focus=<nodeId,nodeId>
// 由 agent/delivery.js 的 buildCanvasUrl 生成；只接受安全字符，缺 project 时返回 null（不猜）。
export interface WorkflowDeliveryLink {
  projectId: string;
  focusNodeIds: string[];
}

const SAFE_ID = /^[\w.:-]{1,120}$/;
const MAX_FOCUS_IDS = 20;

function hashParams(hash: string): { route: string; params: URLSearchParams } | null {
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) return null;
  return { route: hash.slice(0, queryIndex), params: new URLSearchParams(hash.slice(queryIndex + 1)) };
}

export function parseWorkflowDeliveryLink(hash: string): WorkflowDeliveryLink | null {
  const parsed = hashParams(hash);
  if (!parsed) return null;
  const projectId = parsed.params.get('project') || '';
  if (!SAFE_ID.test(projectId)) return null;
  const focusNodeIds = (parsed.params.get('focus') || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => SAFE_ID.test(id))
    .slice(0, MAX_FOCUS_IDS);
  return { projectId, focusNodeIds };
}

// 只移除 project / focus，保留 hash 中其他模块的参数。
export function stripWorkflowDeliveryLink(hash: string): string {
  const parsed = hashParams(hash);
  if (!parsed) return hash;
  parsed.params.delete('project');
  parsed.params.delete('focus');
  const rest = parsed.params.toString();
  return rest ? parsed.route + '?' + rest : parsed.route;
}
