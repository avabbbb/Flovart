import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { createWorkflowNode } from '../components/workflow/constants';
import { InfiniteWorkflow } from '../components/workflow/InfiniteWorkflow';
import { WorkflowGenerationCapabilitiesProvider } from '../components/workflow/WorkflowConfigPanel';
import type { WorkflowProject } from '../components/workflow/types';

const makeProject = (): WorkflowProject => ({
  id: 'project-keys',
  title: 'Keyboard test',
  nodes: [
    createWorkflowNode('far-away', 'image', { x: 5000, y: 5000 }),
    createWorkflowNode('near', 'text', { x: 100, y: 100 }),
  ],
  connections: [],
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, k: 1 },
  backgroundMode: 'dots',
  agentSessions: [],
  activeAgentSessionId: null,
  createdAt: '2026-06-18T00:00:00.000Z',
  updatedAt: '2026-06-18T00:00:00.000Z',
});

function Harness() {
  const [project, setProject] = useState(makeProject);
  return (
    <>
      <WorkflowGenerationCapabilitiesProvider>
        <InfiniteWorkflow
          project={project}
          updateProject={patch => setProject(current => ({ ...current, ...patch }))}
          onRunNode={() => undefined}
          onOpenAgent={() => undefined}
        />
      </WorkflowGenerationCapabilitiesProvider>
      <div role="dialog" aria-label="tool dialog"><button type="button">dialog action</button></div>
      <output data-testid="workflow-project-state" hidden>{JSON.stringify(project)}</output>
    </>
  );
}

const editor = () => screen.getByTestId('workflow-editor');
const state = (): WorkflowProject => JSON.parse(screen.getByTestId('workflow-project-state').textContent || '{}');
const node = (id: string) => state().nodes.find(item => item.id === id);
const historyLength = () => (state().draftChangeSets || []).length;

const selectNode = (id: string) => {
  const el = editor().querySelector<HTMLElement>('[data-workflow-node-id="' + id + '"]');
  if (!el) throw new Error('node not rendered: ' + id);
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 100 });
};

describe('canvas keyboard safety', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { cb(performance.now() + 500); return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('a held arrow key previews every step but records a single undo entry', async () => {
    render(<Harness />);
    selectNode('near');
    await waitFor(() => expect(state().selectedNodeIds).toEqual(['near']));
    const startX = node('near')!.position.x;
    const before = historyLength();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
    fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
    await waitFor(() => expect(node('near')!.position.x).toBeGreaterThan(startX));
    const movedX = node('near')!.position.x;
    expect(historyLength()).toBe(before);

    fireEvent.keyUp(window, { key: 'ArrowRight' });
    await waitFor(() => expect(historyLength()).toBe(before + 1));
    expect(node('near')!.position.x).toBe(movedX);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(node('near')!.position.x).toBe(startX));
  });

  it('Delete pressed inside a dialog never removes canvas nodes', async () => {
    render(<Harness />);
    selectNode('near');
    await waitFor(() => expect(state().selectedNodeIds).toEqual(['near']));
    const button = screen.getByRole('button', { name: 'dialog action' });
    fireEvent.keyDown(button, { key: 'Delete' });
    fireEvent.keyDown(button, { key: 'Backspace' });
    expect(node('near')).toBeTruthy();
  });

  it('Delete on the canvas still removes the selection', async () => {
    render(<Harness />);
    selectNode('near');
    await waitFor(() => expect(state().selectedNodeIds).toEqual(['near']));
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(node('near')).toBeUndefined());
  });

  it('Alt+Shift+F runs auto layout as advertised (macOS Option key value included)', async () => {
    render(<Harness />);
    const before = JSON.stringify(state().nodes.map(item => item.position));
    fireEvent.keyDown(window, { key: '\u00cf', code: 'KeyF', altKey: true, shiftKey: true });
    await waitFor(() => expect(JSON.stringify(state().nodes.map(item => item.position))).not.toBe(before));
  });
});
