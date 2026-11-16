import { describe, expect, it } from 'vitest';
import { quoteForSend, quotePreview, splitQuote, truncateText, withQuote } from '../components/agent/agentQuote';
import { displayUserTurnText } from '../components/agent/agentTurnText';
import { applyAgentTurnPreamble } from '../services/canvasSkillRecipe';

describe('agent quote reply', () => {
  it('prefixes every quoted line and keeps a blank line before the body', () => {
    expect(withQuote('改成 15 秒', '第一行\n第二行')).toBe('> 第一行\n> 第二行\n\n改成 15 秒');
    expect(withQuote('正文', '')).toBe('正文');
    expect(withQuote('正文', null)).toBe('正文');
    expect(withQuote('', '只有引文')).toBe('> 只有引文');
  });

  it('keeps paragraphs inside one quote block (blank lines become bare ">")', () => {
    const text = withQuote('继续', '段一\n\n段二');
    expect(text).toBe('> 段一\n>\n> 段二\n\n继续');
    expect(splitQuote(text)).toEqual({ quote: '段一\n\n段二', body: '继续' });
  });

  it('round-trips through the stored kernel text (preamble + quote + body)', () => {
    const stored = applyAgentTurnPreamble(withQuote('再补三张', '已提交 Canvas 生成任务（3 个）'), { creationMode: 'storyboard', preferredModel: null });
    const shown = displayUserTurnText(stored);
    expect(splitQuote(shown)).toEqual({ quote: '已提交 Canvas 生成任务（3 个）', body: '再补三张' });
  });

  it('only treats leading ">" lines as a quote', () => {
    expect(splitQuote('普通消息\n> 不是引用')).toEqual({ body: '普通消息\n> 不是引用' });
    expect(splitQuote('')).toEqual({ body: '' });
  });

  it('truncates long quotes for sending and previews them on one line', () => {
    const long = 'a'.repeat(3000);
    expect([...quoteForSend(long)].length).toBe(2000);
    expect(quoteForSend(long).endsWith('…')).toBe(true);
    expect(quoteForSend('短文\r\n\r\n\r\n下一段')).toBe('短文\n\n下一段');
    expect(quotePreview('第一行\n\n第二行')).toBe('第一行 第二行');
    expect([...quotePreview('字'.repeat(500), 20)].length).toBe(20);
  });

  it('does not split surrogate pairs when truncating', () => {
    expect(truncateText('😀😀😀😀', 3)).toBe('😀😀…');
    expect(truncateText('abc', 3)).toBe('abc');
  });
});
