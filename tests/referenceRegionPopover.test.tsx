import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { WorkflowNodePromptBar } from '../components/workflow/WorkflowNodePromptBar';
import { translations } from '../utils/translations';

const t = (key: string): string => {
  const value = key.split('.').reduce<unknown>((current, part) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined), translations.zho as unknown);
  return String(typeof value === 'function' ? value() : (value ?? key));
};

afterEach(cleanup);

describe('region reference popover from the Prompt Bar chip', () => {
  it('frames a region on the referenced image and writes it into the chip attrs and the prompt intent', () => {
    const image = createWorkflowNode('img-a', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/a.png', mimeType: 'image/png' });
    const target = createWorkflowNode('n1', 'image', { x: 400, y: 0 }, {
      prompt: '看 @图片1',
      richTextDocument: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '看 ' }, { type: 'mediaMention', attrs: { id: 'img-a', label: '图片1', elementType: 'image' } }] }] } as never,
      config: { mode: 'image' },
    });
    const onChange = vi.fn();
    const onPromptIntent = vi.fn();
    render(<WorkflowNodePromptBar node={target} nodes={[image, target]} connections={[{ id: 'c1', fromNodeId: 'img-a', toNodeId: 'n1' }]}
      t={t} theme="light" language="zho" userApiKeys={[]} dynamicModelOptions={{ text: [], image: [], video: [] }}
      onChange={onChange} onRun={vi.fn()} onPromptIntent={onPromptIntent} onDisconnectReference={vi.fn()} />);

    fireEvent.click(screen.getByTestId('reference-chip-focus'));
    const popover = screen.getByTestId('reference-region-popover');
    const frame = popover.querySelector('.workflow-region-popover__frame') as HTMLElement;
    frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(frame, { clientX: 50, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 150, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(frame, { clientX: 150, clientY: 60, pointerId: 1 });
    expect(screen.getByTestId('reference-region-box').style.width).toBe('50%');
    fireEvent.click(screen.getByText('引用这块区域'));

    expect(screen.queryByTestId('reference-region-popover')).toBeNull();
    const patch = onChange.mock.calls.at(-1)![0];
    const mention = patch.richTextDocument.content[0].content[1];
    expect(mention.attrs.region).toEqual({ x: 0.25, y: 0.1, w: 0.5, h: 0.5 });
    const intent = onPromptIntent.mock.calls.at(-1)![0];
    expect(intent.mentions).toEqual([expect.objectContaining({ id: 'img-a', region: { x: 0.25, y: 0.1, w: 0.5, h: 0.5 } })]);
  });
});
