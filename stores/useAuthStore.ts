import { create } from 'zustand';
import { authApi, HubUser, getToken, setToken } from '../services/hubClient';

interface AuthState {
  user: HubUser | null;
  token: string | null;
  loading: boolean;
  initialized: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  init: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: getToken(),
  loading: false,
  initialized: false,

  login: async (identifier, password) => {
    set({ loading: true });
    try {
      const { user, token } = await authApi.login({ identifier, password });
      setToken(token);
      set({ user, token, loading: false, initialized: true });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  register: async (username, email, password) => {
    set({ loading: true });
    try {
      const { user, token } = await authApi.register({ username, email, password });
      setToken(token);
      set({ user, token, loading: false, initialized: true });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  logout: () => {
    setToken(null);
    set({ user: null, token: null });
  },

  init: async () => {
    const token = getToken();
    if (!token) {
      set({ initialized: true });
      return;
    }
    set({ loading: true });
    try {
      const data = await authApi.me();
      const user: HubUser = { id: data.userId, username: data.username, email: data.email, role: data.role as 'user' | 'admin' };
      set({ user, token, loading: false, initialized: true });
    } catch {
      setToken(null);
      set({ user: null, token: null, loading: false, initialized: true });
    }
  },
}));