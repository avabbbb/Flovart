import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowWorkspace } from '../components/workflow/WorkflowWorkspace';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { workflowMediaStorage } from '../components/workflow/storage';
import type { AssetLibrary } from '../types';

vi.mock('../components/agent/FlovartAgentPanel', () => ({
  FlovartAgentPanel: ({ project }: { project: { title: string } }) => <div data-testid="flovart-main-agent">PI Agent · {project.title}</div>,
}));

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

  it('starts collapsed by default and persists its visibility like the Canvas panel', () => {
    renderWorkspace();

    const close = screen.getByTitle('收起右侧面板');
    const drawer = close.closest('aside') as HTMLElement;
    expect(drawer.style.opacity).toBe('0');
    expect(drawer.style.pointerEvents).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: '打开右侧面板' }));
    expect(localStorage.getItem('workflowRightPanelOpenV2')).toBe('true');
    fireEvent.click(close);
    expect(localStorage.getItem('workflowRightPanelOpenV2')).toBe('false');
  });

  it('starts closed on narrow screens so the drawer cannot block first-run Workflow actions', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    renderWorkspace();

    const open = screen.getByRole('button', { name: '打开右侧面板' });
    const drawer = screen.getByTitle('收起右侧面板').closest('aside') as HTMLElement;
    expect(drawer.style.pointerEvents).toBe('none');
    expect(open.style.pointerEvents).toBe('auto');
    expect(document.querySelector('.workflow-sidebar')).toBeNull();

    fireEvent.click(open);
    expect(drawer.style.pointerEvents).toBe('auto');

    const openLayers = screen.getByRole('button', { name: '打开图层与资产' });
    expect(openLayers.style.pointerEvents).toBe('auto');
    fireEvent.click(openLayers);
    expect(document.querySelector('.workflow-sidebar')).toBeInTheDocument();
  });

  it('mounts the iterative Flovart PI Agent beside the visible Workflow', () => {
    renderWorkspace();

    expect(screen.getByTestId('flovart-main-agent')).toHaveTextContent('PI Agent · 右侧面板测试');
    expect(screen.queryByText('网站')).toBeNull();
    expect(screen.queryByText('本机')).toBeNull();
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
