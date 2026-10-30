import { MEDIA_INPUT_KINDS, type SkillInputSlot } from './skillInputs';

export interface SkillLaunchInfo {
  id: string;
  displayName: string;
  version?: string;
  defaultPrompt?: string;
  inputs?: readonly SkillInputSlot[];
}

export function productionSkillHandle(skill: SkillLaunchInfo): string {
  return skill.defaultPrompt?.match(/\$[\w-]+/)?.[0] || '$' + skill.id.split('.').at(-1);
}

const CONFIRM_LINE = '先给我叙事节拍和 3 套视觉主题供确认；未经确认，不要开始付费生成。';

function slotLine(slot: SkillInputSlot): string {
  const hint = slot.default ?? slot.placeholder ?? (slot.kind === 'choice' ? slot.options?.join(' / ') : undefined) ?? '在这里填写';
  const media = MEDIA_INPUT_KINDS[slot.kind] ? '（用 @ 引用素材）' : '';
  return '- ' + slot.label + (slot.required ? '（必填）' : '') + '：【' + hint + '】' + media;
}

export function buildProductionSkillStarterPrompt(skill: SkillLaunchInfo): string {
  const handle = productionSkillHandle(skill);
  if (!skill.inputs?.length) return '使用 ' + handle + '，把【在这里填写主题或粘贴 Brief】制作成 30 秒中文短片。' + CONFIRM_LINE;
  return ['使用 ' + handle + '，按以下输入制作：', ...skill.inputs.map(slotLine), CONFIRM_LINE].join('\n');
}
