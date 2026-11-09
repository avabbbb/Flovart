import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PromptBar } from '../components/PromptBar';

type EnhanceFn = NonNullable<ComponentProps<typeof PromptBar>['onEnhancePrompt']>;
type EnhanceResult = Awaited<ReturnType<EnhanceFn>>;

// 测试只关心 enhancedPrompt 字段，其余结果字段与润色写回无关。
const enhanceReturning = (enhancedPrompt: string) => vi.fn<EnhanceFn>(async () => ({ enhancedPrompt }) as unknown as EnhanceResult);

function Harness({ onEnhancePrompt, onAutoEnhanceToggle, onPrompt, promptSnapshotKey }: { onEnhancePrompt: EnhanceFn; onAutoEnhanceToggle?: () => void; onPrompt: (value: string) => void; promptSnapshotKey?: string }) {
  const [prompt, setPrompt] = useState('一只猫');
  const mounted = useRef(false);
  // 只上报真正变化后的提示词；编辑器挂载时会用原值同步一次。
  useEffect(() => {
    if (mounted.current) onPrompt(prompt);
    mounted.current = true;
  }, [prompt, onPrompt]);
  return (
    <PromptBar
      t={(key: string) => key}
      theme="light"
      prompt={prompt}
      setPrompt={setPrompt}
      onGenerate={vi.fn()}
      isLoading={false}
      isSelectionActive={false}
      selectedElementCount={0}
      userEffects={[]}
      onAddUserEffect={vi.fn()}
      onDeleteUserEffect={vi.fn()}
      generationMode="image"
      setGenerationMode={vi.fn()}
      videoAspectRatio="16:9"
      setVideoAspectRatio={vi.fn()}
      onEnhancePrompt={onEnhancePrompt}
      isAutoEnhanceEnabled={false}
      onAutoEnhanceToggle={onAutoEnhanceToggle}
      promptSnapshotKey={promptSnapshotKey}
    />
  );
}

describe('PromptBar one-shot polish', () => {
  it('writes the enhanced prompt back and restores the original', async () => {
    const onEnhancePrompt = enhanceReturning('一只橘猫趴在窗台，午后阳光，电影感');
    const onPrompt = vi.fn();
    render(<Harness onEnhancePrompt={onEnhancePrompt} onPrompt={onPrompt} />);

    expect(screen.queryByRole('button', { name: '还原提示词' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '润色提示词' }));

    await waitFor(() => expect(onPrompt).toHaveBeenLastCalledWith('一只橘猫趴在窗台，午后阳光，电影感'));
    expect(onEnhancePrompt).toHaveBeenCalledWith(expect.objectContaining({ prompt: '一只猫', mode: 'smart' }));

    fireEvent.click(await screen.findByRole('button', { name: '还原提示词' }));
    await waitFor(() => expect(onPrompt).toHaveBeenLastCalledWith('一只猫'));
    expect(screen.queryByRole('button', { name: '还原提示词' })).not.toBeInTheDocument();
  });

  it('keeps the prompt unchanged when enhancement returns nothing', async () => {
    const onEnhancePrompt = enhanceReturning('  ');
    const onPrompt = vi.fn();
    render(<Harness onEnhancePrompt={onEnhancePrompt} onPrompt={onPrompt} />);

    fireEvent.click(screen.getByRole('button', { name: '润色提示词' }));
    await waitFor(() => expect(onEnhancePrompt).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: '润色提示词' })).not.toBeDisabled());
    expect(onPrompt).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '还原提示词' })).not.toBeInTheDocument();
  });

  it('moves the auto-enhance switch into the more menu', () => {
    const onAutoEnhanceToggle = vi.fn();
    render(<Harness onEnhancePrompt={enhanceReturning('')} onAutoEnhanceToggle={onAutoEnhanceToggle} onPrompt={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /生成前自动润色/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('更多操作'));
    fireEvent.click(screen.getByRole('button', { name: /生成前自动润色/ }));
    expect(onAutoEnhanceToggle).toHaveBeenCalledTimes(1);
  });

  it('keeps the restore button after the node prompt bar remounts', async () => {
    const onEnhancePrompt = enhanceReturning('一只橘猫，电影感');
    const first = render(<Harness onEnhancePrompt={onEnhancePrompt} onPrompt={vi.fn()} promptSnapshotKey="workflow-node:test-remount" />);
    fireEvent.click(screen.getByRole('button', { name: '润色提示词' }));
    await screen.findByRole('button', { name: '还原提示词' });
    first.unmount();

    render(<Harness onEnhancePrompt={onEnhancePrompt} onPrompt={vi.fn()} promptSnapshotKey="workflow-node:test-remount" />);
    expect(screen.getByRole('button', { name: '还原提示词' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '还原提示词' }));
    expect(screen.queryByRole('button', { name: '还原提示词' })).not.toBeInTheDocument();
  });

  it('restores the original text after polishing twice', async () => {
    const onEnhancePrompt = vi.fn<EnhanceFn>()
      .mockResolvedValueOnce({ enhancedPrompt: '一只橘猫，电影感' } as unknown as EnhanceResult)
      .mockResolvedValueOnce({ enhancedPrompt: '一只橘猫，午后阳光，电影感' } as unknown as EnhanceResult);
    const onPrompt = vi.fn();
    render(<Harness onEnhancePrompt={onEnhancePrompt} onPrompt={onPrompt} />);

    fireEvent.click(screen.getByRole('button', { name: '润色提示词' }));
    await waitFor(() => expect(onPrompt).toHaveBeenLastCalledWith('一只橘猫，电影感'));
    await waitFor(() => expect(screen.getByRole('button', { name: '润色提示词' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '润色提示词' }));
    await waitFor(() => expect(onPrompt).toHaveBeenLastCalledWith('一只橘猫，午后阳光，电影感'));

    fireEvent.click(await screen.findByRole('button', { name: '还原提示词' }));
    await waitFor(() => expect(onPrompt).toHaveBeenLastCalledWith('一只猫'));
  });

  it('does not open the @ suggestion popup when the polished text contains a mention label', async () => {
    const onEnhancePrompt = enhanceReturning('参考 @视频1 的运镜，一只橘猫在窗台');
    const onPrompt = vi.fn();
    render(<Harness onEnhancePrompt={onEnhancePrompt} onPrompt={onPrompt} />);

    fireEvent.click(screen.getByRole('button', { name: '润色提示词' }));
    await waitFor(() => expect(onPrompt).toHaveBeenLastCalledWith(expect.stringContaining('一只橘猫在窗台')));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByText('没有匹配的素材或节点')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '还原提示词' })).toBeInTheDocument();
  });
});
