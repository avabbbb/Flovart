import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CanvasView, ThemeMode } from '../types';

// ── UI Shell Slice ──────────────────────────────────────────────
interface UISlice {
  canvasView: CanvasView;
  setCanvasView: (view: CanvasView) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  language: 'en' | 'zho';
  setLanguage: (lang: 'en' | 'zho') => void;
}

export const DEFAULT_WORKSPACE_LANGUAGE = 'zho' as const;

const createUISlice = (set: any): UISlice => ({
  canvasView: 'spatial',
  setCanvasView: (canvasView) => set({ canvasView }),
  themeMode: (() => {
    try {
      const saved = localStorage.getItem('themeMode.v1');
      return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
    } catch {
      return 'system' as ThemeMode;
    }
  })(),
  setThemeMode: (mode) => set({ themeMode: mode }),
  language: DEFAULT_WORKSPACE_LANGUAGE,
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
      // v3: top-level view switching is gone — Canvas|Table is a canvasView
      // concern and Agent is a global drawer, so legacy persisted activeView
      // values ('agent' from ≤v2, 'table' from v1) are dropped, never kept.
      name: 'flovart-workspace',
      version: 3,
      migrate: (persisted) => {
        const raw: Record<string, unknown> = persisted && typeof persisted === 'object' ? persisted as Record<string, unknown> : {};
        const canvasView: CanvasView = raw.activeView === 'table' || raw.canvasView === 'table' ? 'table' : 'spatial';
        const themeMode: ThemeMode = raw.themeMode === 'light' || raw.themeMode === 'dark' || raw.themeMode === 'system' ? raw.themeMode : 'system';
        const language: 'en' | 'zho' = raw.language === 'en' ? 'en' : 'zho';
        return { canvasView, themeMode, language };
      },
      partialize: (state) => ({
        canvasView: state.canvasView,
        themeMode: state.themeMode,
        language: state.language,
      }),
    },
  ),
);
