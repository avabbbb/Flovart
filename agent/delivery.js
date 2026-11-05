// 统一交付契约：Agent 的写入/生成类命令交付的是「可接管的画布工程」，而不只是产物文件。
// 每次成功回包附带 { sessionId, projectId, canvasUrl, nodeIds }，人打开 canvasUrl 即聚焦到相关节点继续编辑。
export const DELIVERY_COMMANDS = new Set([
  'workflow.apply', 'workflow.node.create', 'workflow.node.create-connected', 'workflow.node.update',
  'workflow.node.run', 'workflow.node.tool', 'production.run', 'production.approve',
]);

const MAX_NODE_IDS = 50;
const MAX_FOCUS_IDS = 20;
const SAFE_ID = /^[\w.:-]{1,120}$/;

// 从命令参数或回包里收集节点 id（去重、限长、只收安全字符）。
export function collectNodeIds(payload) {
  const ids = [];
  const push = value => {
    if (typeof value === 'string' && SAFE_ID.test(value) && !ids.includes(value)) ids.push(value);
  };
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const key of ['affectedNodeIds', 'nodeIds', 'createdNodeIds']) {
      if (Array.isArray(value[key])) value[key].forEach(push);
    }
    push(value.nodeId);
    if (Array.isArray(value.runs)) value.runs.forEach(run => { if (run && run.ok !== false) push(run.nodeId); });
  };
  visit(payload);
  if (payload && typeof payload === 'object') visit(payload.result);
  return ids.slice(0, MAX_NODE_IDS);
}

// 画布直达链接：只接受 http(s) 源，hash 路由沿用 #/app，focus 为逗号分隔的节点 id。
export function buildCanvasUrl(webUrl, projectId, nodeIds = []) {
  if (!webUrl || !projectId) return null;
  let url;
  try { url = new URL(String(webUrl)); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const params = new URLSearchParams({ project: String(projectId) });
  if (nodeIds.length) params.set('focus', nodeIds.slice(0, MAX_FOCUS_IDS).join(','));
  return url.origin + '/#/app?' + params.toString();
}

// 失败、待确认或无法定位项目时不生成交付物，避免给出指向错误工程的链接。
export function buildDelivery({ command, response, sessionId, projectId, webUrl } = {}) {
  if (!DELIVERY_COMMANDS.has(command)) return null;
  if (!response || typeof response !== 'object' || response.ok === false) return null;
  if (response.confirmation && response.confirmation.required) return null;
  // 只认带 result 的真实浏览器回包；裸 { ok: true } 没有可定位的工程信息。
  if (!response.result || typeof response.result !== 'object') return null;
  const inner = response.result;
  const resolvedProject = String(inner.projectId || projectId || '').trim();
  if (!resolvedProject) return null;
  const nodeIds = collectNodeIds(response);
  return {
    sessionId: sessionId ? String(sessionId) : null,
    projectId: resolvedProject,
    canvasUrl: buildCanvasUrl(webUrl, resolvedProject, nodeIds),
    nodeIds,
  };
}
