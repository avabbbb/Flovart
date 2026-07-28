import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import FlovartHome from '../components/home/FlovartHome';
import { readDirectorSkillDraft } from '../services/directorSkillLaunch';
import { useWorkflowStore } from '../components/workflow/store';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

describe('Flovart Home Skill 台', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = '';
    useWorkflowStore.setState({ projects: [], activeProjectId: null, hydrated: true });
    useWorkspaceStore.setState({ activeView: 'workflow' });
  });

  it('shows the bundled VOX example and opens its verified package details', () => {
    render(<FlovartHome />);

    expect(screen.getByRole('heading', { name: '选择一个导演 Skill' })).toBeInTheDocument();
    expect(screen.getByText('不用学习命令。选择后，我们会新建项目并把推荐调用词填进 Agent，你只需要改主题并发送。')).toBeInTheDocument();
    expect(screen.getByText('VOX Director')).toBeInTheDocument();
    expect(screen.getByText('内置示例')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '了解并使用 VOX Director' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('community.vox-director');
    expect(screen.getByRole('dialog')).toHaveTextContent('不读取 API Key');
    expect(screen.getByRole('dialog')).toHaveTextContent('查看上游源码');
    expect(screen.getByRole('dialog')).toHaveTextContent('$vox-director');
    expect(screen.getByRole('dialog')).toHaveTextContent('不会自动发送、调用 Provider 或产生费用');
  });

  it('creates a project and queues an editable Agent draft instead of an empty Workflow', () => {
    render(<FlovartHome />);

    fireEvent.click(screen.getByRole('button', { name: '了解并使用 VOX Director' }));
    fireEvent.click(screen.getByRole('button', { name: '在本机 Agent 中试用' }));

    const project = useWorkflowStore.getState().projects[0];
    expect(project.title).toBe('VOX Director 示例');
    expect(useWorkspaceStore.getState().activeView).toBe('agent');
    expect(localStorage.getItem('flovart.workflow.agent.mode')).toBe('local');
    expect(readDirectorSkillDraft(project.id)?.prompt).toContain('$vox-director');
    expect(window.location.hash).toBe('#/app');
  });
});
