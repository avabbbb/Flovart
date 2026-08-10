import type { BundledProductionSkill } from './productionSkillCatalog';

export function productionSkillHandle(skill: BundledProductionSkill): string {
  return skill.defaultPrompt.match(/\$[\w-]+/)?.[0] || `$${skill.id.split('.').at(-1)}`;
}

export function buildProductionSkillStarterPrompt(skill: BundledProductionSkill): string {
  return `使用 ${productionSkillHandle(skill)}，把【在这里填写主题或粘贴 Brief】制作成 30 秒中文短片。先给我叙事节拍和 3 套视觉主题供确认；未经确认，不要开始付费生成。`;
}
