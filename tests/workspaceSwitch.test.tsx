import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_LANGUAGE, useWorkspaceStore } from '../stores/useWorkspaceStore';

describe('workspace switching', () => {
  it('starts a fresh workspace in Chinese', () => {
    expect(DEFAULT_WORKSPACE_LANGUAGE).toBe('zho');
  });

  it('keeps Workflow, Table, and Agent as explicit persisted views', () => {
    useWorkspaceStore.getState().setActiveView('workflow');
    expect(useWorkspaceStore.getState().activeView).toBe('workflow');

    useWorkspaceStore.getState().setActiveView('table');
    expect(useWorkspaceStore.getState().activeView).toBe('table');

    useWorkspaceStore.getState().setActiveView('agent');
    expect(useWorkspaceStore.getState().activeView).toBe('agent');
  });
});
