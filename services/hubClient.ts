// Flovart Hub 后端 API 客户端
// 所有 backend/* 服务的统一入口：auth、prompts、uploads、enterprise

const DEFAULT_HUB_BASE = 'http://localhost:8080/api/v1';
const DEFAULT_ENTERPRISE_BASE = 'http://localhost:8081/api/v1/enterprise';

function readEnvBase(key: string, fallback: string): string {
  // 仅在 web 环境可用；Tauri 也会注入 import.meta.env
  try {
    const v = (import.meta as { env?: Record<string, string | undefined> }).env?.[key];
    if (v && typeof v === 'string') return v.replace(/\/+$/, '');
  } catch {}
  return fallback;
}

export const HUB_BASE_URL = readEnvBase('VITE_HUB_BASE_URL', DEFAULT_HUB_BASE);
export const ENTERPRISE_BASE_URL = readEnvBase('VITE_ENTERPRISE_BASE_URL', DEFAULT_ENTERPRISE_BASE);

// JWT 在 localStorage 里（参考 useApiKeys 的 localStorage 用法）
const TOKEN_KEY = 'flovart.hub.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export interface ApiResponse<T> {
  code: number;
  data: T;
  msg: string;
}

export class ApiError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  base: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('http') ? path : `${base}${path}`;
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(authHeaders())) headers.set(k, v);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let payload: ApiResponse<T> | null = null;
  try {
    payload = text ? (JSON.parse(text) as ApiResponse<T>) : null;
  } catch {
    throw new ApiError(res.status, `响应解析失败 (${res.status})`);
  }
  if (!res.ok || !payload || payload.code !== 0) {
    const msg = payload?.msg || `请求失败 (${res.status})`;
    throw new ApiError(payload?.code ?? res.status, msg);
  }
  return payload.data;
}

export const api = {
  get: <T>(base: string, path: string) => request<T>(base, path, { method: 'GET' }),
  post: <T>(base: string, path: string, body?: unknown) =>
    request<T>(base, path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(base: string, path: string, body?: unknown) =>
    request<T>(base, path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(base: string, path: string) => request<T>(base, path, { method: 'DELETE' }),
};

// ===== Auth =====
export interface HubUser {
  id: string;
  username: string;
  email: string;
  bio?: string;
  avatarUrl?: string;
  role: 'user' | 'admin';
}

export const authApi = {
  register: (body: { username: string; email: string; password: string }) =>
    api.post<{ user: HubUser; token: string }>(HUB_BASE_URL, '/auth/register', body),
  login: (body: { identifier: string; password: string }) =>
    api.post<{ user: HubUser; token: string }>(HUB_BASE_URL, '/auth/login', body),
  me: () => api.get<{ userId: string; username: string; email: string; role: string }>(HUB_BASE_URL, '/auth/me'),
};