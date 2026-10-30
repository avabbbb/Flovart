import { z } from 'zod';

// Production Skill 输入槽位（manifest 的 inputs 字段，可选）。
// 对齐 LibTV「填空式」启动：选中 Skill 时按槽位生成起始提示词，而不是固定模板。
// tools/flovart/skill-package.js 的 parseSkillInputs 是同一契约的 JS 侧校验，改动需两边同步。
export const SKILL_INPUT_KINDS = ['text', 'longtext', 'image', 'video', 'audio', 'choice'] as const;
export type SkillInputKind = (typeof SKILL_INPUT_KINDS)[number];

export interface SkillInputSlot {
  id: string;
  label: string;
  kind: SkillInputKind;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  default?: string;
}

export const SKILL_INPUT_ID_PATTERN = /^[a-z][\w-]{0,63}$/;

export const skillInputSlotSchema = z.object({
  id: z.string().regex(SKILL_INPUT_ID_PATTERN),
  label: z.string().min(1),
  kind: z.enum(SKILL_INPUT_KINDS),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.string().min(1)).min(1).optional(),
  default: z.string().optional(),
}).strict().refine(slot => slot.kind !== 'choice' || Boolean(slot.options?.length), { message: 'choice 槽位必须提供 options' });

export const skillInputsSchema = z.array(skillInputSlotSchema).max(12)
  .refine(slots => new Set(slots.map(slot => slot.id)).size === slots.length, { message: 'inputs id 不可重复' });

export const MEDIA_INPUT_KINDS: Record<SkillInputKind, boolean> = {
  text: false,
  longtext: false,
  image: true,
  video: true,
  audio: true,
  choice: false,
};
