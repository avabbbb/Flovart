// Four-layer cleaning: raw trace / run record -> judge-consumable sample.
//   1. format repair     : parse stringified JSON, unify field names
//   2. semantic alignment: keep only the current turn's tool calls (cross-turn isolation)
//   3. noise masking     : redact secrets, drop injected system prompts / huge blobs
//   4. filtering         : drop samples that cannot be judged and say why
// The cleaner reports what it changed so a data-layer root cause is visible.

const SECRET_PATTERNS = [
  /\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"',}]{8,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\b[a-f0-9]{32,}\b/gi,
];

export const MAX_FIELD_CHARS = 6000;

export function redactSecrets(text) {
  let out = String(text);
  let hits = 0;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, () => { hits += 1; return '[REDACTED]'; });
  }
  return { text: out, hits };
}

function tryParse(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!/^[[{]/.test(trimmed)) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

const SYSTEM_PROMPT_HINT = /(you are|你是一名|系统提示词|system prompt)/i;

function maskNoise(value, notes, path = 'inputs') {
  if (typeof value === 'string') {
    const { text, hits } = redactSecrets(value);
    if (hits) notes.push(`${path}: redacted ${hits} secret-like token(s)`);
    if (text.length > MAX_FIELD_CHARS) {
      if (SYSTEM_PROMPT_HINT.test(text.slice(0, 400))) {
        notes.push(`${path}: dropped injected system prompt (${text.length} chars)`);
        return '[SYSTEM PROMPT REMOVED]';
      }
      notes.push(`${path}: truncated ${text.length} -> ${MAX_FIELD_CHARS} chars`);
      return `${text.slice(0, MAX_FIELD_CHARS)}…[TRUNCATED]`;
    }
    return text;
  }
  if (Array.isArray(value)) return value.map((item, index) => maskNoise(item, notes, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/^(api_?key|apiKey|authorization|token|secret)$/i.test(key)) {
        notes.push(`${path}.${key}: removed credential field`);
        continue;
      }
      out[key] = maskNoise(item, notes, `${path}.${key}`);
    }
    return out;
  }
  return value;
}

/**
 * Clean one raw sample. `raw.inputs` holds rubric input fields; `raw.turnId`
 * plus `raw.inputs.tool_calls[*].turnId` drive cross-turn isolation.
 */
export function cleanSample(raw, { requiredInputs = [] } = {}) {
  const notes = [];
  const inputs = {};
  for (const [key, value] of Object.entries(raw.inputs ?? {})) {
    const parsed = tryParse(value);
    if (parsed !== value) notes.push(`inputs.${key}: parsed stringified JSON`);
    inputs[key] = parsed;
  }
  if (Array.isArray(inputs.tool_calls) && raw.turnId !== undefined) {
    const before = inputs.tool_calls.length;
    inputs.tool_calls = inputs.tool_calls.filter(call => call?.turnId === undefined || call.turnId === raw.turnId);
    if (inputs.tool_calls.length !== before) notes.push(`tool_calls: kept ${inputs.tool_calls.length}/${before} for turn ${raw.turnId}`);
  }
  const masked = maskNoise(inputs, notes);
  const missing = requiredInputs.filter(field => masked[field] === undefined || masked[field] === null || masked[field] === '');
  const dropped = missing.length ? `missing required input(s): ${missing.join(', ')}` : null;
  return {
    id: String(raw.id),
    evalTime: raw.evalTime ?? null,
    slice: raw.slice ?? null,
    dataset: raw.dataset ?? 'regular',
    images: Array.isArray(raw.images) ? raw.images : [],
    inputs: masked,
    cleaning: { notes, dropped },
  };
}
