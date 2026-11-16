// Auto Rubrics: mine evaluation rules from preference pairs instead of writing
// them all by hand, then keep only rules that discriminate and generalise.
//
//   Layer 1 supply     : mine candidate rules from <chosen, rejected> pairs
//                        (contrast mining + data-pattern hints), sampled several rounds
//   Layer 2 selection  : two-sided violation rates, then stability selection
//                        over K folds so a rule survives only if it keeps working
//   Layer 3 validation : a pair joins the trusted (golden) set only when the
//                        selected rules agree with the human preference in every round
//
// Flovart's natural preference source: when a batch produced alternates and
// the user kept one as the primary take, that take is `chosen` and the
// discarded alternates are `rejected` (same prompt, same inputs).

export const STRONG_RULE = { badMin: 0.7, goodMax: 0.2 };
export const LOW_DISCRIMINATION = 0.2;

export function miningPrompt({ task, statsHint = '', existing = [] }) {
  return [
    '你是创作质量评审专家。给你同一任务下用户最终保留的结果（chosen）和被放弃的结果（rejected）。',
    '归纳「为什么 chosen 更好」的可检查规则：每条规则必须能只看一个结果就判断它是否违反，不能依赖另一个结果。',
    '同时写出 rejected 违反了哪些规则（bad_violation）、chosen 有哪些值得保留的做法（good_violation 的反面）。',
    statsHint ? `数据统计提示（事实锚点，优先依据它）：${statsHint}` : '',
    existing.length ? `已有规则（请补充不同维度，不要重复）：\n${existing.map(rule => `- ${rule}`).join('\n')}` : '',
    `任务：${task}`,
    '只输出 JSON：{"rules": ["<一句话规则>", ...]}，5 到 15 条。',
  ].filter(Boolean).join('\n');
}

/** Cheap lexical dedup before (optional) LLM semantic merge. */
export function dedupeRules(rules) {
  const seen = new Map();
  for (const rule of rules) {
    const key = String(rule).toLowerCase().replace(/[\s，。,.;；:：、"'“”（）()]/g, '');
    if (key && !seen.has(key)) seen.set(key, String(rule).trim());
  }
  return [...seen.values()];
}

/**
 * Two-sided screening. `violations` maps rule -> { good: boolean[], bad: boolean[] }
 * where each boolean says whether that good / bad sample violates the rule.
 */
export function screenRule(rule, { good, bad }) {
  const rate = list => (list.length ? list.filter(Boolean).length / list.length : null);
  const badRate = rate(bad);
  const goodRate = rate(good);
  let type;
  if (badRate === null || goodRate === null) type = 'insufficient';
  else if (goodRate > badRate) type = 'fake';
  else if (badRate - goodRate < LOW_DISCRIMINATION) type = 'low';
  else if (badRate >= STRONG_RULE.badMin && goodRate <= STRONG_RULE.goodMax) type = 'strong';
  else type = 'weak';
  return { rule, badRate, goodRate, type };
}

/** Pair accuracy of a rule set: the pair is right when rejected violates strictly more rules than chosen. */
export function pairAccuracy(ruleSet, pairs) {
  if (!pairs.length) return null;
  let right = 0;
  for (const pair of pairs) {
    const chosen = ruleSet.filter(rule => pair.chosenViolates[rule]).length;
    const rejected = ruleSet.filter(rule => pair.rejectedViolates[rule]).length;
    if (rejected > chosen) right += 1;
  }
  return right / pairs.length;
}

/** Greedy forward selection on a training fold. */
export function greedySelect(candidates, pairs, maxRules = 15) {
  const chosen = [];
  let best = 0;
  while (chosen.length < maxRules) {
    let pick = null;
    for (const rule of candidates) {
      if (chosen.includes(rule)) continue;
      const score = pairAccuracy([...chosen, rule], pairs);
      if (score > best + 1e-9) { best = score; pick = rule; }
    }
    if (!pick) break;
    chosen.push(pick);
  }
  return { rules: chosen, accuracy: best };
}

function folds(items, k) {
  const out = Array.from({ length: k }, () => []);
  items.forEach((item, index) => out[index % k].push(item));
  return out;
}

/**
 * Stability selection: run greedy selection on K training folds, report how
 * often each rule is picked and the train/validation gap. A big gap or no rule
 * above `minFrequency` is the selection-overfitting trap, reported not hidden.
 */
export function stabilitySelect(candidates, pairs, { k = 5, minFrequency = 0.8, maxRules = 15 } = {}) {
  const parts = folds(pairs, Math.min(k, pairs.length || 1));
  const frequency = Object.fromEntries(candidates.map(rule => [rule, 0]));
  const trainScores = [];
  const validScores = [];
  parts.forEach((validation, index) => {
    const training = parts.filter((_, other) => other !== index).flat();
    if (!training.length || !validation.length) return;
    const picked = greedySelect(candidates, training, maxRules);
    picked.rules.forEach(rule => { frequency[rule] += 1; });
    trainScores.push(picked.accuracy);
    validScores.push(pairAccuracy(picked.rules, validation));
  });
  const runs = trainScores.length || 1;
  const share = Object.fromEntries(Object.entries(frequency).map(([rule, count]) => [rule, count / runs]));
  const stable = Object.entries(share).filter(([, value]) => value >= minFrequency).map(([rule]) => rule);
  const mean = list => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null);
  const train = mean(trainScores);
  const validation = mean(validScores);
  return {
    stable,
    frequency: share,
    trainAccuracy: train,
    validationAccuracy: validation,
    overfit: train !== null && validation !== null && train - validation > 0.15,
  };
}

/**
 * Rule memory: active / degraded / removed / recovered across runs.
 * `memory` = { [rule]: { state, misses } }, `passed` = rules that survived this run.
 */
export function updateMemory(memory, passed, { removeAfter = 2 } = {}) {
  const next = {};
  const all = new Set([...Object.keys(memory), ...passed]);
  for (const rule of all) {
    const prev = memory[rule] ?? null;
    const ok = passed.includes(rule);
    if (ok) {
      next[rule] = { state: prev && (prev.state === 'degraded') ? 'recovered' : 'active', misses: 0 };
    } else if (prev) {
      const misses = (prev.misses ?? 0) + 1;
      if (prev.state === 'removed') next[rule] = prev;
      else next[rule] = { state: misses >= removeAfter ? 'removed' : 'degraded', misses };
    }
  }
  return next;
}

/** Layer 3: keep a pair in the golden set only when every round's rule judgement matches the human preference. */
export function trustedPairs(roundsByPair) {
  return Object.entries(roundsByPair)
    .filter(([, rounds]) => rounds.length > 0 && rounds.every(round => round === 'correct'))
    .map(([id]) => id);
}
