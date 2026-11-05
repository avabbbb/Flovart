// 批量生成自动挑选（P1）：给同一 batchId 的候选节点打分，选出主图，
// 产出 set_batch_primary 文档操作 + decision 回执。纯函数，不触网不读盘。
// 评分优先用调用方给的外部分（如 Agent 用视觉模型打的 0-100 分），没有时退回可解释的启发式。
const FAILED_STATUSES = new Set(['error', 'failed', 'cancelled', 'canceled']);
const MAX_REASONS = 4;

function parseAspect(value) {
  if (typeof value === 'number' && value > 0) return value;
  const match = typeof value === 'string' && value.match(/^(\d+(?:\.\d+)?)\s{0,2}[:x/]\s{0,2}(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const ratio = Number(match[1]) / Number(match[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

function hasMedia(metadata) {
  return Boolean(metadata.href || metadata.storageKey || metadata.artifactRef || metadata.remoteUrl);
}

export function batchCandidates(snapshot, batchId) {
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
  return nodes
    .filter(node => node && node.batchId === batchId)
    .sort((left, right) => (left.batchIndex ?? 0) - (right.batchIndex ?? 0));
}

// 返回按分数降序的排名；失败或无产物的候选 eligible=false，永远排在后面。
export function scoreBatchCandidates(nodes, { scores = {}, aspect } = {}) {
  const targetAspect = parseAspect(aspect);
  return nodes.map(node => {
    const metadata = node.metadata && typeof node.metadata === 'object' ? node.metadata : {};
    const reasons = [];
    const failed = FAILED_STATUSES.has(String(metadata.status || '').toLowerCase()) || Boolean(metadata.error);
    if (failed) return { nodeId: node.id, score: 0, eligible: false, reasons: ['生成失败'] };
    if (!hasMedia(metadata)) return { nodeId: node.id, score: 0, eligible: false, reasons: ['没有产物'] };
    let score = 40;
    reasons.push('有产物 +40');
    const external = Number(scores?.[node.id]);
    if (Number.isFinite(external)) {
      const clamped = Math.max(0, Math.min(100, external));
      score += clamped;
      reasons.push('外部评分 +' + clamped);
    }
    const width = Number(metadata.naturalWidth);
    const height = Number(metadata.naturalHeight);
    if (width > 0 && height > 0) {
      const megapixels = Math.min(2, Math.imul(Math.round(width), Math.round(height)) / 1_000_000);
      const resolutionPoints = Math.round(megapixels / 0.1);
      score += resolutionPoints;
      reasons.push('分辨率 +' + resolutionPoints);
      const wanted = targetAspect || parseAspect(metadata.config?.aspectRatio);
      if (wanted) {
        const drift = Math.abs(Math.log(width / height) - Math.log(wanted));
        const aspectPoints = Math.round(Math.max(0, 1 - drift / 0.35) / 0.05);
        score += aspectPoints;
        reasons.push('画幅贴合 +' + aspectPoints);
      }
    }
    return { nodeId: node.id, score, eligible: true, reasons: reasons.slice(0, MAX_REASONS) };
  }).sort((left, right) => (Number(right.eligible) - Number(left.eligible)) || (right.score - left.score));
}

export function planBatchPick({ snapshot, batchId, scores, aspect } = {}) {
  if (typeof batchId !== 'string' || !batchId) throw new Error('batch pick 需要 batchId。');
  const nodes = batchCandidates(snapshot, batchId);
  if (nodes.length < 2) throw new Error('批次 ' + batchId + ' 少于 2 个候选，无需挑选。');
  const ranking = scoreBatchCandidates(nodes, { scores, aspect });
  const winner = ranking[0];
  if (!winner?.eligible) throw new Error('批次 ' + batchId + ' 没有可用的成功候选。');
  const byId = new Map(nodes.map(node => [node.id, node]));
  const title = byId.get(winner.nodeId)?.title || winner.nodeId;
  const runnerUp = ranking[1];
  const usedExternal = ranking.some(item => item.reasons.some(reason => reason.startsWith('外部评分')));
  const summary = '从 ' + nodes.length + ' 个候选中选出「' + title + '」（' + winner.score + ' 分'
    + (runnerUp ? '，次优 ' + runnerUp.score + ' 分' : '') + '）；依据：' + winner.reasons.join('、')
    + (usedExternal ? '' : '。未提供外部评分，结果仅基于启发式。');
  return {
    batchId,
    projectId: snapshot?.id || null,
    primaryNodeId: winner.nodeId,
    ranking,
    operations: [{ type: 'set_batch_primary', batchId, nodeId: winner.nodeId }],
    receipt: {
      projectId: snapshot?.id || null,
      kind: 'decision',
      title: '批量自动挑选主图：' + String(title).slice(0, 60),
      summary,
      nodeIds: [winner.nodeId, ...ranking.slice(1).map(item => item.nodeId)].slice(0, 20),
      externalRef: 'batch-pick:' + batchId + ':' + winner.nodeId,
    },
  };
}
