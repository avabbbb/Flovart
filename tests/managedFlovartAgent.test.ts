import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManagedFlovartAgentClient } from '../services/managedFlovartAgent';

afterEach(() => vi.unstubAllGlobals());

describe('Managed Flovart Agent client', () => {
  it('consumes the built-in Agent event stream through the desktop-only token', async () => {
    const encoder = new TextEncoder();
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: status\ndata: {"running":true}\n\n'));
        controller.enqueue(encoder.encode('event: text-delta\ndata: {"delta":"制作计划"}\n\n'));
        controller.enqueue(encoder.encode('event: snapshot\ndata: {"sessionId":"session-1","projectId":"project-1","messages":[],"running":false}\n\n'));
        controller.close();
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetch);
    const client = new ManagedFlovartAgentClient({
      state: 'ready',
      url: 'http://127.0.0.1:17372',
      token: 'desktop-token',
      managed: true,
    });
    const events: unknown[] = [];

    await client.turn('project-1', '制作一个解释视频', event => events.push(event));

    expect(events).toEqual([
      { type: 'status', running: true },
      { type: 'text-delta', delta: '制作计划' },
      {
        type: 'snapshot',
        snapshot: {
          sessionId: 'session-1',
          projectId: 'project-1',
          messages: [],
          running: false,
        },
      },
    ]);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17372/agent/flovart/turn', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Flovart-Agent-Token': 'desktop-token' }),
      body: JSON.stringify({ projectId: 'project-1', prompt: '制作一个解释视频' }),
    }));
  });
});
