import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_DRAFT_LOG_LIMIT,
  appendWorkflowDraftLog,
  createWorkflowDraftLogEntry,
  describeWorkflowDraftCommand,
} from '../components/workflow/draftLog';
import { createWorkflowProject } from '../components/workflow/store';

describe('workflow draft log', () => {
  it('describes canvas draft actions in designer-readable Chinese', () => {
    expect(describeWorkflowDraftCommand('workflow.node.create', { type: 'image', title: '关键帧' })).toBe('创建image节点「关键帧」');
    expect(describeWorkflowDraftCommand('workflow.node.create-connected', { type: 'video', title: '动态镜头' })).toBe('创建video节点「动态镜头」并连线');
    expect(describeWorkflowDraftCommand('workflow.node.update', { nodeId: 'kf-1' })).toBe('更新节点「kf-1」');
    expect(describeWorkflowDraftCommand('workflow.node.tool', { nodeId: 'img-1', tool: 'upscale' })).toBe('对节点「img-1」执行 upscale 工具');
    expect(describeWorkflowDraftCommand('workflow.connect', { fromNodeId: 'a', toNodeId: 'b' })).toBe('连接 a → b');
    expect(describeWorkflowDraftCommand('workflow.select', { ids: ['a', 'b', 'c'] })).toBe('选中 3 个节点');
    expect(describeWorkflowDraftCommand('workflow.project.create', { title: 'AI-Native 项目' })).toBe('新建项目「AI-Native 项目」');
  });

  it('appends entries and caps the log size at the fixed limit', () => {
    let project = createWorkflowProject('草稿');
    for (let i = 0; i < WORKFLOW_DRAFT_LOG_LIMIT + 5; i += 1) {
      project = appendWorkflowDraftLog(project, createWorkflowDraftLogEntry({
        source: 'agent', command: 'workflow.node.create', args: { type: 'text' }, ok: true,
      }));
    }
    expect(project.draftLog?.length).toBe(WORKFLOW_DRAFT_LOG_LIMIT);
    expect(project.draftLog?.[0].ok).toBe(true);
  });
});
