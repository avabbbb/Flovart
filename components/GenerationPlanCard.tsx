import type { GenerationGateDetails, PlanNotice, PlanReference } from '../services/generationGate';
import type { UiConfirmPlan } from '../services/uiConfirm';

type Currency = 'USD' | 'CNY';

const UNIT_LABEL: Record<string, string> = { video_second: '秒', image: '张' };
const STATUS_ICON: Record<PlanReference['status'], string> = { ok: '✓', warn: '!', block: '✕' };

const symbol = (currency: Currency) => (currency === 'CNY' ? '¥' : '$');
const money = (currency: Currency, amount: number) => symbol(currency) + amount.toFixed(2);

export function planSpecLine(item: GenerationGateDetails) {
  return [
    item.resolution,
    item.durationSec ? item.durationSec + '秒' : undefined,
    item.aspectRatio,
    item.taskCount + ' 个任务',
  ].filter(Boolean).join(' · ');
}

/** 例：¥0.04/秒 × 8 = ¥0.32（预估）。只来自用户配置的 pricingRules，没有就明说未知。 */
export function planCostLine(item: GenerationGateDetails) {
  const cost = item.estimatedCost;
  if (!cost) return '未知（以 AI 服务账单为准）';
  const basis = item.costComponents
    ?.map(component => symbol(cost.currency) + component.rate + '/' + (UNIT_LABEL[component.unit] ?? component.unit) + ' × ' + component.units)
    .join(' + ');
  return (basis ? basis + ' = ' : '') + money(cost.currency, cost.amount) + '（预估）';
}

export function planSummaryLine(items: readonly GenerationGateDetails[]) {
  const tasks = items.reduce((sum, item) => sum + item.taskCount, 0);
  const totals = new Map<Currency, number>();
  let unknown = false;
  for (const item of items) {
    if (!item.estimatedCost) { unknown = true; continue; }
    const { currency, amount } = item.estimatedCost;
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
  }
  const known = [...totals].map(([currency, amount]) => money(currency, amount)).join(' + ');
  const cost = !known ? '预估额度未知' : '预估 ' + known + (unknown ? '（部分未知）' : '');
  return '共 ' + items.length + ' 个节点 · ' + tasks + ' 个任务 · ' + cost;
}

function referenceMeta(reference: PlanReference) {
  return [
    reference.durationSec ? reference.durationSec + 's' : undefined,
    reference.sizeBytes ? (reference.sizeBytes / 1024 / 1024).toFixed(1) + 'MB' : undefined,
    reference.width && reference.height ? reference.width + '×' + reference.height : undefined,
  ].filter(Boolean).join(' · ');
}

function Notices({ kind, notices }: { kind: 'warning' | 'blocker'; notices?: PlanNotice[] }) {
  if (!notices?.length) return null;
  return (
    <ul className="iris-plannotices" data-kind={kind}>
      {notices.map((notice, index) => <li key={notice.code + index}>{notice.message}</li>)}
    </ul>
  );
}

function PlanItem({ item, showTitle }: { item: GenerationGateDetails; showTitle: boolean }) {
  const spec = planSpecLine(item);
  const shownOnReference = new Set(item.references?.filter(reference => reference.status !== 'ok' && reference.message).map(reference => reference.message));
  const blockers = item.blockers?.filter(notice => !shownOnReference.has(notice.message));
  return (
    <section className="iris-planitem">
      {showTitle && item.nodeTitle && <div className="iris-plantitle">{item.nodeTitle}</div>}
      <div className="iris-planrow">{[item.serviceLabel, item.modelLabel, item.routeLabel].filter(Boolean).join(' · ')}</div>
      {spec && <div className="iris-planrow">{spec}</div>}
      {item.references?.length ? (
        <ul className="iris-planrefs">
          {item.references.map((reference, index) => {
            const meta = referenceMeta(reference);
            return (
              <li key={reference.title + index} data-status={reference.status} title={reference.message}>
                <span aria-hidden="true">{STATUS_ICON[reference.status]}</span> {reference.title}
                {meta && <span className="iris-planmuted"> {meta}</span>}
                {reference.message && reference.status !== 'ok' && <div className="iris-planmuted">{reference.message}</div>}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="iris-planrow" data-basis={item.costBasis ?? 'unknown'}>预估额度：{planCostLine(item)}</div>
      {item.budget && (
        <div className="iris-planrow" data-exceed={item.budget.wouldExceed || undefined}>
          预算：已用 {money(item.budget.currency, item.budget.used)} / {money(item.budget.currency, item.budget.limit)}
        </div>
      )}
      <Notices kind="warning" notices={item.warnings} />
      <Notices kind="blocker" notices={blockers} />
    </section>
  );
}

/** 每张卡只显示一次。措辞保守：不承诺退款，也不断言一定扣费，以服务商账单为准（与 workflowGeneration 的 STOPPED_BILLING_UNKNOWN 一致）。 */
export const NO_REFUND_NOTICE = '提交后服务商可能立即开始计费；中途停止或取消，已消耗的额度通常不会退回，实际扣费以 AI 服务账单为准。';

/** 生成前计划卡：只展示，不改参数；确认/取消由 ConfirmHost 负责。 */
export function GenerationPlanCard({ plan }: { plan: UiConfirmPlan }) {
  const batch = plan.items.length > 1;
  return (
    <div className="iris-plan">
      {plan.items.map((item, index) => <PlanItem key={index} item={item} showTitle={batch} />)}
      {batch && <div className="iris-plansummary">{planSummaryLine(plan.items)}</div>}
      <div className="iris-planmuted iris-plannorefund">{NO_REFUND_NOTICE}</div>
      {plan.mandate && <div className="iris-planmandate">{plan.mandate}</div>}
    </div>
  );
}
