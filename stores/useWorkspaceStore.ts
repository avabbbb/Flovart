import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ThemeMode } from '../types';

// ── UI Shell Slice ──────────────────────────────────────────────
interface UISlice {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  language: 'en' | 'zho';
  setLanguage: (lang: 'en' | 'zho') => void;
}

const createUISlice = (set: any): UISlice => ({
  themeMode: (() => {
    try {
      const saved = localStorage.getItem('themeMode.v1');
      return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
    } catch {
      return 'system' as ThemeMode;
    }
  })(),
  setThemeMode: (mode) => set({ themeMode: mode }),
  language: 'en' as const,
  setLanguage: (lang) => set({ language: lang }),
});

// ── Combined Store ──────────────────────────────────────────────
type WorkspaceStore = UISlice;

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (...a) => ({
      ...createUISlice(a[0]),
    }),
    {
      name: 'flovart-workspace',
      partialize: (state) => ({
        themeMode: state.themeMode,
        language: state.language,
      }),
    },
  ),
);
