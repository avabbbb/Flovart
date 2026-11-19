// 评审循环规则（docs/design/16-agent-video-pipeline.md §4.3）：
// findings 必须指向具体时间点 / 区间 / 片段；“整体不好”不是合法 finding。
export const REVIEW_LAYERS = Object.freeze(['visual', 'text', 'captions', 'audio', 'voice', 'music', 'timing', 'composition']);
export const REVIEW_SEVERITIES = Object.freeze(['blocker', 'major', 'minor']);
export const REVIEW_VERDICTS = Object.freeze(['pass', 'revise', 'block']);

const VAGUE = /^(整体|全片|总体|感觉)?(不好|不行|一般|很差|不满意|再改改|有问题|bad|not good|meh|fix it)[。.!！]*$/i;

export function validateFindings(findings, { verdict, durationMs }) {
  const errors = [];
  if (!Array.isArray(findings)) return ['findings 必须是数组'];
  if (verdict === 'revise' && findings.length === 0) errors.push('verdict=revise 至少需要一条 finding');
  findings.forEach((finding, index) => {
    const label = `findings[${index}]`;
    const hasAt = Number.isFinite(finding?.atSec);
    const hasRange = Array.isArray(finding?.range) && finding.range.length === 2 && finding.range.every(Number.isFinite) && finding.range[0] < finding.range[1];
    const hasClip = Boolean(finding?.clipId) || (Array.isArray(finding?.clipIds) && finding.clipIds.length > 0);
    if (!hasAt && !hasRange && !hasClip) errors.push(`${label}: 必须给 atSec、range [起, 止] 或 clipId`);
    const limitSec = (durationMs ?? Infinity) / 1000 + 0.001;
    if (hasAt && (finding.atSec < 0 || finding.atSec > limitSec)) errors.push(`${label}: atSec 超出成片时长`);
    if (hasRange && (finding.range[0] < 0 || finding.range[1] > limitSec)) errors.push(`${label}: range 超出成片时长`);
    if (!REVIEW_LAYERS.includes(finding?.layer)) errors.push(`${label}: layer 只能是 ${REVIEW_LAYERS.join(' / ')}`);
    if (!REVIEW_SEVERITIES.includes(finding?.severity)) errors.push(`${label}: severity 只能是 ${REVIEW_SEVERITIES.join(' / ')}`);
    const issue = String(finding?.issue || '').trim();
    if (issue.length < 4 || VAGUE.test(issue)) errors.push(`${label}: issue 要具体到问题（例如“第 8 秒结果停留不足 0.8 秒”）`);
    if (verdict === 'revise' && !String(finding?.fix || '').trim()) errors.push(`${label}: revise 的 finding 需要写 fix（修法）`);
  });
  return errors;
}

/** 两轮 findings 是否“相同”（同一位置 + 同一问题），用来发现修补没有生效的死循环。 */
export function findingsSignature(findings) {
  return findings.map(finding => [
    finding.clipId || (finding.clipIds || []).join('+') || '',
    Number.isFinite(finding.atSec) ? finding.atSec.toFixed(1) : (finding.range || []).map(value => value.toFixed(1)).join('-'),
    finding.layer,
    String(finding.issue || '').trim().toLowerCase(),
  ].join('|')).sort().join('\n');
}
