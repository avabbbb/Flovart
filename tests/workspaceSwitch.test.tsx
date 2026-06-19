import { describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

describe('workspace switching', () => {
  it('keeps Canvas and Workflow as explicit persisted views', () => {
    useWorkspaceStore.getState().setActiveView('workflow');
    expect(useWorkspaceStore.getState().activeView).toBe('workflow');

    useWorkspaceStore.getState().setActiveView('canvas');
    expect(useWorkspaceStore.getState().activeView).toBe('canvas');
  });
});
