// Three-stage release governance for prompt / skill / model / rubric changes.
//   admission : offline regression on the same samples; rule layer 100%, no Judge regression
//   gray      : shadow comparison on live traffic or alternates; pause on sustained regression
//   monitor   : drift beyond the confidence interval triggers attribution, not a prompt tweak

import { wilsonInterval } from './agreement.mjs';

export const ADMISSION = {
  redFailuresAllowed: 0,
  maxPassRateDrop: 0.02,
  minJudgeKappa: 0.6,
  minSwapConsistency: 0.8,
};

/** Admission: candidate vs baseline summaries (from summarize()) plus judge health. */
export function admissionGate({ baseline, candidate, deterministic, judgeHealth = {} }) {
  const reasons = [];
  if (deterministic && deterministic.passRate !== 1) reasons.push(`rule layer (FlovartBench) pass rate ${deterministic.passRate} must be 1`);
  if (candidate.redFailures > ADMISSION.redFailuresAllowed) reasons.push(`RED failures ${candidate.redFailures}`);
  if (baseline?.passRate !== null && baseline?.passRate !== undefined && candidate.passRate !== null) {
    const drop = baseline.passRate - candidate.passRate;
    if (drop > ADMISSION.maxPassRateDrop) reasons.push(`judge pass rate dropped ${(drop * 100).toFixed(1)}pp`);
  }
  if (judgeHealth.kappa !== undefined && judgeHealth.kappa !== null && judgeHealth.kappa < ADMISSION.minJudgeKappa) {
    reasons.push(`judge-human kappa ${judgeHealth.kappa.toFixed(2)} < ${ADMISSION.minJudgeKappa}`);
  }
  if (judgeHealth.swapConsistency !== undefined && judgeHealth.swapConsistency !== null && judgeHealth.swapConsistency < ADMISSION.minSwapConsistency) {
    reasons.push(`swap consistency ${judgeHealth.swapConsistency.toFixed(2)} < ${ADMISSION.minSwapConsistency}`);
  }
  if (candidate.parseErrors > 0) reasons.push(`${candidate.parseErrors} unparseable judge output(s)`);
  return { stage: 'admission', pass: reasons.length === 0, reasons };
}

/**
 * Gray: daily buckets of { day, control: {passed,total}, treatment: {passed,total} }.
 * Pause when treatment is below control for `pauseDays` consecutive days.
 */
export function grayGate(days, { pauseDays = 2 } = {}) {
  let streak = 0;
  for (const day of days) {
    const control = day.control.total ? day.control.passed / day.control.total : null;
    const treatment = day.treatment.total ? day.treatment.passed / day.treatment.total : null;
    if (control !== null && treatment !== null && treatment < control) streak += 1;
    else streak = 0;
    if (streak >= pauseDays) return { stage: 'gray', pass: false, reasons: [`treatment below control ${streak} days in a row (through ${day.day})`] };
  }
  return { stage: 'gray', pass: true, reasons: [] };
}

/** Monitor: a drop outside the baseline's Wilson interval is drift worth attributing. */
export function driftCheck(baseline, current) {
  const band = wilsonInterval(baseline.passed, baseline.total);
  const rate = current.total ? current.passed / current.total : null;
  if (!band || rate === null) return { stage: 'monitor', drift: false, reasons: ['not enough data'] };
  const drift = rate < band.low || rate > band.high;
  return {
    stage: 'monitor',
    drift,
    band,
    rate,
    reasons: drift ? [`pass rate ${(rate * 100).toFixed(1)}% outside baseline band ${(band.low * 100).toFixed(1)}–${(band.high * 100).toFixed(1)}%`] : [],
  };
}
