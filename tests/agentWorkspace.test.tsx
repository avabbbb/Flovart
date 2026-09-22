import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentConnectionsPage, AgentDrawerEmptyState } from '../components/agent/AgentWorkspace';
import { createWorkflowProject } from '../components/workflow/store';

describe('Agent surfaces', () => {
  it('uses the top-level Agent page for local-agent connections only', () => {
    const project = { ...createWorkflowProject('Agent 项目'), id: 'project' };
    render(<AgentConnectionsPage project={project} />);

    expect(screen.getByTestId('agent-connections-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '连接本地 Agent' })).toBeInTheDocument();
    expect(screen.getByTestId('agent-host-picker')).toBeInTheDocument();
    expect(screen.getByText(/内置助手仍在画布右侧使用/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /开始你的创作/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Brief/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /时间线/ })).not.toBeInTheDocument();
  });

  it('keeps project-less assistant onboarding separate from connection management', () => {
    const onCreateProject = vi.fn();
    render(<AgentDrawerEmptyState onCreateProject={onCreateProject} />);

    expect(screen.getByTestId('agent-drawer-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-host-picker')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));
    expect(onCreateProject).toHaveBeenCalledOnce();
  });
});
