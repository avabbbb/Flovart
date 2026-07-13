import { describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

describe('workspace switching', () => {
  it('keeps Workflow and Art as explicit persisted views', () => {
    useWorkspaceStore.getState().setActiveView('workflow');
    expect(useWorkspaceStore.getState().activeView).toBe('workflow');

    useWorkspaceStore.getState().setActiveView('art');
    expect(useWorkspaceStore.getState().activeView).toBe('art');
  });
});
