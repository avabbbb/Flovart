import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { isEnhanceResultCurrent, PromptBar } from '../components/PromptBar';

type Props = ComponentProps<typeof PromptBar>;
type EnhanceFn = NonNullable<Props['onEnhancePrompt']>;
type EnhanceResult = Awaited<ReturnType<EnhanceFn>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const props = (overrides: Partial<Props> = {}): Props => ({
  t: (key: string) => key,
  theme: 'light',
  prompt: '一只猫',
  setPrompt: vi.fn(),
  onGenerate: vi.fn(),
  isLoading: false,
  isSelectionActive: false,
  selectedElementCount: 0,
  userEffects: [],
  onAddUserEffect: vi.fn(),
  onDeleteUserEffect: vi.fn(),
  generationMode: 'image',
  setGenerationMode: vi.fn(),
  videoAspectRatio: '16:9',
  setVideoAspectRatio: vi.fn(),
  isAutoEnhanceEnabled: false,
  ...overrides,
} as Props);

const pendingEnhance = () => {
  const gate = deferred<EnhanceResult>();
  const onEnhancePrompt = vi.fn<EnhanceFn>(() => gate.promise);
  const finish = (enhancedPrompt: string) => act(async () => {
    gate.resolve({ enhancedPrompt } as unknown as EnhanceResult);
    await gate.promise;
  });
  return { onEnhancePrompt, finish };
};

describe('isEnhanceResultCurrent', () => {
  const request = { id: 2, basePrompt: 'a', snapshotKey: 'k' };
  it('accepts only the latest request on the same key with unchanged text', () => {
    expect(isEnhanceResultCurrent(request, { latestRequestId: 2, snapshotKey: 'k', prompt: 'a' })).toBe(true);
    expect(isEnhanceResultCurrent(request, { latestRequestId: 3, snapshotKey: 'k', prompt: 'a' })).toBe(false);
    expect(isEnhanceResultCurrent(request, { latestRequestId: 2, snapshotKey: 'other', prompt: 'a' })).toBe(false);
    expect(isEnhanceResultCurrent(request, { latestRequestId: 2, snapshotKey: 'k', prompt: 'ab' })).toBe(false);
  });
});

describe('PromptBar enhance lifecycle', () => {
  it('drops a polish result that lands after the user edited the prompt', async () => {
    const { onEnhancePrompt, finish } = pendingEnhance();
    const setPrompt = vi.fn();
    const view = render(<PromptBar {...props({ setPrompt, onEnhancePrompt })} />);
    fireEvent.click(screen.getByRole('button', { name: '润色提示词' }));
    expect(onEnhancePrompt).toHaveBeenCalledTimes(1);

    view.rerender(<PromptBar {...props({ setPrompt, onEnhancePrompt, prompt: '一只狗' })} />);
    await finish('过期的润色结果');

    expect(setPrompt).not.toHaveBeenCalledWith('过期的润色结果');
    expect(screen.queryByRole('button', { name: '还原提示词' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '润色提示词' })).not.toBeDisabled());
  });

  it('drops a polish result that lands after the snapshot key switched', async () => {
    const { onEnhancePrompt, finish } = pendingEnhance();
    const setPrompt = vi.fn();
    const view = render(<PromptBar {...props({ setPrompt, onEnhancePrompt, promptSnapshotKey: 'state-flow:a' })} />);
    fireEvent.click(screen.getByRole('button', { name: '润色提示词' }));

    view.rerender(<PromptBar {...props({ setPrompt, onEnhancePrompt, promptSnapshotKey: 'state-flow:b' })} />);
    await finish('另一个节点的结果');

    expect(setPrompt).not.toHaveBeenCalledWith('另一个节点的结果');
    expect(screen.queryByRole('button', { name: '还原提示词' })).not.toBeInTheDocument();
  });

  it('ignores translate while a polish is in flight', async () => {
    const { onEnhancePrompt, finish } = pendingEnhance();
    const setPrompt = vi.fn();
    render(<PromptBar {...props({ setPrompt, onEnhancePrompt })} />);
    fireEvent.click(screen.getByRole('button', { name: '润色提示词' }));
    fireEvent.click(screen.getByTitle('翻译提示词'));

    expect(onEnhancePrompt).toHaveBeenCalledTimes(1);
    expect(onEnhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ mode: 'smart' }));
    await finish('润色结果');
    await waitFor(() => expect(setPrompt).toHaveBeenCalledWith('润色结果'));
  });
});

describe('PromptBar submit', () => {
  function GenerateHarness({ onGenerate }: { onGenerate: () => void }) {
    const [isLoading, setIsLoading] = useState(false);
    return <PromptBar {...props({ providerOptional: true, isLoading, onGenerate: () => { onGenerate(); setIsLoading(true); } })} />;
  }

  it('calls onGenerate once for a double submit', async () => {
    const onGenerate = vi.fn();
    render(<GenerateHarness onGenerate={onGenerate} />);
    const button = screen.getByRole('button', { name: 'promptBar.generate' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    fireEvent.click(button);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });
});

describe('PromptBar drag overlay', () => {
  it('clears the overlay when the drag ends outside the bar', () => {
    const { container } = render(<PromptBar {...props({ onAddAttachments: vi.fn() })} />);
    const shell = container.firstElementChild!.firstElementChild!;
    fireEvent.dragEnter(shell, { dataTransfer: { items: [{ type: 'image/png' }], files: [] } });
    expect(screen.getByText(/松手上传参考媒体|Release to upload reference media/)).toBeInTheDocument();

    act(() => { window.dispatchEvent(new Event('dragend')); });
    expect(screen.queryByText(/松手上传参考媒体|Release to upload reference media/)).not.toBeInTheDocument();
  });
});
