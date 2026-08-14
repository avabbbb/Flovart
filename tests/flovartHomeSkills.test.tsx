import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import FlovartHome from '../components/home/FlovartHome';
import { useWorkflowStore } from '../components/workflow/store';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { readPendingProductionSkill, useProductionSkillComposerStore } from '../stores/useProductionSkillComposerStore';

describe('Flovart Home Skill 台', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = '';
    useWorkflowStore.setState({ projects: [], activeProjectId: null, hydrated: true });
    useWorkspaceStore.setState({ activeView: 'workflow' });
    useProductionSkillComposerStore.setState({ pendingByProject: {} });
  });

  it('shows the bundled VOX example and opens its verified package details', () => {
    render(<FlovartHome />);

    expect(screen.getByRole('heading', { name: '选择一种制作方法' })).toBeInTheDocument();
    expect(screen.getByText('不用学习命令。选择后，我们会新建项目并把推荐调用词填进 Agent，你只需要改主题并发送。')).toBeInTheDocument();
    expect(screen.getByText('VOX Skill')).toBeInTheDocument();
    expect(screen.queryByText(/Director|导演 Skill/)).not.toBeInTheDocument();
    expect(screen.getByText('内置示例')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '了解并使用 VOX Skill' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('community.vox-director');
    expect(screen.getByRole('dialog')).toHaveTextContent('不读取 API Key');
    expect(screen.getByRole('dialog')).toHaveTextContent('查看上游源码');
    expect(screen.getByRole('dialog')).toHaveTextContent('$vox-director');
    expect(screen.getByRole('dialog')).toHaveTextContent('不会自动发送、调用 Provider 或产生费用');
  }, 20_000);

  it('creates a project and queues an editable Agent draft instead of an empty Workflow', () => {
    render(<FlovartHome />);

    fireEvent.click(screen.getByRole('button', { name: '了解并使用 VOX Skill' }));
    fireEvent.click(screen.getByRole('button', { name: '在本机 Agent 中试用' }));

    const project = useWorkflowStore.getState().projects[0];
    expect(project.title).toBe('VOX Skill 示例');
    expect(useWorkspaceStore.getState().activeView).toBe('agent');
    expect(localStorage.getItem('flovart.workflow.agent.mode')).toBe('local');
    expect(readPendingProductionSkill(project.id)?.prompt).toContain('$vox-director');
    expect(sessionStorage.length).toBe(0);
    expect(window.location.hash).toBe('#/app');
  }, 20_000);

  it('exposes a semantic desktop shell with real workspace entries and a usable Agent composer', () => {
    render(<FlovartHome />);

    expect(screen.getByRole('navigation', { name: '首页导航' })).toBeInTheDocument();
    for (const label of ['首页', '新建项目', 'Workflow', 'Table', 'Agent', 'Skill']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('textbox', { name: '创作想法' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '空白 Workflow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /一张 Workflow/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /轻量视频节点/ })).toBeInTheDocument();
    expect(screen.queryByText('FlovartTV')).not.toBeInTheDocument();
  }, 20_000);

  it('turns a homepage idea into a real text node and opens Agent', () => {
    render(<FlovartHome />);

    fireEvent.change(screen.getByRole('textbox', { name: '创作想法' }), { target: { value: '做一个关于城市夜雨的 30 秒短片' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    const project = useWorkflowStore.getState().projects[0];
    expect(project.title).toBe('做一个关于城市夜雨的 30 秒短片');
    expect(project.nodes).toHaveLength(1);
    expect(project.nodes[0]).toMatchObject({ type: 'text', metadata: { content: '做一个关于城市夜雨的 30 秒短片' } });
    expect(useWorkspaceStore.getState().activeView).toBe('agent');
    expect(window.location.hash).toBe('#/app');
  }, 20_000);
});
