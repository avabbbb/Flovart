// Parses API keys a user brings from a file (.env / .txt) or the clipboard.
// Runs only in the browser Settings import; the text never leaves the page
// except as the UserApiKey the existing add flow stores.

export interface ParsedKeyEntry {
  /** Variable name when the line was NAME=value, otherwise null. */
  name: string | null;
  key: string;
  /** Provider id resolved from the variable name or the key prefix; null when unknown. */
  provider: string | null;
}

// Common variable names -> Flovart provider ids (aiGateway AIProvider).
const ENV_NAME_PROVIDERS: Array<[RegExp, string]> = [
  [/^OPENAI_API_KEY$/i, 'openai'],
  [/^(GEMINI|GOOGLE|GOOGLE_AI|GOOGLE_GENAI)_API_KEY$/i, 'google'],
  [/^ANTHROPIC_API_KEY$/i, 'anthropic'],
  [/^(ARK|VOLC|VOLCENGINE|VOLCENGINE_ARK|SEEDANCE)_API_KEY$/i, 'volcengine'],
  [/^(RUNNINGHUB|RUNNING_HUB|RH)_API_KEY$/i, 'runningHub'],
];

const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const MAX_KEY_LENGTH = 8192;

function unquote(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const close = trimmed.indexOf(quote, 1);
    return close > 0 ? trimmed.slice(1, close) : trimmed.slice(1);
  }
  return trimmed.replace(/\s+#.*$/, '');
}

export function providerFromEnvName(name: string): string | null {
  return ENV_NAME_PROVIDERS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

/**
 * Accepts NAME=value lines (# comments, optional `export`, quotes) and/or bare
 * one-line keys. Assignments whose name is not key-like (no KEY/TOKEN/SECRET)
 * are ignored so a pasted .env with BASE_URL etc. does not become keys.
 */
export function parseApiKeyText(
  text: string,
  inferFromKey: (key: string) => string | null = () => null,
): ParsedKeyEntry[] {
  const entries: ParsedKeyEntry[] = [];
  const seen = new Set<string>();
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const assignment = ASSIGNMENT.exec(line);
    let name: string | null = null;
    let key: string;
    if (assignment) {
      name = assignment[1];
      if (!/(KEY|TOKEN|SECRET)/i.test(name)) continue;
      key = unquote(assignment[2]);
    } else {
      if (/\s/.test(line)) continue;
      key = line;
    }
    if (!key || key.length > MAX_KEY_LENGTH || seen.has(key)) continue;
    seen.add(key);
    entries.push({ name, key, provider: (name && providerFromEnvName(name)) || inferFromKey(key) });
  }
  return entries;
}
