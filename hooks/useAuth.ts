import { useEffect, useState } from 'react';

// 网页版全静态：没有账号服务端。工程、素材与 API Key 只存在本机（localforage / IndexedDB）。
// 保留 useAuth 的形状，调用方（顶栏账号入口、社区发布作者名）无需改动；登录态恒为未登录。
export interface LocalUser {
  id: string;
  username: string;
  email?: string;
  role?: 'user' | 'admin';
}

// 旧版本 Go Hub 写入过的 JWT，一次性清理。
const LEGACY_HUB_TOKEN_KEY = 'flovart.hub.token';

function clearLegacyHubToken(): void {
  try { sessionStorage.removeItem(LEGACY_HUB_TOKEN_KEY); } catch {}
  try { localStorage.removeItem(LEGACY_HUB_TOKEN_KEY); } catch {}
}

export function useAuth() {
  const [authOpen, setAuthOpen] = useState(false);
  const user = null as LocalUser | null;

  useEffect(() => { clearLegacyHubToken(); }, []);

  return {
    user,
    isLoggedIn: !!user,
    authOpen,
    setAuthOpen,
    requireAuth: (action?: () => void) => {
      if (user) action?.();
      else setAuthOpen(true);
    },
  };
}
