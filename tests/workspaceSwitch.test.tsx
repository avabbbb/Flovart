import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_LANGUAGE, useWorkspaceStore } from '../stores/useWorkspaceStore';

describe('workspace switching', () => {
  it('starts a fresh workspace in Chinese', () => {
    expect(DEFAULT_WORKSPACE_LANGUAGE).toBe('zho');
  });

  it('drops a persisted top-level agent view on rehydrate', async () => {
    // IA freeze: Agent lives in the global right drawer — a legacy v2 session
    // that persisted activeView='agent' must not let 'agent' into live state.
    localStorage.setItem('flovart-workspace', JSON.stringify({
      state: { activeView: 'agent', canvasView: 'spatial', themeMode: 'dark', language: 'en' },
      version: 2,
    }));
    await useWorkspaceStore.persist.rehydrate();

    const state = useWorkspaceStore.getState() as unknown as Record<string, unknown>;
    expect(state.canvasView).toBe('spatial');
    expect(state.themeMode).toBe('dark');
    expect(state.language).toBe('en');
    expect(Object.values(state)).not.toContain('agent');
  });

  it('keeps Table as a Canvas secondary view', () => {
    useWorkspaceStore.getState().setCanvasView('table');
    expect(useWorkspaceStore.getState().canvasView).toBe('table');

    useWorkspaceStore.getState().setCanvasView('spatial');
    expect(useWorkspaceStore.getState().canvasView).toBe('spatial');
  });
});
