import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptBar } from '../components/PromptBar';
import { translations } from '../utils/translations';

const zhT = (key: string, ...args: unknown[]): string => {
  const value = key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, translations.zho as unknown);
  return String(typeof value === 'function' ? value(...args) : (value ?? key));
};

describe('PromptBar first-run setup', () => {
  it('turns the generate action into an AI service setup CTA when no service is configured', () => {
    const onOpenSettings = vi.fn();
    render(
      <PromptBar
        theme="light"
        prompt="一只猫"
        setPrompt={vi.fn()}
        onGenerate={vi.fn()}
        onOpenSettings={onOpenSettings}
        isLoading={false}
        isSelectionActive={false}
        selectedElementCount={0}
        userEffects={[]}
        t={zhT}
        onAddUserEffect={vi.fn()}
        onDeleteUserEffect={vi.fn()}
        generationMode="image"
        setGenerationMode={vi.fn()}
        videoAspectRatio="16:9"
        setVideoAspectRatio={vi.fn()}
      />,
    );

    const action = screen.getByRole('button', { name: '添加 AI 服务' });
    expect(action).not.toBeDisabled();
    fireEvent.click(action);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
