// Read-only static HTML dashboard for the AIGC eval platform.
//
// One self-contained file: no scripts, no network, every value escaped. It
// shows the objective (rule graders) and subjective (blind 1–5 ratings) tracks
// side by side and never blends them into one number.

import { auditAgreement, GROUP_KEYS, objectiveRates, subjectiveRates } from './rates.mjs';

const SUBJECTIVE_DIMS = ['overall', 'motion', 'promptFollowing', 'aesthetics', 'preservation', 'audioQuality', 'avSync', 'audioPromptFollowing', 'narrative', 'taskFollowing'];
const DIM_LABEL = {
  overall: '整体', motion: '运动质量', promptFollowing: '提示遵循', aesthetics: '美学', preservation: '原图保持',
  audioQuality: '音频质量', avSync: '音画同步', audioPromptFollowing: '音频提示遵循', narrative: '叙事', taskFollowing: '多模态任务遵循（1–3）',
};
const FLAG_LABEL = { usability: '可用率 ≥3', satisfaction: '满意率 ≥4', delight: '惊喜率 =5', follow: '完全遵循 =3', partial: '部分及以上 ≥2' };
const GROUP_LABEL = { domain: '任务域', scenario: '场景', difficulty: '难度', split: '划分', model: '模型' };

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const pct = value => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`);
const cell = entry => (entry?.total
  ? `${pct(entry.rate)} <span class="ci">[${pct(entry.interval.low)}, ${pct(entry.interval.high)}] n=${entry.total}</span>`
  : '<span class="ci">—</span>');

function table(head, rows) {
  return `<table><thead><tr>${head.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/** Build the JSON model the dashboard renders (also written next to it). */
export function buildReportModel({ items, takes, gradeRun, ratings, generatedAt = new Date().toISOString() }) {
  const grades = gradeRun?.grades ?? [];
  const withdrawals = gradeRun?.withdrawals ?? [];
  const withdrawnItems = new Set([...withdrawals.map(entry => entry.itemId), ...items.filter(item => item.status && item.status !== 'active').map(item => item.id)]);
  const objective = objectiveRates(grades, items, takes);
  const subjective = {};
  for (const raterKind of ['human', 'judge']) {
    for (const dim of SUBJECTIVE_DIMS) {
      const result = subjectiveRates(ratings, items, takes, { dim, raterKind, withdrawnItems });
      if (result.overall.n) (subjective[raterKind] ??= {})[dim] = result;
    }
  }
  return {
    generatedAt,
    gradeRun: gradeRun ? { runId: gradeRun.runId, createdAt: gradeRun.createdAt, meta: gradeRun.meta } : null,
    counts: {
      items: items.length,
      activeItems: items.filter(item => (item.status ?? 'active') === 'active').length,
      takes: takes.length,
      ratings: ratings.length,
      bySplit: Object.fromEntries(['dev', 'test', 'holdout'].map(split => [split, items.filter(item => item.split === split).length])),
    },
    objective,
    subjective,
    audit: auditAgreement(ratings),
    withdrawn: [
      ...withdrawals.map(entry => ({ itemId: entry.itemId, reason: entry.reason })),
      ...items.filter(item => item.status && item.status !== 'active').map(item => ({ itemId: item.id, reason: `${item.status}: ${item.statusReason}` })),
    ],
    failures: grades.filter(grade => grade.verdict === 'fail' || grade.verdict === 'error').map(grade => ({
      itemId: grade.itemId, takeId: grade.takeId, verdict: grade.verdict,
      problems: grade.results.filter(result => result.verdict === 'fail' || result.verdict === 'error').map(result => `${result.grader}: ${result.detail}`),
    })),
  };
}

export function renderDashboard(model) {
  const o = model.objective;
  const sections = [];
  sections.push(`<section><h2>客观轨（规则 grader）</h2>
<p>整体通过率 ${cell(o.overall)}；撤回 ${o.withdrawn} 个 take、grader 无法运行 ${o.errors} 个（都不进分母）。</p>
${table(['Grader', '通过率', '失败', '无法运行'], Object.entries(o.byGrader).map(([id, entry]) => [escapeHtml(id), cell(entry), entry.failed, entry.error]))}
${GROUP_KEYS.map(key => `<h3>按${escapeHtml(GROUP_LABEL[key])}</h3>${table([GROUP_LABEL[key], '通过率 [95% Wilson]'], o.byGroup[key].map(row => [escapeHtml(row.key), cell(row)]))}`).join('\n')}
</section>`);
  for (const [raterKind, dims] of Object.entries(model.subjective)) {
    const title = raterKind === 'human' ? '主观轨（盲评，人工）' : '主观轨（Judge，回放 / 记录）';
    const blocks = Object.entries(dims).map(([dim, result]) => {
      const head = ['分组', ...result.flags.map(flag => FLAG_LABEL[flag])];
      const overall = [['全部', ...result.flags.map(flag => cell(result.overall[flag]))]];
      const groups = GROUP_KEYS.flatMap(key => result.byGroup[key].map(row => [`${escapeHtml(GROUP_LABEL[key])}：${escapeHtml(row.key)}`, ...result.flags.map(flag => cell(row[flag]))]));
      return `<h3>${escapeHtml(DIM_LABEL[dim] ?? dim)}（${result.overall.n} 个 take）</h3>${table(head, [...overall, ...groups])}`;
    });
    sections.push(`<section><h2>${title}</h2>${blocks.join('\n')}</section>`);
  }
  if (!Object.keys(model.subjective).length) sections.push('<section><h2>主观轨</h2><p>还没有评分。用 <code>node eval/aigc/run.mjs rate --ratings &lt;file.jsonl&gt;</code> 导入。</p></section>');
  const audit = model.audit;
  sections.push(`<section><h2>人工复核</h2><p>${audit.total
    ? `复核 ${audit.total} 条，同档一致 ${pct(audit.agreement)}，门槛 ${pct(audit.passBar)}：<strong>${audit.pass ? '通过' : '未通过'}</strong>`
    : '还没有复核标签（随机抽 20%，同档一致率需 ≥95%）。'}</p></section>`);
  sections.push(`<section><h2>撤回的条目（不计入任何比率）</h2>${model.withdrawn.length
    ? table(['条目', '原因'], model.withdrawn.map(entry => [escapeHtml(entry.itemId), escapeHtml(entry.reason)]))
    : '<p>无</p>'}</section>`);
  sections.push(`<section><h2>客观轨失败明细</h2>${model.failures.length
    ? table(['条目', 'Take', '结论', '问题'], model.failures.map(entry => [escapeHtml(entry.itemId), escapeHtml(entry.takeId), escapeHtml(entry.verdict), escapeHtml(entry.problems.join('；'))]))
    : '<p>无</p>'}</section>`);
  const counts = model.counts;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flovart AIGC 评测看板</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:24px;max-width:1100px;color:CanvasText;background:Canvas}
table{border-collapse:collapse;margin:8px 0 16px;width:100%}th,td{border:1px solid GrayText;padding:4px 8px;text-align:left;vertical-align:top}
th{font-weight:600}.ci{color:GrayText;font-size:12px}section{margin-bottom:28px}code{font-size:12px}
</style></head><body>
<h1>Flovart AIGC 评测看板</h1>
<p>生成于 ${escapeHtml(model.generatedAt)}；评测运行 ${escapeHtml(model.gradeRun?.runId ?? '—')}。条目 ${counts.items}（有效 ${counts.activeItems}；dev ${counts.bySplit.dev} / test ${counts.bySplit.test} / holdout ${counts.bySplit.holdout}），take ${counts.takes}，评分 ${counts.ratings}。</p>
<p class="ci">客观轨与主观轨分开报告，不合成一个分数。区间是 95% Wilson；样本少时区间很宽，结论只看区间。</p>
${sections.join('\n')}
</body></html>
`;
}
