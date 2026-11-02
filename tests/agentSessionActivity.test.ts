import type { ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowAgentSession } from '../agent/session.js';

// The session only calls write() on SSE responses; a full ServerResponse is not needed here.
const fakeResponse = (write: (chunk: string) => unknown) => ({ write }) as unknown as ServerResponse;

describe('WorkflowAgentSession activity log', () => {
  it('records a failed command with a safe summary and pushes it to clients', async () => {
    const session = new WorkflowAgentSession();
    const writes: string[] = [];
    session.clients.set('c1', fakeResponse(chunk => writes.push(chunk)));
    await expect(session.callCommand('workflow.node.create', { type: 'text', title: 'Shot 01', prompt: 'secret prompt' }, 'cli'))
      .rejects.toMatchObject({ code: 'WORKSPACE_UNAVAILABLE' });
    const [entry] = session.activityLog();
    expect(entry).toMatchObject({ command: 'workflow.node.create', source: 'cli', status: 'error', summary: 'type=text title=Shot 01' });
    expect(entry.summary).not.toContain('secret');
    expect(writes.filter(chunk => chunk.startsWith('event: activity')).length).toBe(2);
  });

  it('skips status polling and caps the buffer at 200', async () => {
    const session = new WorkflowAgentSession();
    await session.callCommand('status');
    expect(session.activityLog()).toHaveLength(0);
    for (let i = 0; i < 205; i += 1) {
      await session.callCommand('workflow.inspect', {}, 'mcp').catch(() => undefined);
    }
    expect(session.activityLog()).toHaveLength(200);
  });

  it('lists connected canvas windows', () => {
    const session = new WorkflowAgentSession();
    session.clients.set('c1', fakeResponse(() => true));
    session.updateSnapshot({ id: 'p1', title: 'Storyboard' }, 'c1');
    expect(session.clientsView()).toEqual([
      expect.objectContaining({ clientId: 'c1', projectId: 'p1', projectTitle: 'Storyboard', active: true }),
    ]);
  });

  it('records a resolved ok:false result as an error', async () => {
    const session = new WorkflowAgentSession();
    vi.spyOn(session, 'dispatchCommand').mockResolvedValue({
      ok: false,
      error: { code: 'RUNTIME_UNAVAILABLE', message: 'desktop only' },
    });
    await expect(session.callCommand('command.list', {}, 'agent')).resolves.toMatchObject({ ok: false });
    expect(session.activityLog()[0]).toMatchObject({
      command: 'command.list',
      status: 'error',
      error: { code: 'RUNTIME_UNAVAILABLE', message: 'desktop only' },
    });
  });
});
