import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultAgentLayout, useAgentWorkspaceStore } from '../components/agent/agentWorkspaceStore';

const overlaps = (
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) => left.x < right.x + right.width
  && left.x + left.width > right.x
  && left.y < right.y + right.height
  && left.y + left.height > right.y;

describe('Agent workspace layout', () => {
  beforeEach(() => useAgentWorkspaceStore.setState({ layouts: {} }));

  it('starts with the built-in Flovart Agent as the accountable main conversation', () => {
    const layout = createDefaultAgentLayout();
    expect(layout.panels.map(panel => panel.kind)).toEqual(['brief', 'flovart', 'activity', 'artifacts']);
    expect(layout.panels.find(panel => panel.kind === 'flovart')?.title).toBe('Flovart Agent');
  });

  it('keeps panel geometry isolated per Workflow project', () => {
    const store = useAgentWorkspaceStore.getState();
    store.ensureLayout('one');
    store.ensureLayout('two');
    store.updatePanel('one', 'brief', { x: 888 });

    expect(useAgentWorkspaceStore.getState().layouts.one.panels.find(panel => panel.id === 'brief')?.x).toBe(888);
    expect(useAgentWorkspaceStore.getState().layouts.two.panels.find(panel => panel.id === 'brief')?.x).toBe(0);
  });

  it('replaces the former Codex main panel without removing external task panels', () => {
    useAgentWorkspaceStore.setState({
      layouts: {
        legacy: {
          viewport: { x: 0, y: 0, zoom: 1 },
          panels: [
            { id: 'codex-main', kind: 'codex', title: 'Codex · 制作线程', status: 'idle', x: 10, y: 20, width: 500, height: 600, z: 2 },
            { id: 'codex-task', kind: 'codex', title: 'Codex · 子任务', status: 'idle', x: 40, y: 50, width: 400, height: 500, z: 3 },
          ],
        },
      },
    });

    useAgentWorkspaceStore.getState().ensureLayout('legacy');
    const panels = useAgentWorkspaceStore.getState().layouts.legacy.panels;
    expect(panels.map(panel => [panel.id, panel.kind])).toEqual([
      ['flovart-main', 'flovart'],
      ['codex-task', 'codex'],
    ]);
    expect(panels[0]).toMatchObject({ x: 10, y: 20, width: 500, height: 600 });
  });

  it('places a new Codex subtask outside every existing panel', () => {
    useAgentWorkspaceStore.getState().addCodexPanel('project');
    const panels = useAgentWorkspaceStore.getState().layouts.project.panels;
    const codex = panels.find(panel => panel.kind === 'codex');

    expect(codex).toBeDefined();
    expect(codex).toMatchObject({ x: 0, y: 646 });
    expect(panels.filter(panel => panel.id !== codex?.id).every(panel => !overlaps(codex!, panel))).toBe(true);
  });

  it('keeps consecutive Codex subtasks from overlapping one another', () => {
    const store = useAgentWorkspaceStore.getState();
    store.addCodexPanel('project');
    useAgentWorkspaceStore.getState().addCodexPanel('project');
    const codexPanels = useAgentWorkspaceStore.getState().layouts.project.panels.filter(panel => panel.kind === 'codex');

    expect(codexPanels).toHaveLength(2);
    expect(overlaps(codexPanels[0], codexPanels[1])).toBe(false);
  });
});
