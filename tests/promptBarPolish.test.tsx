import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PromptBar } from '../components/PromptBar';

type EnhanceFn = NonNullable<ComponentProps<typeof PromptBar>['onEnhancePrompt']>;
type EnhanceResult = Awaited<ReturnType<EnhanceFn>>;

// 测试只关心 enhancedPrompt 字段，其余结果字段与润色写回无关。
const enhanceReturning = (enhancedPrompt: string) => vi.fn<EnhanceFn>(async () => ({ enhancedPrompt }) as unknown as EnhanceResult);

function Harness({ onEnhancePrompt, onAutoEnhanceToggle, onPrompt }: { onEnhancePrompt: EnhanceFn; onAutoEnhanceToggle?: () => void; onPrompt: (value: string) => void }) {
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
});
