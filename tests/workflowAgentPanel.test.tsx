import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkflowAgentPanel } from '../components/workflow/WorkflowAgentPanel';
import { createWorkflowProject } from '../components/workflow/store';

describe('Workflow Agent panel', () => {
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
});
