import { describe, expect, it, vi } from 'vitest';
import { buildAgentAskForm, collectAgentAskAnswers } from '../components/agent/agentAskForm';
import { ASK_TOOL_NAME, createBrowserAgentTools } from '../services/browserAgentKernel';

const spec = {
  title: '开工前确认几个关键点',
  context: ['这些决定会影响费用和分镜'],
  questions: [
    {
      id: 'plan',
      question: '整体方案',
      options: [
        { label: '15 秒竖屏 9:16', description: '3 段 × 5 秒，先 480p 试错', recommended: true },
        { value: 'wide', label: '30 秒横屏 16:9', recommended: true },
      ],
    },
    { id: 'subtitles', question: '字幕语言', type: 'multi' as const, options: [{ label: '中文', recommended: true }, { label: '英文', recommended: true }, { label: '无' }] },
    { id: 'outline', question: '大纲来源', required: false, multiline: true, placeholder: '没有就留空' },
  ],
};

describe('structured flovart_ask', () => {
  it('builds radio / checkbox / textarea fields with full-plan labels and recommended defaults', () => {
    const result = buildAgentAskForm(spec);
    if (!result.ok) throw new Error('error' in result ? result.error : 'failed');
    const { form } = result;
    expect(form.context).toEqual(['开工前确认几个关键点', '这些决定会影响费用和分镜']);
    expect(form.fields.map(field => field.kind)).toEqual(['radio', 'checkbox', 'textarea']);
    const plan = form.fields[0];
    if (plan.kind !== 'radio') throw new Error('expected radio');
    expect(plan.options[0]).toEqual({ value: '15 秒竖屏 9:16', label: '15 秒竖屏 9:16 — 3 段 × 5 秒，先 480p 试错', checked: true });
    // 单选只预选第一个推荐项
    expect(plan.options[1]).toMatchObject({ value: 'wide', checked: false });
    const subtitles = form.fields[1];
    if (subtitles.kind !== 'checkbox') throw new Error('expected checkbox');
    expect(subtitles.options.filter(option => option.checked).map(option => option.value)).toEqual(['中文', '英文']);
    expect(form.fields[2]).toMatchObject({ name: 'outline', required: false, placeholder: '没有就留空' });

    const answers = collectAgentAskAnswers(form, { plan: '15 秒竖屏 9:16', subtitles: ['中文'], outline: '' }, { subtitles: '日文' });
    expect(answers).toEqual({ ok: true, data: { plan: '15 秒竖屏 9:16', subtitles: ['中文', '日文'] } });
  });

  it('rejects malformed questions', () => {
    expect(buildAgentAskForm({ questions: [] })).toMatchObject({ ok: false });
    expect(buildAgentAskForm({ questions: [{ id: 'a b', question: 'x' }] })).toMatchObject({ ok: false, error: expect.stringContaining('id') });
    expect(buildAgentAskForm({ questions: [{ id: 'a', question: 'x' }, { id: 'a', question: 'y' }] })).toMatchObject({ ok: false, error: expect.stringContaining('重复') });
    expect(buildAgentAskForm({ questions: [{ id: 'a', question: 'x', type: 'single' }] })).toMatchObject({ ok: false, error: expect.stringContaining('options') });
    expect(buildAgentAskForm({ questions: [{ id: 'a', question: 'x', options: [{ label: '1' }, { label: '1' }] }] })).toMatchObject({ ok: false, error: expect.stringContaining('重复') });
  });

  it('sends a ready form to the host and keeps html as a fallback', async () => {
    const ask = vi.fn(async () => ({ ok: true as const, data: { plan: 'wide' } }));
    const tools = createBrowserAgentTools({ projectId: 'p', confirm: vi.fn(async () => true), ask, activeChangeSetId: 'turn' });
    const tool = tools.find(item => item.name === ASK_TOOL_NAME)!;
    const result = await tool.execute('call', spec as never, undefined as never);
    const request = (ask.mock.calls[0] as unknown[])[0] as { form?: { fields: unknown[] }; html?: string };
    expect(request.html).toBeUndefined();
    expect(request.form?.fields).toHaveLength(3);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({ ok: true, data: { plan: 'wide' } });

    await expect(tool.execute('call', { questions: [{ id: 'x', question: 'q', type: 'multi' }] } as never, undefined as never)).rejects.toThrow(/options/);
    await expect(tool.execute('call', {} as never, undefined as never)).rejects.toThrow(/questions/);
  });
});
