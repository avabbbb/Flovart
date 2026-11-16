// Pairwise preference judging with position swap.
//
// Every pair is judged twice, A/B and B/A. Only an order-independent answer
// counts; a flip is recorded as position-biased and scored as a tie. The swap
// consistency rate is reported because it measures the judge, not the agent.

export function pairwisePrompt(criteria, swapLabel) {
  return [
    '你是 Flovart 的对比评测员。下面给出同一个创作任务的两个候选结果 X 和 Y。',
    '只依据用户消息中的任务、约束和两个候选的内容判断，不引入外部知识；不因候选更长、出现顺序更靠前或描述更自信而偏好它。',
    '先逐条对照评判依据，各摘录一处证据，再给结论。',
    '',
    '## 评判依据',
    ...criteria.map((rule, index) => `${index + 1}. ${rule}`),
    '',
    '## 输出',
    '只输出 JSON：{"evidence": {"X": "<摘录>", "Y": "<摘录>"}, "winner": "X" | "Y" | "tie", "reason": "<一句话>"}',
    swapLabel ? `（内部标记：${swapLabel}）` : '',
  ].join('\n');
}

function renderPair(task, first, second) {
  return [`### 任务\n${task}`, `### 候选 X\n${first}`, `### 候选 Y\n${second}`].join('\n\n');
}

function readWinner(text) {
  try {
    const start = text.indexOf('{');
    const json = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
    return ['X', 'Y', 'tie'].includes(json.winner) ? json.winner : null;
  } catch {
    return null;
  }
}

/** Returns 'A' | 'B' | 'tie' | 'biased' | 'error'. */
export async function judgePair({ id, task, a, b, criteria, images = [] }, provider) {
  const forward = await provider.complete({ key: `${id}#ab`, system: pairwisePrompt(criteria), user: renderPair(task, a, b), images });
  const backward = await provider.complete({ key: `${id}#ba`, system: pairwisePrompt(criteria), user: renderPair(task, b, a), images });
  const w1 = readWinner(forward.text);
  const w2 = readWinner(backward.text);
  if (!w1 || !w2) return { id, outcome: 'error', forward: w1, backward: w2 };
  const first = w1 === 'X' ? 'A' : w1 === 'Y' ? 'B' : 'tie';
  const second = w2 === 'X' ? 'B' : w2 === 'Y' ? 'A' : 'tie';
  if (first === second) return { id, outcome: first, forward: w1, backward: w2, consistent: true };
  return { id, outcome: 'biased', forward: w1, backward: w2, consistent: false };
}

export function summarizePairs(results, truth = {}) {
  const judged = results.filter(result => result.outcome !== 'error');
  const consistent = judged.filter(result => result.consistent);
  const withTruth = consistent.filter(result => truth[result.id]);
  const correct = withTruth.filter(result => result.outcome === truth[result.id]);
  return {
    pairs: results.length,
    errors: results.length - judged.length,
    swapConsistency: judged.length ? consistent.length / judged.length : null,
    accuracyOnConsistent: withTruth.length ? correct.length / withTruth.length : null,
    labelled: withTruth.length,
  };
}
