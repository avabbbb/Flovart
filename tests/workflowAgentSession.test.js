import { describe, expect, it } from 'vitest';
import { WorkflowAgentSession } from '../agent/session.js';

describe('workflow agent session', () => {
  it('requires a visible Browser Workflow and rejects removed native modes', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 10 });
    expect(session.health()).toMatchObject({ hasWorkflow: false, clients: 0 });
    expect(session.health()).not.toHaveProperty('nativeWorkspace');
    await expect(session.callCommand('workflow.project.create', { title: '浏览器工作区测试' }, 'mcp'))
      .rejects.toMatchObject({ code: 'WORKSPACE_UNAVAILABLE' });
    await expect(session.callCommand('workflow.inspect', { workspaceMode: 'native' }, 'mcp'))
      .rejects.toMatchObject({ code: 'WORKSPACE_REQUIRED' });
    expect(session.health()).not.toHaveProperty('nativeWorkspace');
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
    expect(session.health()).toMatchObject({ hasWorkflow: true, activeProjectId: 'project-1', clientId: 'browser-1' });
  });

  it('forwards the external Agent caller identity to the Browser Workflow envelope', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 1000 });
    let event = '';
    const response = { writeHead() {}, write(value) { event += value; }, on() {} };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), response);
    session.updateSnapshot({ id: 'project-1' }, 'browser-1');

    const call = session.callCommand(
      'workflow.node.run',
      { projectId: 'project-1', nodeId: 'node-1' },
      'cli',
      'run-node-1',
      undefined,
      { agentIdentity: 'codex' },
    );
    const payload = JSON.parse(event.match(/event: tool_call\ndata: (.+)\n\n/)?.[1] || '{}');
    expect(payload.envelope.caller).toEqual({ agentIdentity: 'codex' });
    session.resolveResult({ requestId: payload.requestId, clientId: 'browser-1', result: { ok: true } });
    await expect(call).resolves.toEqual({ ok: true });
  });

  it('keeps the active writer snapshot current as the browser project changes', () => {
    const session = new WorkflowAgentSession({ timeoutMs: 10 });
    const response = { writeHead() {}, write() {}, on() {} };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), response);
    session.updateSnapshot({ id: null, draftVersion: 0 }, 'browser-1');
    session.updateSnapshot({ id: 'project-1', draftVersion: 2 }, 'browser-1');

    expect(session.health()).toMatchObject({ activeProjectId: 'project-1', revision: 2, activeWriter: { projectId: 'project-1' } });
  });

  it('never falls back a browser-bound mutation into a hidden workspace', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 10 });
    await expect(session.callCommand('workflow.apply', {
      workspaceMode: 'browser',
      clientId: 'missing-browser',
      projectId: 'browser-project',
      expectedRevision: 1,
      mutationId: 'browser-only',
      operations: [],
    }, 'cli')).rejects.toMatchObject({ code: 'WORKSPACE_UNAVAILABLE' });
    await expect(session.callCommand('workflow.project.create', { title: 'Agent 不得绕过浏览器' }, 'agent'))
      .rejects.toMatchObject({ code: 'WORKSPACE_UNAVAILABLE' });
  });

  it('uses the connected Browser authority and rejects native mode even when a tab is ready', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 1000 });
    let events = '';
    const response = { writeHead() {}, write(value) { events += value; }, on() {} };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), response);
    session.updateSnapshot({ id: 'browser-project', draftVersion: 1 }, 'browser-1');

    const browserCall = session.callCommand('workflow.project.list', {}, 'cli', 'browser-list');
    const browserPayload = JSON.parse(events.match(/event: tool_call\ndata: (.+)\n\n/)?.[1] || '{}');
    session.resolveResult({ requestId: browserPayload.requestId, clientId: 'browser-1', result: { ok: true, result: [] } });
    await expect(browserCall).resolves.toMatchObject({ ok: true });
    await expect(session.callCommand('workflow.project.create', { workspaceMode: 'native', title: '隐藏工作区' }, 'operator', 'native-create'))
      .rejects.toMatchObject({ code: 'WORKSPACE_REQUIRED' });
  });

  it('keeps explicit multi-tab clientId mutations on their owning browser', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 1000 });
    let firstEvents = '';
    let secondEvents = '';
    const first = { writeHead() {}, write(value) { firstEvents += value; }, on() {} };
    const second = { writeHead() {}, write(value) { secondEvents += value; }, on() {} };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), first);
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-2'), second);
    session.updateSnapshot({ id: 'project-1' }, 'browser-1');
    session.updateSnapshot({ id: 'project-2' }, 'browser-2');

    const call = session.callCommand('workflow.apply', {
      workspaceMode: 'browser', clientId: 'browser-1', projectId: 'project-1',
      expectedRevision: 1, mutationId: 'tab-1', operations: [],
    }, 'cli');
    const payload = JSON.parse(firstEvents.match(/event: tool_call\ndata: (.+)\n\n/)?.[1] || '{}');
    session.resolveResult({ requestId: payload.requestId, clientId: 'browser-1', result: { ok: true } });

    await expect(call).resolves.toEqual({ ok: true });
    expect(payload.envelope.args.clientId).toBe('browser-1');
    expect(secondEvents).not.toContain('tool_call');
  });

  it('locks tagged external CLI calls to one Host until an explicit switch', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 1000 });
    let events = '';
    const response = { writeHead() {}, write(value) { events += value; }, on() {} };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), response);
    session.updateSnapshot({ id: 'project-1', draftVersion: 1 }, 'browser-1');

    const inspectFor = async (agentIdentity, idempotencyKey) => {
      const call = session.callCommand('workflow.inspect', { projectId: 'project-1' }, 'cli', idempotencyKey, undefined, { agentIdentity });
      const calls = [...events.matchAll(/event: tool_call\ndata: (.+)\n\n/g)];
      const payload = JSON.parse(calls.at(-1)?.[1] || '{}');
      session.resolveResult({ requestId: payload.requestId, clientId: 'browser-1', result: { ok: true } });
      return call;
    };

    await expect(inspectFor('codex', 'codex-inspect')).resolves.toMatchObject({ ok: true });
    expect(session.health()).toMatchObject({ activeHostWriter: { agentIdentity: 'codex', projectId: 'project-1' } });
    await expect(inspectFor('claude-code', 'claude-inspect')).rejects.toMatchObject({ code: 'AGENT_WRITER_INACTIVE' });

    expect(session.activateAgentHost({ agentIdentity: 'claude-code', projectId: 'project-1' })).toMatchObject({
      switched: true,
      activeHostWriter: { agentIdentity: 'claude-code', projectId: 'project-1' },
    });
    await expect(inspectFor('claude-code', 'claude-inspect-v2')).resolves.toMatchObject({ ok: true });
    await expect(session.callCommand('workflow.inspect', { projectId: 'project-1' }, 'cli', 'anonymous-inspect')).rejects.toMatchObject({ code: 'AGENT_HOST_REQUIRED' });
  });

  it('does not let an inactive Browser tab switch the Host writer project', () => {
    const session = new WorkflowAgentSession({ timeoutMs: 10 });
    const first = { writeHead() {}, write() {}, on() {} };
    const second = { writeHead() {}, write() {}, on() {} };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), first);
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-2'), second);
    session.updateSnapshot({ id: 'project-1', draftVersion: 1 }, 'browser-1');
    session.updateSnapshot({ id: 'project-2', draftVersion: 1 }, 'browser-2');
    session.activateAgentHost({ agentIdentity: 'codex', projectId: 'project-1' });

    expect(() => session.activateAgentHost({ agentIdentity: 'claude-code', projectId: 'project-2' }))
      .toThrow('当前 Browser Writer 没有激活这个 Workflow 项目');
    expect(session.health()).toMatchObject({ activeHostWriter: { agentIdentity: 'codex', projectId: 'project-1' } });
  });

  it('does not let a second browser tab silently become the Active Writer', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 10 });
    const first = { writeHead() {}, write() {}, on() {} };
    const second = { writeHead() {}, write() {}, on() {} };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), first);
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-2'), second);
    session.updateSnapshot({ id: 'project-1', draftVersion: 1 }, 'browser-1');
    session.updateSnapshot({ id: 'project-2', draftVersion: 1 }, 'browser-2');

    expect(session.health()).toMatchObject({ clientId: 'browser-1', activeWriter: { clientId: 'browser-1', projectId: 'project-1' } });
    await expect(session.callCommand('workflow.inspect', { clientId: 'browser-2', projectId: 'project-2' }, 'cli')).rejects.toMatchObject({ code: 'LEASE_TARGET_CHANGED' });

    expect(session.activateClient({ clientId: 'browser-2', projectId: 'project-2' })).toMatchObject({ clientId: 'browser-2', projectId: 'project-2' });
    expect(session.health()).toMatchObject({ clientId: 'browser-2', activeWriter: { clientId: 'browser-2' } });
  });

  it('fails a leased Agent turn when the active project changes instead of writing the new project', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 1000 });
    let events = '';
    const response = { writeHead() {}, write(value) { events += value; }, on() {} };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), response);
    session.updateSnapshot({ id: 'project-a', draftVersion: 4 }, 'browser-1');

    const inspect = session.callCommand('workflow.inspect', {}, 'agent', 'turn-inspect');
    const firstPayload = JSON.parse(events.match(/event: tool_call\ndata: (.+)\n\n/)?.[1] || '{}');
    expect(firstPayload.envelope.workspaceLease).toMatchObject({ clientId: 'browser-1', projectId: 'project-a', baseRevision: 4 });
    session.resolveResult({ requestId: firstPayload.requestId, clientId: 'browser-1', result: { ok: true } });
    await expect(inspect).resolves.toMatchObject({ ok: true });

    session.updateSnapshot({ id: 'project-b', draftVersion: 1 }, 'browser-1');
    await expect(session.callCommand('workflow.apply', {
      operations: [{ type: 'add_node', node: { id: 'must-not-write', type: 'text' } }],
      mutationId: 'turn-apply',
    }, 'agent')).rejects.toMatchObject({ code: 'LEASE_TARGET_CHANGED' });
    expect(events.match(/event: tool_call\n/g) || []).toHaveLength(1);
  });

  it('rejects explicit activation when the browser has no matching project binding', () => {
    const session = new WorkflowAgentSession({ timeoutMs: 10 });
    const response = { writeHead() {}, write() {}, on() {} };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), response);
    session.updateSnapshot({ id: null, draftVersion: 1 }, 'browser-1');

    expect(() => session.activateClient({ clientId: 'browser-1', projectId: 'project-1' })).toThrow('Workflow Browser binding 不匹配');
  });

  it('revokes the writer instead of silently falling back when the active tab closes', () => {
    const session = new WorkflowAgentSession({ timeoutMs: 10 });
    let close;
    const first = { writeHead() {}, write() {}, on(event, listener) { if (event === 'close') close = listener; } };
    const second = { writeHead() {}, write() {}, on() {} };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), first);
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-2'), second);
    session.updateSnapshot({ id: 'project-1' }, 'browser-1');
    session.updateSnapshot({ id: 'project-2' }, 'browser-2');
    close();
    expect(session.health()).toMatchObject({ clients: 1, hasWorkflow: false, clientId: null, activeWriter: null });
  });

  it('does not let a stale SSE close event evict a same-id reconnect', () => {
    const session = new WorkflowAgentSession({ timeoutMs: 10 });
    let staleClose;
    const first = { writeHead() {}, write() {}, on(event, listener) { if (event === 'close') staleClose = listener; } };
    const replacement = { writeHead() {}, write() {}, on() {} };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), first);
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), replacement);
    session.updateSnapshot({ id: 'project-1', draftVersion: 1 }, 'browser-1');

    staleClose?.();
    expect(session.health()).toMatchObject({ clients: 1, hasWorkflow: true, clientId: 'browser-1' });
  });

  it('stops waiting and clears the pending command when the Agent turn is cancelled', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 1000 });
    const response = { writeHead() {}, write() {}, on() {} };
    session.openEvents(new URL('http://127.0.0.1/events?clientId=browser-1'), response);
    session.updateSnapshot({ id: 'project-1' }, 'browser-1');
    const controller = new AbortController();
    const call = session.callCommand('workflow.inspect', {}, 'flovart-agent', undefined, controller.signal);

    controller.abort();

    await expect(call).rejects.toThrow('已取消');
    expect(session.health().pending).toBe(0);
  });
});
