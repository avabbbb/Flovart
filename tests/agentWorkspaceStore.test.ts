import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultAgentLayout, useAgentWorkspaceStore } from '../components/agent/agentWorkspaceStore';

describe('Agent workspace layout', () => {
  beforeEach(() => useAgentWorkspaceStore.setState({ layouts: {} }));

  it('starts with Codex, brief, activity, and artifacts as spatial panels', () => {
    const layout = createDefaultAgentLayout();
    expect(layout.panels.map(panel => panel.kind)).toEqual(['brief', 'codex', 'activity', 'artifacts']);
  });

  it('keeps panel geometry isolated per Workflow project', () => {
    const store = useAgentWorkspaceStore.getState();
    store.ensureLayout('one');
    store.ensureLayout('two');
    store.updatePanel('one', 'brief', { x: 888 });

    expect(useAgentWorkspaceStore.getState().layouts.one.panels.find(panel => panel.id === 'brief')?.x).toBe(888);
    expect(useAgentWorkspaceStore.getState().layouts.two.panels.find(panel => panel.id === 'brief')?.x).toBe(0);
  });
});
