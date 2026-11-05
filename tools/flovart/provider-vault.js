import { readLocalAgentConnection } from './local-agent.js';

// Read-only, masked view of the Agent-side keyring vault. Keys are entered in
// browser Settings only; the CLI never reads or writes secrets.

// User-facing next steps for a missing provider. Keys are only ever entered in
// browser Settings (typed, imported from a .env/.txt file, or pasted from the
// clipboard); agents never handle the secret.
const VERIFY = '添加后运行 flovart provider.status --json 确认。';
const ENTRY = '可以手动填写，也可以点「导入」选择写有 Key 的 .env/.txt 文件，或点「从剪贴板粘贴」。';
export const PROVIDER_GUIDANCE = Object.freeze({
  image: `在 Flovart 设置里添加图片 Provider（OpenAI、Gemini 等）的 Key。${ENTRY}${VERIFY}`,
  video: `在 Flovart 设置里添加火山方舟（Seedance）或 RunningHub 的 Key。${ENTRY}${VERIFY}`,
  text: `在 Flovart 设置里添加文本 Provider（Gemini、OpenAI 等）的 Key。${ENTRY}${VERIFY}`,
  seedanceModel: '在 Flovart 设置里把视频模型选为 Seedance 2.0（flovart:seedance-2）。',
});

// Providers that can serve Seedance 2.0 video (aiGateway: volcengine Ark, RunningHub).
export const SEEDANCE_PROVIDER_IDS = Object.freeze(['volcengine', 'runningHub']);

export class ProviderVaultError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }

  toJSON() {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

async function callAgent(path, options = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs = 1500 } = options;
  const connection = options.connection || readLocalAgentConnection({ env: options.env });
  if (!connection) throw new ProviderVaultError('AGENT_UNAVAILABLE', 'Flovart Agent 未运行，先运行 flovart ensure。', true);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(new URL(path, connection.url), {
      signal: controller.signal,
      headers: { 'x-flovart-agent-token': connection.token },
    });
  } catch (cause) {
    const message = controller.signal.aborted
      ? '请求本机 Flovart Agent 超时。'
      : `无法连接本机 Flovart Agent：${cause instanceof Error ? cause.message : String(cause)}`;
    throw new ProviderVaultError('AGENT_UNAVAILABLE', message, true);
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new ProviderVaultError('AGENT_AUTH_FAILED', 'Flovart Agent 连接 Token 无效。');
  if (!response.ok || payload?.ok === false) {
    const error = payload?.error && typeof payload.error === 'object' ? payload.error : { message: payload?.error };
    throw new ProviderVaultError(
      error.code || 'AGENT_REQUEST_FAILED',
      error.message || `Flovart Agent 返回 HTTP ${response.status}`,
      Boolean(error.retryable),
    );
  }
  return payload;
}

const toPublic = entry => ({
  provider: String(entry?.provider || ''),
  keyId: String(entry?.keyId || ''),
  label: entry?.label ?? null,
  mask: entry?.mask ?? null,
  updatedAt: entry?.updatedAt ?? null,
});

/**
 * Masked provider readiness from the Agent vault. The vault knows which
 * providers hold a key; it does not know which purpose (image/video/text)
 * each provider serves, so readiness is per provider, not per purpose.
 */
export async function readVaultProviderStatus(options = {}) {
  const payload = await callAgent('/credentials', options);
  const credentials = (Array.isArray(payload.credentials) ? payload.credentials : []).map(toPublic);
  const keyringAvailable = payload.keyring?.available !== false;
  return {
    ok: true,
    source: 'agent-vault',
    // One-way mirror of browser Settings (useApiKeys -> syncRuntimeCredentials).
    // Route mappings stay in the browser; a provider here may still lack a model route.
    mirrorOf: 'browser-settings',
    ready: keyringAvailable && credentials.length > 0,
    keyring: { available: keyringAvailable, error: payload.keyring?.error ?? null },
    count: credentials.length,
    providers: [...new Set(credentials.map(entry => entry.provider))],
    credentials,
    lastSync: payload.lastSync ?? null,
  };
}
