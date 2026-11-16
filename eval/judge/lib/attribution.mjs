// Four-step quality attribution: diagnose -> locate -> route -> verify.
//
// Every questionable case gets exactly one root-cause layer before anyone
// edits a prompt: data, prompt, rubric, or the agent itself. Agent quality is
// what remains after the other three are excluded.

export const ROOT_CAUSES = {
  data: { fix: '修清洗或字段映射（eval/judge/lib/clean.mjs、采集脚本）', scope: '该来源的同类样本' },
  prompt: { fix: '补 Rubric 正文里的判定说明或 fewShot 边界示例（Judge Prompt 由 Rubric 生成）', scope: '该 Rubric 的同类样本' },
  rubric: { fix: '改 Rubric 条目本身，升版本并写 changelog', scope: '该 Rubric 的全部样本，需重跑对比' },
  agent: { fix: '回到产品：Skill / Agent 提示词 / 工具实现 / 模型路由', scope: '对应能力' },
};

/** Signal → root cause → optimisation channel routing table (step 3). */
export const ROUTING = [
  { signal: 'parseErrors 占比高', cause: 'prompt', channel: '收紧输出 schema 与示例；不要先改 Agent' },
  { signal: '清洗 notes 里有截断 / 系统提示词 / 跨轮丢弃，且失败集中在这些样本', cause: 'data', channel: '修采集与清洗，再重跑' },
  { signal: '某子项 Judge-Human kappa 低，其他子项正常', cause: 'prompt', channel: '给该子项补判定边界与 fewShot' },
  { signal: '人工认为产品行为正确，但条目会判 0（如诚实兜底）', cause: 'rubric', channel: '改条目，升版本' },
  { signal: 'pass@1 高但 pass^k 低 / 多轮不稳定', cause: 'agent', channel: '加约束、固定参数或改 Skill，属稳定性问题' },
  { signal: 'Pairwise 训练集准确率高、验证集低', cause: 'rubric', channel: '重新筛 Rubric、扩充偏好对' },
  { signal: '离线通过率高但用户选择 / 采纳率低', cause: 'rubric', channel: '评估器没对齐真实偏好，用偏好对重校准' },
];

/**
 * Step 1 + 2: diagnose and locate. `labels` carry the human root cause for a
 * disagreement; cleaning notes and parse errors are mechanical evidence.
 */
export function attribute(results, { labels = {}, samples = {} } = {}) {
  const buckets = { data: [], prompt: [], rubric: [], agent: [], unassigned: [] };
  for (const result of results) {
    const label = labels[result.id];
    const sample = samples[result.id];
    if (result.parseError) { buckets.prompt.push({ id: result.id, why: `parse: ${result.parseError}` }); continue; }
    if (!result.aggregate) continue;
    const failed = result.aggregate.verdict === 0;
    const disagree = label && String(label.verdict) !== String(result.aggregate.verdict);
    if (!failed && !disagree) continue;
    if (label?.rootCause && buckets[label.rootCause]) {
      buckets[label.rootCause].push({ id: result.id, why: label.note ?? 'human-assigned' });
      continue;
    }
    if (sample?.cleaning?.notes?.some(note => /truncated|dropped|kept \d+\/\d+/.test(note))) {
      buckets.data.push({ id: result.id, why: 'cleaning altered the evidence; verify the data layer first' });
      continue;
    }
    if (failed && !disagree && label) {
      buckets.agent.push({ id: result.id, why: `human confirms failure at ${result.aggregate.primaryFailure}` });
      continue;
    }
    buckets.unassigned.push({ id: result.id, why: failed ? `judge failed at ${result.aggregate.primaryFailure}; needs a human root cause` : 'disagreement without root cause' });
  }
  return buckets;
}
