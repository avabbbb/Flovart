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
  modelPreference: { textModel: '', imageModel: '', videoModel: '' },
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
  it('discloses tools only after one source is selected', async () => {
    const view = render(<TableWorkspace {...baseProps} project={null} />);
    expect(screen.getByText('先选择一个输入')).toBeTruthy();
    expect(screen.queryByText('预处理工具')).toBeNull();

    view.rerender(<TableWorkspace {...baseProps} project={project} />);
    expect(await screen.findByText('预处理工具')).toBeTruthy();
    expect(screen.getByText('全能参考准备')).toBeTruthy();
    expect(screen.getByText('人物抠出')).toBeTruthy();
  });
});
