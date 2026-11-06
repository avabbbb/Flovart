import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GenerationPlanCard, NO_REFUND_NOTICE, planCostLine, planSummaryLine } from '../components/GenerationPlanCard';
import { ConfirmHost } from '../components/ConfirmHost';
import type { GenerationGateDetails } from '../services/generationGate';
import { answerUiConfirm, getPendingUiConfirm, registerUiConfirmHost, requestUiConfirm, resetUiConfirmForTests } from '../services/uiConfirm';

const seedance: GenerationGateDetails = {
  serviceLabel: '方舟', modelLabel: 'Seedance 2.0', mediaType: 'video', taskCount: 1,
  routeLabel: 'seedance-2', resolution: '720p', durationSec: 8, aspectRatio: '16:9', nodeTitle: '镜头 1',
  estimatedCost: { amount: 0.32, currency: 'CNY' }, costBasis: 'pricing-rule',
  costComponents: [{ rate: 0.04, unit: 'video_second', units: 8, amount: 0.32 }],
};
const unpriced: GenerationGateDetails = { ...seedance, nodeTitle: '镜头 2', estimatedCost: null, costBasis: 'unknown', costComponents: undefined };

const card = (items: GenerationGateDetails[], mandate?: string) => renderToStaticMarkup(createElement(GenerationPlanCard, { plan: { items, mandate } }));
const occurrences = (html: string, text: string) => html.split(text).length - 1;

describe('GenerationPlanCard', () => {
  it('shows spec and the cost basis', () => {
    const html = card([seedance]);
    expect(html).toContain('720p · 8秒 · 16:9 · 1 个任务');
    expect(planCostLine(seedance)).toBe('¥0.04/秒 × 8 = ¥0.32（预估）');
    expect(html).toContain('¥0.04/秒 × 8 = ¥0.32（预估）');
    expect(occurrences(html, NO_REFUND_NOTICE)).toBe(1);
    expect(occurrences(card([seedance, unpriced]), NO_REFUND_NOTICE)).toBe(1);
  });

  it('says the cost is unknown without a pricing rule', () => {
    expect(card([unpriced])).toContain('未知（以 AI 服务账单为准）');
  });

  it('lists references with status and does not repeat their blocker', () => {
    const html = card([{
      ...seedance,
      references: [{ title: 'ref.mp4', kind: 'video', durationSec: 16, status: 'block', message: '参考视频时长超出范围' }],
      blockers: [{ code: 'reference-limit', message: '参考视频时长超出范围' }],
    }]);
    expect(html).toContain('ref.mp4');
    expect(html).toContain('data-status="block"');
    expect(occurrences(html, '>参考视频时长超出范围<')).toBe(1);
    expect(html).not.toContain('data-kind="blocker"');
  });

  it('still lists blockers not shown on a reference row', () => {
    const html = card([{
      ...seedance,
      references: [{ title: 'ref.mp4', kind: 'video', durationSec: 16, status: 'block', message: '参考视频时长超出范围' }],
      blockers: [
        { code: 'reference-limit', message: '参考视频时长超出范围' },
        { code: 'budget', message: '超出预算上限' },
      ],
    }]);
    expect(html).toContain('data-kind="blocker"');
    expect(html).toContain('超出预算上限');
    expect(occurrences(html, '>参考视频时长超出范围<')).toBe(1);
  });

  it('summarizes a batch and flags partial unknown cost', () => {
    expect(planSummaryLine([seedance, unpriced])).toBe('共 2 个节点 · 2 个任务 · 预估 ¥0.32（部分未知）');
    const html = card([seedance, unpriced], '已用 8/10，本批 2 个');
    expect(html).toContain('镜头 2');
    expect(html).toContain('已用 8/10，本批 2 个');
  });
});

describe('ConfirmHost with a plan', () => {
  afterEach(() => resetUiConfirmForTests());

  it('renders the card, disables confirm and ignores a forced confirm', async () => {
    registerUiConfirmHost();
    const promise = requestUiConfirm({ title: '开始生成视频？', body: 'text-fallback', plan: { items: [seedance] }, confirmDisabled: true, timeoutMs: 0 });
    const html = renderToStaticMarkup(createElement(ConfirmHost));
    expect(html).toContain('¥0.32');
    expect(html).not.toContain('text-fallback');
    expect(html).toContain('disabled=""');
    const id = getPendingUiConfirm()!.id;
    answerUiConfirm(id, true);
    expect(getPendingUiConfirm()?.id).toBe(id);
    answerUiConfirm(id, false);
    await expect(promise).resolves.toBe(false);
  });

  it('keeps the plain body when there is no plan', () => {
    registerUiConfirmHost();
    void requestUiConfirm({ title: 't', body: 'plain', timeoutMs: 0 });
    const html = renderToStaticMarkup(createElement(ConfirmHost));
    expect(html).toContain('<p>plain</p>');
    expect(html).not.toContain('disabled=""');
  });
});
