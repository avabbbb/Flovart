/**
 * 何时引导用户安装 / 配对 Iris 浏览器插件（网页端）。
 *
 * 触发原因：
 * - configured：用户配置了只能经代理访问的网关（OpenCode 等，见 llmCorsProxy 的 PROXIED_HOSTS）；
 * - proxy：一次请求即将经同源 Worker 代理 /api/llm-proxy 发出；
 * - quota：Worker 代理返回 429（Cloudflare Workers 配额 / 限流）。
 * 只要插件已配对且支持 llm.fetch 就不提示；请求本身始终照常走代理回退，提示不阻塞任何操作。
 */
import type { ExtensionBridgeStatus } from './extensionBridge';
import { toProxiedUrl } from './llmCorsProxy';

export type ExtensionNeedReason = 'configured' | 'proxy' | 'quota';
export type ExtensionPromptAction = 'install' | 'pair' | 'approve' | 'update';

/** 商店上架前为空：构建时用 VITE_IRIS_EXTENSION_CHROME_URL / VITE_IRIS_EXTENSION_EDGE_URL 填真实地址（旧名 VITE_FLOVART_* 作回退）。 */
export const EXTENSION_STORE_URLS = {
  chrome: String(import.meta.env?.VITE_IRIS_EXTENSION_CHROME_URL || import.meta.env?.VITE_FLOVART_EXTENSION_CHROME_URL || ''),
  edge: String(import.meta.env?.VITE_IRIS_EXTENSION_EDGE_URL || import.meta.env?.VITE_FLOVART_EXTENSION_EDGE_URL || ''),
};
/** 商店地址未配置时的安装说明（旁加载步骤）。 */
export const EXTENSION_INSTALL_FALLBACK_URL = 'https://github.com/avabbbb/Iris/blob/main/extension/README.md';

export const PROMPT_DISMISS_KEY = 'iris.extensionPrompt.dismissed';

export function extensionInstallUrl(
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  urls: { chrome: string; edge: string } = EXTENSION_STORE_URLS,
): string {
  const isEdge = /\bEdg\//.test(userAgent);
  const preferred = isEdge ? urls.edge || urls.chrome : urls.chrome || urls.edge;
  return /^https:\/\//.test(preferred) ? preferred : EXTENSION_INSTALL_FALLBACK_URL;
}

/** 该 Base URL 是否只能经代理（或插件直连）访问。 */
export function providerNeedsGatewayProxy(baseUrl: string | undefined | null, pageOrigin: string): boolean {
  if (!baseUrl) return false;
  return toProxiedUrl(baseUrl.trim(), pageOrigin) !== null;
}

export function hasProxiedProvider(keys: ReadonlyArray<{ baseUrl?: string }>, pageOrigin: string): boolean {
  return keys.some(key => providerNeedsGatewayProxy(key.baseUrl, pageOrigin));
}

/** Worker 代理被限流 / 配额耗尽（Cloudflare 每日请求上限返回 429）。 */
export function isProxyQuotaResponse(response: Pick<Response, 'status'> | null | undefined): boolean {
  return response?.status === 429;
}

export interface ExtensionPromptInput {
  reason: ExtensionNeedReason | null;
  status: ExtensionBridgeStatus;
  capable: boolean;
  dismissedForever: boolean;
  dismissedThisSession: boolean;
  isDesktop?: boolean;
}

export interface ExtensionPromptDecision {
  show: boolean;
  action: ExtensionPromptAction | null;
}

const HIDE: ExtensionPromptDecision = { show: false, action: null };

export function decideExtensionPrompt(input: ExtensionPromptInput): ExtensionPromptDecision {
  if (!input.reason || input.isDesktop || input.capable || input.dismissedForever) return HIDE;
  // 本次会话关过就不再弹，除非代理真被限流（用户此时最需要知道原因）。
  if (input.dismissedThisSession && input.reason !== 'quota') return HIDE;
  switch (input.status) {
    // 当前构建没配置插件 ID：装了也连不上，提示无意义。
    case 'unconfigured':
    // 尚未探测完成：等结果，避免把已安装的用户误导去安装。
    case 'idle':
    case 'connecting':
      return HIDE;
    case 'not-installed':
      return { show: true, action: 'install' };
    case 'pending':
      return { show: true, action: 'approve' };
    case 'approved':
    case 'unsupported':
      // 已配对但插件版本不支持直连。
      return { show: true, action: 'update' };
    case 'none':
    case 'rejected':
    case 'revoked':
    case 'disconnected':
      return { show: true, action: 'pair' };
    default:
      return HIDE;
  }
}

const REASON_RANK: Record<ExtensionNeedReason, number> = { configured: 1, proxy: 2, quota: 3 };

export interface ExtensionPromptState {
  reason: ExtensionNeedReason | null;
  dismissedForever: boolean;
  dismissedThisSession: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createExtensionPromptStore(storage: StorageLike | null) {
  const listeners = new Set<() => void>();
  let dismissedForever = false;
  try {
    dismissedForever = storage?.getItem(PROMPT_DISMISS_KEY) === '1';
  } catch {
    // storage unavailable
  }
  let state: ExtensionPromptState = { reason: null, dismissedForever, dismissedThisSession: false };
  const set = (patch: Partial<ExtensionPromptState>) => {
    const next = { ...state, ...patch };
    if (next.reason === state.reason && next.dismissedForever === state.dismissedForever && next.dismissedThisSession === state.dismissedThisSession) return;
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** 记下需要插件的原因；更强的原因覆盖更弱的（quota > proxy > configured）。 */
    note(reason: ExtensionNeedReason) {
      if (state.reason && REASON_RANK[state.reason] >= REASON_RANK[reason]) return;
      set({ reason, dismissedThisSession: reason === 'quota' ? false : state.dismissedThisSession });
    },
    dismiss(forever = false) {
      if (forever) {
        try {
          storage?.setItem(PROMPT_DISMISS_KEY, '1');
        } catch {
          // storage unavailable; still hide for this session
        }
      }
      set({ dismissedThisSession: true, dismissedForever: forever || state.dismissedForever });
    },
  };
}

export type ExtensionPromptStore = ReturnType<typeof createExtensionPromptStore>;

let shared: ExtensionPromptStore | null = null;
export function getExtensionPromptStore(): ExtensionPromptStore {
  if (!shared) {
    let storage: StorageLike | null = null;
    try {
      storage = typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      storage = null;
    }
    shared = createExtensionPromptStore(storage);
  }
  return shared;
}
