import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentWorkspace } from '../components/agent/AgentWorkspace';
import { createDefaultAgentLayout, useAgentWorkspaceStore } from '../components/agent/agentWorkspaceStore';
import { createWorkflowProject } from '../components/workflow/store';

describe('Agent workspace', () => {
  beforeEach(() => {
    useAgentWorkspaceStore.setState({
      layouts: { project: createDefaultAgentLayout() },
    });
  });

  it('shows production control without mounting a second Agent conversation', () => {
    const project = { ...createWorkflowProject('Agent 项目'), id: 'project' };
    render(
      <AgentWorkspace
        project={project}
        onCreateProject={vi.fn()}
        onOpenWorkflow={vi.fn()}
        onOpenTable={vi.fn()}
      />,
    );

    expect(screen.getByTestId('agent-main-workspace')).toHaveClass('agent-workspace-shell');
    expect(screen.getByRole('region', { name: 'Production Crew 状态' })).toBeInTheDocument();
    expect(screen.getByText('协作 Agent 会帮你推进制作')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /开始你的创作/ })).not.toBeInTheDocument();
    expect(screen.queryByText('历史对话')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '调整面板大小' })).not.toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('surfaces Agent edits in the shared canvas timeline', () => {
    const project = {
      ...createWorkflowProject('Agent 项目'),
      id: 'project',
      draftChangeSets: [{
        id: 'agent-turn',
        at: '2026-08-10T08:00:00.000Z',
        actor: 'agent' as const,
        intent: '搭建 VOX 分镜画布',
        status: 'completed' as const,
        baseDraftVersion: 1,
        resultDraftVersion: 2,
        nodeChanges: [],
        connectionChanges: [],
      }],
    };
    render(<AgentWorkspace project={project} onCreateProject={vi.fn()} onOpenWorkflow={vi.fn()} onOpenTable={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /时间线/ }));
    expect(screen.getByText('搭建 VOX 分镜画布')).toBeInTheDocument();
    expect(screen.getByText(/Agent · 已应用/)).toBeInTheDocument();
  });

  it('keeps brief, artifacts, and timeline as lightweight context instead of floating windows', () => {
    const project = { ...createWorkflowProject('移动项目'), id: 'project' };
    render(<AgentWorkspace project={project} onCreateProject={vi.fn()} onOpenWorkflow={vi.fn()} onOpenTable={vi.fn()} />);

    expect(screen.getByText(/生成结果会自动汇集在这里/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Brief/ }));
    expect(screen.getByText(/协作 Agent 与 Flovart 使用同一份 Workflow/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开 Workflow/ })).toBeInTheDocument();
  });
});
