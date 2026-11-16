// Judge output parsing: the three-layer defence after the prompt constraint.
//   1. extract a JSON object even when the model wraps it in prose or fences
//   2. validate every rubric item is present with an allowed verdict
//   3. normalise legacy / loose verdict spellings, refuse anything else
// An output that cannot be validated is a parse error, never a guessed verdict.

const NORMALISE = new Map([
  ['1', 1], ['pass', 1], ['通过', 1], ['true', 1], ['yes', 1],
  ['0', 0], ['fail', 0], ['不通过', 0], ['false', 0], ['no', 0],
  ['na', 'NA'], ['n/a', 'NA'], ['剔除', 'NA'], ['不可评', 'NA'], ['null', 'NA'],
]);

export function normaliseVerdict(value) {
  if (value === 1 || value === 0) return value;
  if (value === 'NA') return 'NA';
  if (value === true) return 1;
  if (value === false) return 0;
  if (value === null) return 'NA';
  const key = String(value ?? '').trim().toLowerCase();
  return NORMALISE.has(key) ? NORMALISE.get(key) : undefined;
}

export function extractJson(text) {
  if (text && typeof text === 'object') return text;
  const raw = String(text ?? '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in judge output');
  return JSON.parse(candidate.slice(start, end + 1));
}

export function parseJudgeOutput(rubric, text) {
  let json;
  try {
    json = extractJson(text);
  } catch (error) {
    return { ok: false, error: `unparseable: ${error.message}` };
  }
  const items = json?.items;
  if (!items || typeof items !== 'object') return { ok: false, error: 'missing items object' };
  const verdicts = {};
  const problems = [];
  for (const item of rubric.items) {
    const entry = items[item.code];
    if (!entry) { problems.push(`${item.code}: missing`); continue; }
    const verdict = normaliseVerdict(entry.verdict);
    if (verdict === undefined) { problems.push(`${item.code}: non-standard verdict ${JSON.stringify(entry.verdict)}`); continue; }
    if (verdict === 'NA' && item.layer !== 'CTX') {
      // NA outside CTX is a forced guess avoided by the judge; treat as a validation failure, not a pass.
      problems.push(`${item.code}: NA is only allowed on CTX items`);
      continue;
    }
    if (verdict === 1 && (entry.evidence === null || entry.evidence === undefined || String(entry.evidence).trim() === '')) {
      problems.push(`${item.code}: pass without quoted evidence`);
      continue;
    }
    verdicts[item.code] = { verdict, evidence: entry.evidence ?? null, reason: String(entry.reason ?? '') };
  }
  const unknown = Object.keys(items).filter(code => !rubric.items.some(item => item.code === code));
  if (problems.length) return { ok: false, error: problems.join('; '), partial: verdicts, unknown };
  return { ok: true, verdicts, unknown };
}
