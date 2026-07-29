import { render, screen } from '@testing-library/react';
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

  it('mounts Flovart Agent as the real main panel and labels Codex as an external subtask', () => {
    const project = { ...createWorkflowProject('Agent 项目'), id: 'project' };
    render(
      <AgentWorkspace
        project={project}
        onCreateProject={vi.fn()}
        onProjectChange={vi.fn()}
        onOpenWorkflow={vi.fn()}
        onOpenTable={vi.fn()}
      />,
    );

    expect(screen.getByText('Flovart Agent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Codex 子任务/ })).toBeInTheDocument();
    expect(screen.queryByText('Codex · 制作线程')).not.toBeInTheDocument();
  });
});
