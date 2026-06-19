import { describe, expect, it, vi } from 'vitest';
import { parseWorkflowAgentPlan, runWorkflowOnlineAgent } from '../services/workflowOnlineAgent';
import type { WorkflowOnlineTurnInput } from '../components/workflow/WorkflowAgentPanel';
import type { WorkflowProject } from '../components/workflow/types';

const project: WorkflowProject = {
  id: 'project', title: '测试', nodes: [], connections: [], selectedNodeIds: [],
  viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'dots', agentSessions: [], activeAgentSessionId: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('workflow online agent', () => {
  it('accepts only the Workflow command allowlist', () => {
    expect(parseWorkflowAgentPlan('{"message":"创建文本","commands":[{"command":"workflow.node.create","args":{"type":"text"}}]}').commands).toHaveLength(1);
    expect(() => parseWorkflowAgentPlan('{"message":"x","commands":[{"command":"canvas.delete","args":{}}]}')).toThrow('不允许');
  });

  it('uses the configured provider and confirms canonical dispatcher mutations', async () => {
    const emit = vi.fn();
    const confirm = vi.fn().mockResolvedValue(true);
    const dispatch = vi.fn()
      .mockResolvedValueOnce({ ok: true, commandId: 'one', confirmation: { required: true, summary: '创建节点' } })
      .mockResolvedValueOnce({ ok: true, commandId: 'one', result: { projectId: project.id } });
    const input: WorkflowOnlineTurnInput = {
      project, messages: [], prompt: '创建一个文本节点', attachments: [], signal: new AbortController().signal, emit, confirm,
    };
    await runWorkflowOnlineAgent(input, {
      userApiKeys: [{ id: 'key', provider: 'openai', capabilities: ['text'], key: 'secret', customModels: ['gpt-test'], createdAt: 1, updatedAt: 1 }],
      modelPreference: { textModel: 'gpt-test', imageModel: '', videoModel: '' },
      generateText: vi.fn().mockResolvedValue('{"message":"准备创建","commands":[{"command":"workflow.node.create","args":{"type":"text","title":"文案"}}]}'),
      dispatch,
    });
    expect(confirm).toHaveBeenCalledWith('创建节点');
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'agent', args: expect.objectContaining({ confirmed: true, projectId: project.id }) }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'assistant', text: expect.stringContaining('已完成') }));
  });
});
