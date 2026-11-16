import type { UserSkillRecord } from './canvasSkillRecipe';
import { getBundledProductionSkill, type ProductionSkillAttachment } from './productionSkillCatalog';
import { useUserSkillsStore } from '../stores/useUserSkillsStore';

// 我的 Skill → Agent：附件只带 id / 内容指纹，指令在绑定时从用户 Skill 权威里取，
// 编辑后指纹变化，内核据此重新绑定；删除或停用后面板会把附件撤掉。
export const USER_SKILL_TRUST_TIER = 'user';
const SKILL_CONTEXT_LIMIT = 4000;

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function isUserSkillAttachment(attachment: Pick<ProductionSkillAttachment, 'trustTier'> | null | undefined): boolean {
  return attachment?.trustTier === USER_SKILL_TRUST_TIER;
}

export function userSkillAttachment(skill: UserSkillRecord): ProductionSkillAttachment {
  return {
    id: skill.id,
    version: '0.0.0',
    contentHash: 'user-' + fnv1a([skill.name, skill.description, skill.prompt].join('\u0000')),
    displayName: skill.name,
    trustTier: USER_SKILL_TRUST_TIER,
  };
}

export function userSkillInstructions(skill: Pick<UserSkillRecord, 'name' | 'prompt'>): string {
  return ('当前启用的用户 Skill「' + skill.name + '」，按以下指令执行：\n' + skill.prompt).slice(0, SKILL_CONTEXT_LIMIT);
}

/** 绑定 Skill 时拼进 system prompt 的上下文：内置取 SKILL.md，我的 Skill 取指令，其余只给名称（由本机 Agent 解析包）。 */
export function skillSystemContext(attachment: ProductionSkillAttachment, skills: readonly UserSkillRecord[] = useUserSkillsStore.getState().skills): string {
  const bundled = getBundledProductionSkill(attachment.id);
  if (bundled) return bundled.skillSource.slice(0, 2000);
  if (isUserSkillAttachment(attachment)) {
    const skill = skills.find(item => item.id === attachment.id);
    if (skill && skill.enabled !== false) return userSkillInstructions(skill);
  }
  return attachment.displayName;
}
