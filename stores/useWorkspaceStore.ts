import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CanvasView, ThemeMode, WorkspaceView } from '../types';

// ── UI Shell Slice ──────────────────────────────────────────────
interface UISlice {
  activeView: WorkspaceView;
  setActiveView: (view: WorkspaceView) => void;
  canvasView: CanvasView;
  setCanvasView: (view: CanvasView) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  language: 'en' | 'zho';
  setLanguage: (lang: 'en' | 'zho') => void;
}

export const DEFAULT_WORKSPACE_LANGUAGE = 'zho' as const;

const createUISlice = (set: any): UISlice => ({
  activeView: 'workflow',
  setActiveView: (activeView) => set({ activeView }),
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
      name: 'flovart-workspace',
      version: 2,
      migrate: (persisted) => {
        // v1 persisted 'table' as a top-level view; Table 现在是 Canvas 二级视图。
        const raw: Record<string, unknown> = persisted && typeof persisted === 'object' ? persisted as Record<string, unknown> : {};
        const activeView: WorkspaceView = raw.activeView === 'agent' ? 'agent' : 'workflow';
        const canvasView: CanvasView = raw.activeView === 'table' || raw.canvasView === 'table' ? 'table' : raw.canvasView === 'agent' ? 'agent' : 'spatial';
        const themeMode: ThemeMode = raw.themeMode === 'light' || raw.themeMode === 'dark' || raw.themeMode === 'system' ? raw.themeMode : 'system';
        const language: 'en' | 'zho' = raw.language === 'en' ? 'en' : 'zho';
        return { activeView, canvasView, themeMode, language };
      },
      partialize: (state) => ({
        activeView: state.activeView,
        canvasView: state.canvasView,
        themeMode: state.themeMode,
        language: state.language,
      }),
    },
  ),
);
