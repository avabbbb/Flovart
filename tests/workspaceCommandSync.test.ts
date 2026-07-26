import { describe, expect, it, vi } from 'vitest';
import { createWorkflowProject } from '../components/workflow/store';
import type { WorkflowProject } from '../components/workflow/types';
import { WorkflowAgentSession } from '../agent/session.js';
import { createWorkflowDispatcher, type WorkflowCommandEnvelope } from '../services/workflowDispatcher';
import { executeFlovartCommand } from '../tools/flovart/core.js';

describe('workspace command synchronization', () => {
  it('normalizes JSON object and array strings before dispatching CLI workspace commands', async () => {
    const dispatch = vi.fn(async (envelope: WorkflowCommandEnvelope) => ({
      ok: true,
      commandId: envelope.id,
      result: envelope.args,
    }));
    const runtime = { workflow: { dispatch } };

    await executeFlovartCommand('workflow.node.create', {
      id: 'research-1',
      type: 'text',
      metadata: '{"content":"Reddit evidence","coverage":{"reddit":"ready"}}',
      idempotencyKey: 'create-research-1',
    }, runtime);
    await executeFlovartCommand('workflow.node.update', {
      nodeId: 'research-1',
      patch: '{"title":"已细修"}',
      idempotencyKey: 'update-research-1',
    }, runtime);
    await executeFlovartCommand('workflow.select', {
      ids: '["research-1"]',
      idempotencyKey: 'select-research-1',
    }, runtime);

    expect(dispatch.mock.calls[0][0].args.metadata).toEqual({
      content: 'Reddit evidence',
      coverage: { reddit: 'ready' },
    });
    expect(dispatch.mock.calls[1][0].args.patch).toEqual({ title: '已细修' });
    expect(dispatch.mock.calls[2][0].args.ids).toEqual(['research-1']);
  });

  it('routes CLI fine-tuning commands into the visible Workflow state exactly once', async () => {
    let projects: WorkflowProject[] = [createWorkflowProject('CLI 同步测试')];
    let activeProjectId = projects[0].id;
    const updateProject = vi.fn((id: string, patch: Partial<WorkflowProject>) => {
      projects = projects.map(project => project.id === id
        ? { ...project, ...patch, updatedAt: new Date().toISOString() }
        : project);
    });
    const dispatch = createWorkflowDispatcher({
      getState: () => ({ projects, activeProjectId }),
      createProject: title => {
        const project = createWorkflowProject(title);
        projects = [project, ...projects];
        activeProjectId = project.id;
        return project.id;
      },
      setActiveProject: id => { activeProjectId = id; },
      deleteProjects: ids => { projects = projects.filter(project => !ids.includes(project.id)); },
      updateProject,
    });
    const session = new WorkflowAgentSession({ timeoutMs: 1000 });
    const response = {
      writeHead() {},
      write(chunk: string) {
        if (!chunk.startsWith('event: tool_call')) return;
        const payload = JSON.parse(chunk.match(/data: (.+)\n\n/)?.[1] || '{}') as {
          requestId: string;
          envelope: WorkflowCommandEnvelope;
        };
        queueMicrotask(async () => {
          const result = await dispatch(payload.envelope);
          session.resolveResult({ requestId: payload.requestId, clientId: 'browser-1', result, error: null });
        });
      },
      on() {},
    };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), response);
    session.updateSnapshot(projects[0], 'browser-1');

    const call = (command: string, args: Record<string, unknown>, idempotencyKey: string) =>
      session.callCommand(command, args, 'cli', idempotencyKey);

    await call('workflow.node.create', { id: 'script-1', type: 'text', title: '旁白脚本', x: 80, y: 120 }, 'create-script-1');
    await call('workflow.node.create-connected', { id: 'shot-1', type: 'image', title: '镜头 1', fromNodeId: 'script-1' }, 'create-shot-1');
    await call('workflow.node.update', { nodeId: 'shot-1', patch: { title: '镜头 1 · 细修版' } }, 'update-shot-1');
    await call('workflow.node.move', { nodeId: 'shot-1', x: 520, y: 180 }, 'move-shot-1');
    await call('workflow.node.move', { nodeId: 'shot-1', x: 520, y: 180 }, 'move-shot-1');

    const project = projects[0];
    expect(project.nodes.map(node => node.id)).toEqual(['script-1', 'shot-1']);
    expect(project.nodes.find(node => node.id === 'shot-1')).toMatchObject({
      title: '镜头 1 · 细修版',
      position: { x: 520, y: 180 },
    });
    expect(project.connections).toHaveLength(1);
    expect(project.connections[0]).toMatchObject({ fromNodeId: 'script-1', toNodeId: 'shot-1' });
    expect(updateProject).toHaveBeenCalledTimes(4);
  });
});
