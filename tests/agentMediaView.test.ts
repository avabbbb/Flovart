import { describe, expect, it } from 'vitest';
import { createBrowserAgentTools, MEDIA_VIEW_TOOL_NAME, toOpenAIMessages } from '../services/browserAgentKernel';

const PNG = 'iVBORw0KGgo=';

describe('agent media view', () => {
  it('moves tool-result images into a user message after the tool replies', () => {
    const messages = [
      { role: 'user', content: '看看 n1', timestamp: 1 },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'c1', name: MEDIA_VIEW_TOOL_NAME, arguments: { nodeIds: ['n1'] } },
          { type: 'toolCall', id: 'c2', name: 'flovart_todo', arguments: {} },
        ],
        timestamp: 2,
      },
      { role: 'toolResult', toolCallId: 'c1', toolName: MEDIA_VIEW_TOOL_NAME, isError: false, timestamp: 3, content: [{ type: 'text', text: 'n1：图片' }, { type: 'image', data: PNG, mimeType: 'image/jpeg' }] },
      { role: 'toolResult', toolCallId: 'c2', toolName: 'flovart_todo', isError: false, timestamp: 4, content: [{ type: 'text', text: 'ok' }] },
    ] as unknown as Parameters<typeof toOpenAIMessages>[0];

    const out = toOpenAIMessages(messages);
    expect(out.map(item => item.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'user']);
    const last = out[4].content as Array<Record<string, unknown>>;
    expect(last[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + PNG } });
  });

  it('flushes images when a tool call was left without result', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: MEDIA_VIEW_TOOL_NAME, arguments: {} }, { type: 'toolCall', id: 'c2', name: 'x', arguments: {} }], timestamp: 1 },
      { role: 'toolResult', toolCallId: 'c1', toolName: MEDIA_VIEW_TOOL_NAME, isError: false, timestamp: 2, content: [{ type: 'image', data: PNG, mimeType: 'image/png' }] },
    ] as unknown as Parameters<typeof toOpenAIMessages>[0];

    const out = toOpenAIMessages(messages);
    expect(out.map(item => item.role)).toEqual(['assistant', 'tool', 'tool', 'user']);
  });

  it('registers the media view tool only when nodes are readable', async () => {
    const confirm = async () => true;
    const without = createBrowserAgentTools({ projectId: 'p', confirm, activeChangeSetId: '' } as Parameters<typeof createBrowserAgentTools>[0]);
    expect(without.some(tool => tool.name === MEDIA_VIEW_TOOL_NAME)).toBe(false);

    const tools = createBrowserAgentTools({ projectId: 'p', confirm, activeChangeSetId: '', getNodes: () => [] } as Parameters<typeof createBrowserAgentTools>[0]);
    const view = tools.find(tool => tool.name === MEDIA_VIEW_TOOL_NAME);
    expect(view).toBeDefined();
    const result = await view!.execute('t1', { nodeIds: ['missing'] } as never);
    expect(result.content).toEqual([{ type: 'text', text: 'missing：节点不存在' }]);
  });
});
