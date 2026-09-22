import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TableWorkspace } from '../components/table/TableWorkspace';
import type { WorkflowProject } from '../components/workflow/types';

vi.mock('../components/workflow/media', () => ({
  loadWorkflowMediaBlob: vi.fn(),
  useWorkflowMediaUrl: () => ({ url: 'data:image/png;base64,AA==', error: null }),
}));

const baseProps = {
  userApiKeys: [],
  onCommit: vi.fn(),
  onSaveAsset: vi.fn(),
  onOpenWorkflow: vi.fn(),
  onOpenSettings: vi.fn(),
};

const project: WorkflowProject = {
  id: 'project-1', title: '测试项目', connections: [], selectedNodeIds: ['image-1'],
  viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'dots', agentSessions: [], activeAgentSessionId: null,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  nodes: [{ id: 'image-1', type: 'image', title: '人物参考', position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { mimeType: 'image/png', href: 'data:image/png;base64,AA==' } }],
};

describe('Table focused workspace', () => {
  it('keeps the tool rail visible and explains why actions are unavailable without a source', async () => {
    const view = render(<TableWorkspace {...baseProps} project={null} />);
    expect(screen.getByText('先选择一个输入')).toBeTruthy();
    expect(screen.getByText('预处理工具')).toBeTruthy();
    expect(screen.getByText(/先从左侧选择图片/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /全能参考准备/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '先选择素材' })).toBeDisabled();

    view.rerender(<TableWorkspace {...baseProps} project={project} />);
    expect(await screen.findByText('预处理工具')).toBeTruthy();
    expect(screen.getByRole('button', { name: /全能参考准备/ })).toBeEnabled();
    expect(screen.getByText('人物抠出')).toBeTruthy();
    expect(screen.getByRole('button', { name: '执行处理' })).toBeEnabled();
  });
});
