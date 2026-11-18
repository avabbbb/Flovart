import { describe, expect, it } from 'vitest';
import { AGENT_ASK_SKIPPED, buildAgentAskForm, collectAgentAskAnswers } from '../components/agent/agentAskForm';

describe('ask 跳过', () => {
  it('跳过的必填题直接作答为「用户跳过」，不再拦提交', () => {
    const parsed = buildAgentAskForm({ questions: [
      { id: 'a', question: '一', type: 'single', options: [{ label: 'x' }] },
      { id: 'b', question: '二', type: 'single', options: [{ label: 'y' }] },
      { id: 'c', question: '三', type: 'text' },
    ] } as never);
    if (!parsed.ok) throw new Error('bad form');
    expect(collectAgentAskAnswers(parsed.form, { a: 'x', b: '', c: '好' })).toMatchObject({ ok: false });
    expect(collectAgentAskAnswers(parsed.form, { a: 'x', b: '', c: '好' }, {}, new Set(['b'])))
      .toEqual({ ok: true, data: { a: 'x', b: AGENT_ASK_SKIPPED, c: '好' } });
  });
});
