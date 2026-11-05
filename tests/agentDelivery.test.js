import { describe, expect, it } from 'vitest';
import { buildCanvasUrl, buildDelivery, collectNodeIds } from '../agent/delivery.js';
import { WorkflowAgentSession } from '../agent/session.js';

// 拼接地址，避免测试源码里出现裸 URL 字面量被外部工具改写。
const ORIGIN = 'http' + '://127.0.0.1:5173';
const LOCAL = 'http' + '://localhost:5173';

describe('agent delivery contract', () => {
  it('collects node ids from apply, run and batch results without duplicates', () => {
    expect(collectNodeIds({ ok: true, result: { affectedNodeIds: ['a', 'b'], nodeId: 'a' } })).toEqual(['a', 'b']);
    expect(collectNodeIds({ ok: true, result: { runs: [{ nodeId: 'x', ok: true }, { nodeId: 'y', ok: false }] } })).toEqual(['x']);
    expect(collectNodeIds({ nodeId: 'bad id with spaces' })).toEqual([]);
  });

  it('builds a focus link on the hash app route and rejects non-http origins', () => {
    expect(buildCanvasUrl(ORIGIN + '/some/path', 'p1', ['n1', 'n2'])).toBe(ORIGIN + '/#/app?project=p1&focus=n1%2Cn2');
    expect(buildCanvasUrl(ORIGIN, 'p1')).toBe(ORIGIN + '/#/app?project=p1');
    expect(buildCanvasUrl('file' + ':///etc/passwd', 'p1')).toBeNull();
    expect(buildCanvasUrl(null, 'p1')).toBeNull();
  });

  it('returns a takeover delivery for successful write commands only', () => {
    const response = { ok: true, result: { projectId: 'p1', affectedNodeIds: ['n1'] } };
    expect(buildDelivery({ command: 'workflow.apply', response, sessionId: 's1', webUrl: LOCAL })).toEqual({
      sessionId: 's1', projectId: 'p1', canvasUrl: LOCAL + '/#/app?project=p1&focus=n1', nodeIds: ['n1'],
    });
    expect(buildDelivery({ command: 'workflow.inspect', response })).toBeNull();
    expect(buildDelivery({ command: 'workflow.apply', response: { ok: false } })).toBeNull();
    expect(buildDelivery({ command: 'workflow.apply', response: { ok: true } })).toBeNull();
    expect(buildDelivery({ command: 'workflow.apply', response: { ok: true, confirmation: { required: true } } })).toBeNull();
    expect(buildDelivery({ command: 'workflow.node.run', response: { ok: true, result: { nodeId: 'n2' } }, projectId: 'p2' })).toMatchObject({ projectId: 'p2', canvasUrl: null, nodeIds: ['n2'] });
  });

  it('attaches the delivery to session results and tags activity with node ids', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 1000, webUrl: () => ORIGIN });
    let event = '';
    const response = { writeHead() {}, write(value) { event += value; }, on() {} };
    session.openEvents(new URL(ORIGIN + '/events?clientId=browser-1'), response);
    session.updateSnapshot({ id: 'project-1' }, 'browser-1');
    const call = session.callCommand('workflow.node.run', { projectId: 'project-1', nodeId: 'node-1' }, 'cli', 'run-1', undefined, { agentIdentity: 'codex', hostSessionId: 'host-s1' });
    const payload = JSON.parse(event.match(/event: tool_call\ndata: (.+)\n\n/)?.[1] || '{}');
    session.resolveResult({ requestId: payload.requestId, clientId: 'browser-1', result: { ok: true, result: { projectId: 'project-1', nodeId: 'node-1' } } });
    await expect(call).resolves.toMatchObject({
      delivery: { sessionId: 'host-s1', projectId: 'project-1', nodeIds: ['node-1'], canvasUrl: ORIGIN + '/#/app?project=project-1&focus=node-1' },
    });
    expect(session.activityLog().at(-1)).toMatchObject({ command: 'workflow.node.run', status: 'ok', nodeIds: ['node-1'] });
  });
});
