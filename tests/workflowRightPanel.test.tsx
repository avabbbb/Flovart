import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioRightDrawer } from '../components/studio/StudioRightDrawer';
import { WorkflowContextPanel, WorkflowWorkspace } from '../components/workflow/WorkflowWorkspace';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { workflowMediaStorage } from '../components/workflow/storage';
import type { AssetLibrary } from '../types';

const TEST_ASSET_LIBRARY: AssetLibrary = {
  folders: [],
  items: [
    { id: 'image', name: '产品主图', folderIds: [], tags: [], dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png', width: 320, height: 240, createdAt: 0 },
    { id: 'video', name: '运动参考', folderIds: [], tags: [], dataUrl: 'https://example.com/motion.mp4', mimeType: 'video/mp4', width: 320, height: 240, createdAt: 0 },
  ],
};

const renderWorkspace = () => render(
  <WorkflowWorkspace
    theme="light"
    language="zho"
    sharedMedia={[]}
    t={key => key}
    userApiKeys={[]}
    dynamicModelOptions={{} as never}
    onOpenSettings={vi.fn()}
    assetLibrary={TEST_ASSET_LIBRARY}
    onRenameAsset={vi.fn()}
    onRemoveAsset={vi.fn()}
    onCreateFolder={vi.fn()}
    onRenameFolder={vi.fn()}
    onRemoveFolder={vi.fn()}
  />,
);

describe('Workflow right panel', () => {
  const desktopWidth = window.innerWidth;

  beforeEach(async () => {
    localStorage.clear();
    await workflowMediaStorage.clear();
    const project = createWorkflowProject('右侧面板测试');
    useWorkflowStore.setState({ hydrated: true, projects: [project], activeProjectId: project.id });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: desktopWidth });
    window.dispatchEvent(new Event('resize'));
    vi.unstubAllGlobals();
  });

  it('keeps the canvas free of the drawer — the Agent surface is mounted by the App shell', () => {
    renderWorkspace();

    // IA keystone: WorkflowWorkspace no longer owns the right drawer. The
    // single global drawer lives in App.tsx so it can span Canvas AND Table
    // without unmounting either surface.
    expect(document.querySelector('.compact-right-panel')).toBeNull();
    expect(document.querySelector('.workflow-workspace')).toBeInTheDocument();
  });

  it('docks the drawer in-flow so it reflows the canvas instead of overlaying a selected node', () => {
    const project = useWorkflowStore.getState().projects[0];
    render(
      <div className="relative flex h-full min-h-0">
        <div className="min-w-0 flex-1">canvas</div>
        <StudioRightDrawer
          open
          onOpenChange={vi.fn()}
          outerGap={0}
          width={360}
          minWidth={280}
          maxWidth={640}
          onWidthChange={vi.fn()}
          flush
          docked
          activeTab="context"
          onTabChange={vi.fn()}
          tabs={[{ id: 'context', label: '上下文', icon: undefined }]}
        >
          <WorkflowContextPanel project={project} />
        </StudioRightDrawer>
      </div>,
    );

    const drawer = screen.getByTitle('收起右侧面板').closest('aside') as HTMLElement;
    // Docked mode = in-flow relative positioning, so the aside participates in
    // the flex row and can never cover the selected node.
    expect(drawer.style.position).toBe('relative');
    expect(screen.getByRole('region', { name: 'Workflow 上下文' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '右侧面板测试' })).toBeInTheDocument();
  });

  it('collapses to a non-interactive strip that leaves no phantom layout rect', () => {
    const project = useWorkflowStore.getState().projects[0];
    const { rerender } = render(
      <StudioRightDrawer
        open={false}
        onOpenChange={vi.fn()}
        outerGap={0}
        width={360}
        minWidth={280}
        maxWidth={640}
        onWidthChange={vi.fn()}
        flush
        docked
        activeTab="context"
        onTabChange={vi.fn()}
        tabs={[{ id: 'context', label: '上下文', icon: undefined }]}
      >
        <WorkflowContextPanel project={project} />
      </StudioRightDrawer>,
    );

    const drawer = screen.getByTitle('收起右侧面板').closest('aside') as HTMLElement;
    expect(drawer.style.display).toBe('none');
    expect(drawer.style.pointerEvents).toBe('none');

    rerender(
      <StudioRightDrawer
        open
        onOpenChange={vi.fn()}
        outerGap={0}
        width={360}
        minWidth={280}
        maxWidth={640}
        onWidthChange={vi.fn()}
        flush
        docked
        activeTab="context"
        onTabChange={vi.fn()}
        tabs={[{ id: 'context', label: '上下文', icon: undefined }]}
      >
        <WorkflowContextPanel project={project} />
      </StudioRightDrawer>,
    );
    expect(drawer.style.pointerEvents).toBe('auto');
    expect(drawer.style.display).not.toBe('none');
  });

  it('searches Workflow assets in the left sidebar popup', () => {
    renderWorkspace();

    // 左栏弹窗默认打开，切到"资产"tab
    fireEvent.click(screen.getByTestId('sidebar-tab-assets'));
    fireEvent.change(screen.getByRole('searchbox', { name: '请输入搜索内容' }), { target: { value: '运动' } });
    expect(screen.queryByText('产品主图')).toBeNull();
    expect(screen.getByText('运动参考')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: '请输入搜索内容' }), { target: { value: '不存在' } });
    expect(screen.getByText('没有匹配的资产')).toBeTruthy();
  });

  it('persists left-sidebar media inserts without embedding data URLs in the project', async () => {
    class TestImage {
      naturalWidth = 800;
      naturalHeight = 600;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', TestImage);
    renderWorkspace();

    fireEvent.click(screen.getByTestId('sidebar-tab-assets'));
    fireEvent.click(screen.getByRole('button', { name: '添加 产品主图' }));

    await waitFor(() => expect(useWorkflowStore.getState().projects[0].nodes).toHaveLength(1));
    const json = JSON.stringify(useWorkflowStore.getState().projects[0]);
    expect(json).toContain('storageKey');
    expect(json).not.toContain('data:image');
  });
});
