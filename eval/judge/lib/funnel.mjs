// Funnel aggregation: per-item verdicts -> per-layer verdicts -> sample verdict.
//
// Serial layers (CTX -> SCOPE -> HONEST -> TOOL -> CONTENT) short-circuit: the
// first layer with a 0 is the primary failure, every later serial layer is NA.
// CTX is the only layer that may produce NA; a CTX NA removes the sample from
// the pass-rate denominator (honest skip beats forced scoring). RED is always
// evaluated and is never skipped by the short circuit.

import { LAYERS, SERIAL_LAYERS, STAGES } from './rubric.mjs';

function layerVerdict(values) {
  if (values.length === 0) return 'NA';
  if (values.includes(0)) return 0;
  if (values.every(value => value === 'NA')) return 'NA';
  return 1;
}

export function aggregateSample(rubric, itemVerdicts) {
  const byLayer = Object.fromEntries(LAYERS.map(layer => [layer, []]));
  for (const item of rubric.items) {
    const verdict = itemVerdicts[item.code]?.verdict;
    byLayer[item.layer].push(verdict === undefined ? 'MISSING' : verdict);
  }
  const missing = rubric.items.filter(item => itemVerdicts[item.code] === undefined).map(item => item.code);
  const layers = {};
  let primaryFailure = null;
  let excluded = false;
  for (const layer of SERIAL_LAYERS) {
    if (excluded || primaryFailure) { layers[layer] = 'NA'; continue; }
    const values = byLayer[layer].filter(value => value !== 'MISSING');
    const verdict = layerVerdict(values);
    layers[layer] = verdict;
    if (layer === 'CTX' && byLayer.CTX.includes('NA')) { excluded = true; layers[layer] = 'NA'; continue; }
    if (verdict === 0) primaryFailure = layer;
  }
  layers.RED = layerVerdict(byLayer.RED.filter(value => value !== 'MISSING'));
  const redFailed = layers.RED === 0;
  let verdict;
  if (redFailed) verdict = 0;
  else if (excluded) verdict = 'NA';
  else verdict = primaryFailure ? 0 : 1;
  const failedItems = rubric.items
    .filter(item => itemVerdicts[item.code]?.verdict === 0)
    .filter(item => item.layer === 'RED' || !primaryFailure || item.layer === primaryFailure)
    .map(item => item.code);
  const stages = {};
  for (const stage of STAGES) {
    const values = rubric.items.filter(item => item.stage === stage).map(item => itemVerdicts[item.code]?.verdict).filter(value => value !== undefined);
    stages[stage] = layerVerdict(values);
  }
  return { verdict, layers, stages, primaryFailure: redFailed && !primaryFailure ? 'RED' : primaryFailure, redFailed, excluded, failedItems, missing };
}

/** Pass rate over evaluable samples plus the per-layer funnel. */
export function summarize(results) {
  const evaluable = results.filter(result => result.aggregate && result.aggregate.verdict !== 'NA' && !result.parseError);
  const passed = evaluable.filter(result => result.aggregate.verdict === 1).length;
  const funnel = {};
  for (const layer of LAYERS) {
    const reached = evaluable.filter(result => result.aggregate.layers[layer] !== 'NA');
    funnel[layer] = {
      reached: reached.length,
      passed: reached.filter(result => result.aggregate.layers[layer] === 1).length,
    };
  }
  const primary = {};
  for (const result of evaluable) {
    const key = result.aggregate.primaryFailure;
    if (key) primary[key] = (primary[key] ?? 0) + 1;
  }
  const itemFailures = {};
  for (const result of evaluable) {
    for (const code of result.aggregate.failedItems) itemFailures[code] = (itemFailures[code] ?? 0) + 1;
  }
  // Execution success funnel: each stage's rate is conditional on all earlier stages passing,
  // so route x call x output x reply equals the end-to-end execution success rate.
  const stageFunnel = {};
  let survivors = evaluable.filter(result => !result.aggregate.redFailed);
  const redExcluded = evaluable.length - survivors.length;
  for (const stage of STAGES) {
    const judged = survivors.filter(result => result.aggregate.stages?.[stage] !== undefined && result.aggregate.stages[stage] !== 'NA');
    if (!judged.length) { stageFunnel[stage] = null; continue; }
    const passed = survivors.filter(result => result.aggregate.stages?.[stage] !== 0);
    stageFunnel[stage] = { reached: survivors.length, passed: passed.length, rate: survivors.length ? passed.length / survivors.length : null };
    survivors = passed;
  }
  const staged = Object.values(stageFunnel).some(Boolean);
  const executionSuccess = staged && evaluable.length ? survivors.length / evaluable.length : null;
  return {
    total: results.length,
    stageFunnel: staged ? stageFunnel : null,
    executionSuccess,
    redExcludedFromStages: staged ? redExcluded : null,
    excluded: results.filter(result => result.aggregate?.verdict === 'NA').length,
    parseErrors: results.filter(result => result.parseError).length,
    evaluable: evaluable.length,
    passed,
    passRate: evaluable.length ? passed / evaluable.length : null,
    redFailures: evaluable.filter(result => result.aggregate.redFailed).length,
    funnel,
    primaryFailure: primary,
    itemFailures,
  };
}
