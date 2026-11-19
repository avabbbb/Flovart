/**
 * 参考用途（purpose）：多参考生成时，告诉模型每张参考图是干什么的（主体 / 风格 / 背景…）。
 * 与 role（first_frame / last_frame / style… 线路槽位）分开：role 决定参考进哪个参数槽，
 * purpose 只编成一句参考说明追加在发给模型的提示词后面，不改变线路 payload 的结构，旧节点没有 purpose 时行为不变。
 */
export const REFERENCE_PURPOSES = ['subject', 'character', 'product', 'style', 'background', 'scene', 'pose', 'composition', 'other'] as const;
export type WorkflowReferencePurpose = typeof REFERENCE_PURPOSES[number];

const PURPOSE_LABELS: Record<WorkflowReferencePurpose, { zh: string; en: string }> = {
  subject: { zh: '主体', en: 'main subject' },
  character: { zh: '角色', en: 'character identity' },
  product: { zh: '产品', en: 'product' },
  style: { zh: '风格', en: 'style' },
  background: { zh: '背景', en: 'background / environment' },
  scene: { zh: '场景', en: 'scene' },
  pose: { zh: '姿势', en: 'pose' },
  composition: { zh: '构图', en: 'composition' },
  other: { zh: '其他参考', en: 'other reference' },
};

export function isReferencePurpose(value: unknown): value is WorkflowReferencePurpose {
  return typeof value === 'string' && (REFERENCE_PURPOSES as readonly string[]).includes(value);
}

const KIND_LABEL: Record<string, { zh: string; en: string }> = {
  image: { zh: '图片', en: 'image' },
  video: { zh: '视频', en: 'video' },
  audio: { zh: '音频', en: 'audio' },
};

/**
 * 参考说明：按参考顺序给每种媒体编号（图片1、图片2…与 chip 编号一致），只列出声明了 purpose 的参考。
 * 没有任何 purpose 时返回空串（旧行为不变）。中英双语，便于不同语言的模型理解。
 */
export function describeReferencePurposes(references: ReadonlyArray<{ kind: string; purpose?: string | null }>): string {
  const counters = new Map<string, number>();
  const zh: string[] = [];
  const en: string[] = [];
  for (const reference of references) {
    const index = (counters.get(reference.kind) || 0) + 1;
    counters.set(reference.kind, index);
    if (!isReferencePurpose(reference.purpose)) continue;
    const kind = KIND_LABEL[reference.kind] || { zh: reference.kind, en: reference.kind };
    zh.push(kind.zh + index + '=' + PURPOSE_LABELS[reference.purpose].zh);
    en.push(kind.en + ' ' + index + ' = ' + PURPOSE_LABELS[reference.purpose].en);
  }
  if (!zh.length) return '';
  return '参考说明：' + zh.join('，') + '。Reference roles: ' + en.join('; ') + '.';
}

/** 把参考说明接在提示词后面；已经带着同一句说明时不重复追加。 */
export function withReferencePurposeLegend(prompt: string, legend: string): string {
  if (!legend || prompt.includes(legend)) return prompt;
  return prompt.trim() ? prompt.trimEnd() + '\n\n' + legend : legend;
}
