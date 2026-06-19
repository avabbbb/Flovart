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
    const call = session.callCommand('workflow.inspect');
    close();
    await expect(call).rejects.toThrow('连接已断开');
  });
});
