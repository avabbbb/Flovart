import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TokenUsageSection, usageRangeStart, usageTabLabel } from '../components/TokenUsageSection';
import { clearTokenUsage, recordTokenUsage, recordUsageMissing, setTokenUsageStorage } from '../services/tokenUsage';

const identity = (key: string) => key;

describe('TokenUsageSection', () => {
  beforeEach(() => { setTokenUsageStorage(undefined); clearTokenUsage(); });

  it('shows empty state and falls back to built-in labels', () => {
    render(<TokenUsageSection t={identity} />);
    expect(screen.getByTestId('token-usage-empty')).toBeTruthy();
    expect(usageTabLabel(identity)).toBe('用量');
  });

  it('summarizes recorded usage and reacts to new records', () => {
    render(<TokenUsageSection t={identity} />);
    act(() => {
      recordTokenUsage({ provider: 'openai', model: 'gpt-test', source: 'text', raw: { usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 } } });
    });
    expect(screen.getByTestId('token-usage-table').textContent).toContain('gpt-test');
    expect(screen.getByTestId('token-usage-totals').textContent).toContain((1500).toLocaleString());
    fireEvent.click(screen.getByTestId('token-usage-range-all'));
    expect(screen.getByTestId('token-usage-table')).toBeTruthy();
  });

  it('filters by source and shows streaming calls that returned no usage', () => {
    render(<TokenUsageSection t={identity} />);
    act(() => {
      recordTokenUsage({ provider: 'openai', model: 'gpt-text', source: 'text', raw: { usage: { prompt_tokens: 10, completion_tokens: 5 } } });
      recordTokenUsage({ provider: 'google', model: 'gemini-vision', source: 'reverse-prompt-stream', usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 }, outcome: 'aborted' });
      recordUsageMissing({ provider: 'openai', model: 'gpt-5.4-mini', source: 'reverse-prompt-stream', outcome: 'ok' });
    });
    expect(screen.getByTestId('token-usage-missing').textContent).toContain('1');
    const streamTab = screen.getByTestId('token-usage-source-reverse-prompt-stream');
    expect(streamTab.textContent).toBe('图片反推（流式）');
    fireEvent.click(streamTab);
    const table = screen.getByTestId('token-usage-table').textContent || '';
    expect(table).toContain('gemini-vision');
    expect(table).not.toContain('gpt-text');
    fireEvent.click(screen.getByTestId('token-usage-source-text'));
    expect(screen.queryByTestId('token-usage-missing')).toBeNull();
  });

  it('computes range starts', () => {
    const now = new Date(2026, 9, 30, 13, 5);
    expect(usageRangeStart('today', now)?.getHours()).toBe(0);
    expect(usageRangeStart('7d', now)?.getTime()).toBe(now.getTime() - 7 * 86400000);
    expect(usageRangeStart('all', now)).toBeUndefined();
  });
});
