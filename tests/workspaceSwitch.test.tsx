import { describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

describe('workspace switching', () => {
  it('keeps Workflow, Table, and Agent as explicit persisted views', () => {
    useWorkspaceStore.getState().setActiveView('workflow');
    expect(useWorkspaceStore.getState().activeView).toBe('workflow');

    useWorkspaceStore.getState().setActiveView('table');
    expect(useWorkspaceStore.getState().activeView).toBe('table');

    useWorkspaceStore.getState().setActiveView('agent');
    expect(useWorkspaceStore.getState().activeView).toBe('agent');
  });
});
