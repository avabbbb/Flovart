// Judge-Human agreement and sampling statistics.

/** Cohen's kappa over paired labels (any comparable values). NA pairs are skipped. */
export function cohensKappa(pairs) {
  const usable = pairs.filter(([judge, human]) => judge !== 'NA' && human !== 'NA' && judge !== undefined && human !== undefined);
  const n = usable.length;
  if (!n) return { kappa: null, observed: null, n: 0 };
  const labels = [...new Set(usable.flat().map(String))];
  let agree = 0;
  const judgeCount = new Map();
  const humanCount = new Map();
  for (const [judge, human] of usable) {
    if (String(judge) === String(human)) agree += 1;
    judgeCount.set(String(judge), (judgeCount.get(String(judge)) ?? 0) + 1);
    humanCount.set(String(human), (humanCount.get(String(human)) ?? 0) + 1);
  }
  const observed = agree / n;
  const expected = labels.reduce((sum, label) => sum + ((judgeCount.get(label) ?? 0) / n) * ((humanCount.get(label) ?? 0) / n), 0);
  const kappa = expected === 1 ? 1 : (observed - expected) / (1 - expected);
  return { kappa, observed, expected, n };
}

/** Samples needed so a pass rate near `p` has a ±`margin` confidence interval (default 95%). */
export function sampleSizeForMargin(margin, p = 0.5, z = 1.96) {
  if (!(margin > 0)) throw new Error('margin must be > 0');
  return Math.ceil((z * z * p * (1 - p)) / (margin * margin));
}

/** Wilson score interval for a pass rate. */
export function wilsonInterval(passed, total, z = 1.96) {
  if (!total) return null;
  const p = passed / total;
  const denom = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half), p };
}

/**
 * Compare judge verdicts with human labels at sample and item level.
 * labels: { [sampleId]: { verdict: 0|1|'NA', items?: { [code]: 0|1|'NA' }, rootCause?: string } }
 */
export function judgeHumanAgreement(results, labels) {
  const samplePairs = [];
  const itemPairs = {};
  const disagreements = [];
  for (const result of results) {
    const label = labels[result.id];
    if (!label || !result.aggregate) continue;
    samplePairs.push([result.aggregate.verdict, label.verdict]);
    if (String(result.aggregate.verdict) !== String(label.verdict)) {
      disagreements.push({ id: result.id, judge: result.aggregate.verdict, human: label.verdict, rootCause: label.rootCause ?? null });
    }
    for (const [code, human] of Object.entries(label.items ?? {})) {
      const judge = result.verdicts?.[code]?.verdict;
      (itemPairs[code] ??= []).push([judge, human]);
    }
  }
  const items = Object.fromEntries(Object.entries(itemPairs).map(([code, pairs]) => [code, cohensKappa(pairs)]));
  return { sample: cohensKappa(samplePairs), items, disagreements };
}
