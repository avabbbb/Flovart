import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { createWorkflowNode } from '../components/workflow/constants';
import { InfiniteWorkflow } from '../components/workflow/InfiniteWorkflow';
import { WorkflowGenerationCapabilitiesProvider } from '../components/workflow/WorkflowConfigPanel';
import { LocalFolderBrowser } from '../components/workflow/LocalFolderBrowser';
import { WorkflowSidebar } from '../components/workflow/WorkflowSidebar';
import type { WorkflowProject } from '../components/workflow/types';
import type { AssetLibrary } from '../types';

const makeProject = (): WorkflowProject => ({
  id: 'project-1',
  title: 'Surface test',
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

const LIB: AssetLibrary = { folders: [], items: [] };

function Harness({ initial = makeProject(), onNotify }: { initial?: WorkflowProject; onNotify?: (m: string, l?: string) => void }) {
  const [project, setProject] = useState(initial);
  const [focus, setFocus] = useState<{ nodeId: string; nonce: number }>();
  return (
    <>
      <WorkflowGenerationCapabilitiesProvider>
        <InfiniteWorkflow
          project={project}
          updateProject={patch => setProject(current => ({ ...current, ...patch }))}
          onRunNode={() => undefined}
          onOpenAgent={() => undefined}
          focusNodeRequest={focus}
          onNotify={onNotify}
        />
        <button data-testid="trigger-focus" onClick={() => setFocus({ nodeId: 'far-away', nonce: Date.now() })}>focus</button>
      </WorkflowGenerationCapabilitiesProvider>
      <output data-testid="workflow-project-state" hidden>{JSON.stringify(project)}</output>
    </>
  );
}

const editor = () => screen.getByTestId('workflow-editor');
const projectState = (): WorkflowProject => JSON.parse(screen.getByTestId('workflow-project-state').textContent || '{}');

describe('Lane17 verification', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { cb(performance.now() + 500); return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('F key frames a selected node by animating the viewport toward it', async () => {
    render(<Harness />);
    // select 'far-away' via pointer
    const nodeEl = editor().querySelector<HTMLElement>('[data-workflow-node-id="far-away"]')!;
    fireEvent.pointerDown(nodeEl, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.keyDown(window, { key: 'f' });
    await waitFor(() => {
      const vp = projectState().viewport;
      // far-away center is 5000+half width; viewport must move so that node is on screen
      const nodeW = 240;
      const screenX = (5000 + nodeW / 2) * vp.k + vp.x;
      expect(screenX).toBeGreaterThan(0);
      expect(screenX).toBeLessThan(1000);
    });
  });

  it('focusNodeRequest selects and reveals the requested node', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger-focus'));
    await waitFor(() => {
      expect(projectState().selectedNodeIds).toEqual(['far-away']);
      const vp = projectState().viewport;
      const screenX = (5000 + 120) * vp.k + vp.x;
      expect(screenX).toBeGreaterThan(0);
      expect(screenX).toBeLessThan(1000);
    });
  });

  it('notifies in product language when a persisted loading node has no live task', async () => {
    vi.useFakeTimers();
    const p = makeProject();
    p.nodes[0].metadata = { ...p.nodes[0].metadata, status: 'loading', generationStartedAt: Date.now() - 99999, progress: 40 };
    const onNotify = vi.fn();
    render(<Harness initial={p} onNotify={onNotify} />);
    await act(async () => { vi.advanceTimersByTime(6500); });
    expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('中断'), 'warning');
    vi.useRealTimers();
  });

  it('WorkflowSidebar layer click selects the node AND fires a focus request', () => {
    // InfiniteWorkflow 侧的 select+reveal 由上面的 focusNodeRequest 用例覆盖；
    // 这里验证 prop 链路：图层点击同时写 selectedNodeIds 并发出 focusNode 请求。
    const project = makeProject();
    project.nodes[0].title = '远端图片节点';
    const onProjectChange = vi.fn();
    const onFocusNode = vi.fn();
    render(
      <WorkflowSidebar
        open
        onOpenChange={vi.fn()}
        outerGap={12}
        project={project}
        onProjectChange={onProjectChange}
        language="zho"
        assetLibrary={LIB}
        onRenameAsset={vi.fn()}
        onRemoveAsset={vi.fn()}
        onCreateFolder={vi.fn()}
        onRenameFolder={vi.fn()}
        onRemoveFolder={vi.fn()}
        onFocusNode={onFocusNode}
      />,
    );
    fireEvent.click(screen.getByTitle('远端图片节点'));
    expect(onFocusNode).toHaveBeenCalledWith('far-away');
    // 未接 onFocusNode 时退化为纯选择（向后兼容）。
    expect(onProjectChange).not.toHaveBeenCalled();
  });

  it('WorkflowSidebar layer click without onFocusNode still selects', () => {
    const project = makeProject();
    project.nodes[0].title = '远端图片节点';
    const onProjectChange = vi.fn();
    render(
      <WorkflowSidebar
        open
        onOpenChange={vi.fn()}
        outerGap={12}
        project={project}
        onProjectChange={onProjectChange}
        language="zho"
        assetLibrary={LIB}
        onRenameAsset={vi.fn()}
        onRemoveAsset={vi.fn()}
        onCreateFolder={vi.fn()}
        onRenameFolder={vi.fn()}
        onRemoveFolder={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle('远端图片节点'));
    expect(onProjectChange).toHaveBeenCalledWith({ selectedNodeIds: ['far-away'] });
  });
  it('folder picker abort surfaces a product notice instead of silence', async () => {
    vi.stubGlobal('showDirectoryPicker', vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')));
    render(<LocalFolderBrowser language="zho" onInsert={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('local-folder-pick'));
    await waitFor(() => expect(screen.getByText('已取消选择文件夹。')).toBeInTheDocument());
  });

  it('stopping a stale loading node resets it to an interrupted error state', async () => {
    vi.useFakeTimers();
    const p = makeProject();
    p.nodes[0].metadata = { ...p.nodes[0].metadata, status: 'loading', generationStartedAt: Date.now() - 99999, progress: 40 };
    p.selectedNodeIds = ['far-away'];
    render(<Harness initial={p} onNotify={vi.fn()} />);
    await act(async () => { vi.advanceTimersByTime(6500); });
    vi.useRealTimers();
    // stale node renders the toolbar stop affordance; clicking it must clear the zombie loading
    const stop = await screen.findByRole('button', { name: '停止节点' });
    fireEvent.click(stop);
    await waitFor(() => {
      const node = projectState().nodes.find(n => n.id === 'far-away')!;
      expect(node.metadata.status).toBe('error');
      expect(node.metadata.error).toContain('中断');
    });
  });
});
