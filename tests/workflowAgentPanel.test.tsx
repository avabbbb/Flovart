import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkflowAgentPanel } from '../components/workflow/WorkflowAgentPanel';
import { createWorkflowProject } from '../components/workflow/store';
import { queueDirectorSkillDraft, readDirectorSkillDraft } from '../services/directorSkillLaunch';

describe('Workflow Agent panel', () => {
  beforeEach(() => {
    localStorage.setItem('flovart.workflow.agent.mode', 'online');
    sessionStorage.clear();
  });

  it('shows connection, chat, history, and log surfaces', () => {
    render(<WorkflowAgentPanel project={createWorkflowProject('Agent 测试')} onClose={() => undefined} />);
    expect(screen.getByText('连接')).toBeTruthy();
    expect(screen.getByText('对话')).toBeTruthy();
    expect(screen.getByText('历史')).toBeTruthy();
    expect(screen.getByText('日志')).toBeTruthy();
    expect(screen.getByText('网站')).toBeTruthy();
    expect(screen.getByText('本机')).toBeTruthy();
    expect(screen.getByTitle('添加图片')).toBeTruthy();
  });

  it('does not repeat the drawer title or close action when embedded', () => {
    render(<WorkflowAgentPanel embedded project={createWorkflowProject('嵌入测试')} onClose={() => undefined} />);

    expect(screen.queryByText('Workflow Agent')).toBeNull();
    expect(screen.queryByRole('button', { name: '关闭 Agent' })).toBeNull();
    expect(screen.getByText('网站')).toBeTruthy();
    expect(screen.getByTitle('新对话')).toBeTruthy();
  });

  it('consumes a Skill launch draft into the editable composer', async () => {
    const project = createWorkflowProject('VOX Director 示例');
    queueDirectorSkillDraft({
      projectId: project.id,
      skillId: 'community.vox-director',
      skillVersion: '1.0.0',
      skillName: 'VOX Director',
      prompt: '使用 $vox-director，把【主题】制作成 30 秒短片。',
    });

    render(<WorkflowAgentPanel project={project} onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByDisplayValue(/使用 \$vox-director/)).toBeInTheDocument());
    expect(screen.getByText('VOX Director 调用词已填入；修改主题后发送。')).toBeInTheDocument();
    expect(readDirectorSkillDraft(project.id)).toBeNull();
  });
});
