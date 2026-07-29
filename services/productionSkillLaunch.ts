import type { BundledProductionSkill } from './productionSkillCatalog';

export const PRODUCTION_SKILL_DRAFT_KEY = 'flovart:production-skill-draft';

export interface ProductionSkillDraft {
  projectId: string;
  skillId: string;
  skillVersion: string;
  skillName: string;
  prompt: string;
}

export function productionSkillHandle(skill: BundledProductionSkill): string {
  return skill.defaultPrompt.match(/\$[\w-]+/)?.[0] || `$${skill.id.split('.').at(-1)}`;
}

export function buildProductionSkillStarterPrompt(skill: BundledProductionSkill): string {
  return `使用 ${productionSkillHandle(skill)}，把【在这里填写主题或粘贴 Brief】制作成 30 秒中文短片。先给我叙事节拍和 3 套视觉主题供确认；未经确认，不要开始付费生成。`;
}

export function queueProductionSkillDraft(draft: ProductionSkillDraft): boolean {
  try {
    sessionStorage.setItem(PRODUCTION_SKILL_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function readProductionSkillDraft(projectId: string): ProductionSkillDraft | null {
  try {
    const raw = sessionStorage.getItem(PRODUCTION_SKILL_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<ProductionSkillDraft>;
    return draft.projectId === projectId
      && typeof draft.prompt === 'string'
      && typeof draft.skillName === 'string'
      ? draft as ProductionSkillDraft
      : null;
  } catch {
    return null;
  }
}

export function consumeProductionSkillDraft(projectId: string): ProductionSkillDraft | null {
  const draft = readProductionSkillDraft(projectId);
  if (!draft) return null;
  try {
    sessionStorage.removeItem(PRODUCTION_SKILL_DRAFT_KEY);
  } catch {
    // The draft is still safe to use when storage cleanup is unavailable.
  }
  return draft;
}
