import type { BundledDirectorSkill } from './directorSkillCatalog';

export const DIRECTOR_SKILL_DRAFT_KEY = 'flovart:director-skill-draft';

export interface DirectorSkillDraft {
  projectId: string;
  skillId: string;
  skillVersion: string;
  skillName: string;
  prompt: string;
}

export function directorSkillHandle(skill: BundledDirectorSkill): string {
  return skill.defaultPrompt.match(/\$[\w-]+/)?.[0] || `$${skill.id.split('.').at(-1)}`;
}

export function buildDirectorSkillStarterPrompt(skill: BundledDirectorSkill): string {
  return `使用 ${directorSkillHandle(skill)}，把【在这里填写主题或粘贴 Brief】制作成 30 秒中文短片。先给我叙事节拍和 3 套视觉主题供确认；未经确认，不要开始付费生成。`;
}

export function queueDirectorSkillDraft(draft: DirectorSkillDraft): boolean {
  try {
    sessionStorage.setItem(DIRECTOR_SKILL_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function readDirectorSkillDraft(projectId: string): DirectorSkillDraft | null {
  try {
    const raw = sessionStorage.getItem(DIRECTOR_SKILL_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<DirectorSkillDraft>;
    return draft.projectId === projectId
      && typeof draft.prompt === 'string'
      && typeof draft.skillName === 'string'
      ? draft as DirectorSkillDraft
      : null;
  } catch {
    return null;
  }
}

export function consumeDirectorSkillDraft(projectId: string): DirectorSkillDraft | null {
  const draft = readDirectorSkillDraft(projectId);
  if (!draft) return null;
  try {
    sessionStorage.removeItem(DIRECTOR_SKILL_DRAFT_KEY);
  } catch {
    // The draft is still safe to use when storage cleanup is unavailable.
  }
  return draft;
}
