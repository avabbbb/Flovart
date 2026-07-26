import { describe, expect, it } from 'vitest';
import { WorkflowAgentSession } from '../agent/session.js';

describe('workflow agent session', () => {
  it('rejects tool calls when no browser is connected', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 10 });
    await expect(session.callCommand('workflow.inspect', {}, 'mcp')).rejects.toThrow('没有已连接');
  });

  it('redacts secrets from pushed workflow snapshots', () => {
    const session = new WorkflowAgentSession();
    session.updateSnapshot({ nodes: [{ metadata: { href: 'data:image/png;base64,SECRET' } }] });
    expect(JSON.stringify(session.health())).not.toContain('SECRET');
  });

  it('cleans pending calls when the owning browser disconnects', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 1000 });
    let close;
    const response = { writeHead() {}, write() {}, on(event, listener) { if (event === 'close') close = listener; } };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), response);
    session.updateSnapshot({ id: 'project-1' }, 'browser-1');
    const call = session.callCommand('workflow.inspect');
    close();
    await expect(call).rejects.toThrow('连接已断开');
  });

  it('routes commands only to the browser that owns the latest Workflow snapshot', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 1000 });
    let event = '';
    const response = { writeHead() {}, write(value) { event += value; }, on() {} };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), response);
    session.updateSnapshot({ id: 'project-1' }, 'browser-1');

    const call = session.callCommand('workflow.node.move', { nodeId: 'node-1', x: 10, y: 20 }, 'cli', 'move-node-1');
    const payload = JSON.parse(event.match(/event: tool_call\ndata: (.+)\n\n/)?.[1] || '{}');
    session.resolveResult({ requestId: payload.requestId, clientId: 'browser-1', result: { ok: true } });

    await expect(call).resolves.toEqual({ ok: true });
    expect(payload.envelope).toMatchObject({
      command: 'workflow.node.move',
      source: 'cli',
      idempotencyKey: 'move-node-1',
    });
    expect(session.health()).toMatchObject({ hasWorkflow: true, activeProjectId: 'project-1' });
  });
});
