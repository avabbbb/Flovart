import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowWorkspace } from '../components/workflow/WorkflowWorkspace';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { workflowMediaStorage } from '../components/workflow/storage';

const renderWorkspace = () => render(
  <WorkflowWorkspace
    theme="light"
    language="zho"
    sharedMedia={[
      { id: 'asset:image', source: 'asset', sourceId: 'image', name: '产品主图', href: 'data:image/png;base64,AA==', mimeType: 'image/png', type: 'image', category: 'character' },
      { id: 'asset:video', source: 'asset', sourceId: 'video', name: '运动参考', href: 'https://example.com/motion.mp4', mimeType: 'video/mp4', type: 'video', category: 'scene' },
    ]}
    t={key => key}
    userApiKeys={[]}
    modelPreference={{} as never}
    dynamicModelOptions={{} as never}
    onOpenSettings={vi.fn()}
  />,
);

describe('Workflow right panel', () => {
  beforeEach(async () => {
    localStorage.clear();
    await workflowMediaStorage.clear();
    const project = createWorkflowProject('右侧面板测试');
    useWorkflowStore.setState({ hydrated: true, projects: [project], activeProjectId: project.id });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('opens by default and persists its visibility like the Canvas panel', () => {
    renderWorkspace();

    const close = screen.getByTitle('收起右侧面板');
    const drawer = close.closest('aside') as HTMLElement;
    expect(drawer.style.opacity).toBe('1');
    expect(drawer.style.pointerEvents).toBe('auto');
    fireEvent.click(close);
    expect(localStorage.getItem('workflowRightPanelOpen')).toBe('false');
  });

  it('searches and filters Workflow assets with the same compact media controls', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    fireEvent.click(screen.getByRole('button', { name: '视频' }));
    expect(screen.queryByText('产品主图')).toBeNull();
    expect(screen.getByText('运动参考')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索素材库' }), { target: { value: '不存在' } });
    expect(screen.getByText('没有匹配的素材')).toBeTruthy();
  });

  it('persists right-panel media inserts without embedding data URLs in the project', async () => {
    class TestImage {
      naturalWidth = 800;
      naturalHeight = 600;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', TestImage);
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    fireEvent.click(screen.getByRole('button', { name: '添加 产品主图' }));

    await waitFor(() => expect(useWorkflowStore.getState().projects[0].nodes).toHaveLength(1));
    const json = JSON.stringify(useWorkflowStore.getState().projects[0]);
    expect(json).toContain('storageKey');
    expect(json).not.toContain('data:image');
  });
});
