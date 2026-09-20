// Findings + verdict schema for the Product Maturity Eval.
// Every finding flows: prosecutor -> defender -> reproducer -> judge -> fixer.

export const SEVERITY = { P0: 'P0', P1: 'P1', P2: 'P2' };

export const VERDICT = {
  CONFIRMED: 'CONFIRMED',
  NOT_REPRODUCED: 'NOT_REPRODUCED',
  ENVIRONMENT: 'ENVIRONMENT',
  SPEC_AMBIGUITY: 'SPEC_AMBIGUITY',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
};

export const MATURITY = { M0: 'M0', M1: 'M1', M2: 'M2', M3: 'M3', M4: 'M4' };

/**
 * A finding record. `evidence` must cite at least one of:
 * browserTrace | domAssertion | screenshot | timing | codePath | callGraph |
 * testResult | gitEvidence | runtimeState.
 */
export function finding({ id, group, title, severity, scenario, steps, evidence, consequence }) {
  return {
    id, group, title, severity,
    scenario, steps, evidence: Array.isArray(evidence) ? evidence : [evidence],
    consequence,
    status: 'PROSECUTED', // PROSECUTED -> DEFENDED|STANDS -> judged -> CONFIRMED|...
    defense: null, verdict: null, fix: null,
  };
}

export function validateFinding(f) {
  const errs = [];
  if (!f.id) errs.push('missing id');
  if (!f.title) errs.push('missing title');
  if (!['P0', 'P1', 'P2'].includes(f.severity)) errs.push('bad severity');
  if (!f.evidence || !f.evidence.length) errs.push('no evidence');
  return errs;
}
