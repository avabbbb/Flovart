import localforage from 'localforage';
import { create } from 'zustand';

import { createUserSkill, normalizeSkillSlug, type UserSkillRecord } from '../services/canvasSkillRecipe';

// 用户自建 Skill（我的）与 Skill 启用状态的唯一权威，持久化在 localforage。
// 画布分组「保存为 Skill」、Skill Hub 面板的创建 / 编辑 / 删除、Agent 内核解析指令都读这里。
export const MINE_SKILLS_KEY = 'iris.skill.mine.v1';
export const DISABLED_SKILLS_KEY = 'iris.skill.disabled.v1';
export const FAVORITE_SKILLS_KEY = 'iris.skill.favorites.v1';

function isUserSkill(value: unknown): value is UserSkillRecord {
  const item = value as Partial<UserSkillRecord> | null;
  return Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.prompt === 'string');
}

export interface UserSkillDraft {
  name: string;
  slug?: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

export interface RemovedUserSkill {
  skill: UserSkillRecord;
  index: number;
}

interface UserSkillsState {
  skills: UserSkillRecord[];
  /** 停用的内置 / 本机 / Hub Skill id（我的 Skill 用自身 enabled 字段）。 */
  disabledIds: ReadonlySet<string>;
  /** 收藏（喜欢）的 Skill id，任何来源都可收藏。 */
  favoriteIds: ReadonlySet<string>;
  loaded: boolean;
  toggleFavorite: (id: string) => Promise<void>;
  load: () => Promise<void>;
  save: (skill: UserSkillRecord) => Promise<void>;
  create: (draft: UserSkillDraft) => Promise<UserSkillRecord>;
  update: (id: string, draft: Partial<UserSkillDraft>) => Promise<UserSkillRecord>;
  remove: (id: string) => Promise<RemovedUserSkill | null>;
  restore: (removed: RemovedUserSkill) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
}

export function isSkillEnabled(state: Pick<UserSkillsState, 'skills' | 'disabledIds'>, id: string): boolean {
  const mine = state.skills.find(skill => skill.id === id);
  if (mine) return mine.enabled !== false;
  return !state.disabledIds.has(id);
}

function validate(draft: Pick<UserSkillDraft, 'name' | 'prompt'>) {
  if (!draft.name.trim()) throw new Error('Skill 名称不能为空。');
  if (!draft.prompt.trim()) throw new Error('Skill 指令不能为空。');
}

export const useUserSkillsStore = create<UserSkillsState>((set, get) => {
  const persistSkills = (skills: UserSkillRecord[]) => localforage.setItem(MINE_SKILLS_KEY, skills);
  const ensureLoaded = async () => { if (!get().loaded) await get().load(); };
  return {
    skills: [],
    disabledIds: new Set(),
    favoriteIds: new Set(),
    loaded: false,
    load: async () => {
      const [stored, disabled, favorites] = await Promise.all([
        localforage.getItem<unknown[]>(MINE_SKILLS_KEY),
        localforage.getItem<unknown[]>(DISABLED_SKILLS_KEY),
        localforage.getItem<unknown[]>(FAVORITE_SKILLS_KEY),
      ]);
      const ids = (value: unknown) => new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
      set({
        skills: Array.isArray(stored) ? stored.filter(isUserSkill) : [],
        disabledIds: ids(disabled),
        favoriteIds: ids(favorites),
        loaded: true,
      });
    },
    toggleFavorite: async id => {
      await ensureLoaded();
      const favoriteIds = new Set(get().favoriteIds);
      if (favoriteIds.has(id)) favoriteIds.delete(id); else favoriteIds.add(id);
      set({ favoriteIds });
      await localforage.setItem(FAVORITE_SKILLS_KEY, [...favoriteIds]);
    },
    save: async skill => {
      await ensureLoaded();
      const next = [skill, ...get().skills.filter(item => item.id !== skill.id)];
      set({ skills: next });
      await persistSkills(next);
    },
    create: async draft => {
      validate(draft);
      await ensureLoaded();
      const skill: UserSkillRecord = {
        ...createUserSkill({ name: draft.name, slug: draft.slug || draft.name, description: draft.description, prompt: draft.prompt }),
        enabled: draft.enabled,
      };
      const next = [skill, ...get().skills];
      set({ skills: next });
      await persistSkills(next);
      return skill;
    },
    update: async (id, draft) => {
      await ensureLoaded();
      const current = get().skills.find(skill => skill.id === id);
      if (!current) throw new Error('Skill 不存在或已删除。');
      const name = draft.name ?? current.name;
      const prompt = draft.prompt ?? current.prompt;
      validate({ name, prompt });
      const updated: UserSkillRecord = {
        ...current,
        name: name.trim(),
        slug: draft.slug !== undefined ? normalizeSkillSlug(draft.slug || name) : current.slug,
        description: (draft.description ?? current.description).trim(),
        prompt: prompt.trim(),
        enabled: draft.enabled ?? current.enabled ?? true,
        updatedAt: new Date().toISOString(),
      };
      const next = get().skills.map(skill => (skill.id === id ? updated : skill));
      set({ skills: next });
      await persistSkills(next);
      return updated;
    },
    remove: async id => {
      await ensureLoaded();
      const index = get().skills.findIndex(skill => skill.id === id);
      if (index < 0) return null;
      const skill = get().skills[index];
      const next = get().skills.filter(item => item.id !== id);
      set({ skills: next });
      await persistSkills(next);
      return { skill, index };
    },
    restore: async ({ skill, index }) => {
      await ensureLoaded();
      const rest = get().skills.filter(item => item.id !== skill.id);
      const next = [...rest.slice(0, index), skill, ...rest.slice(index)];
      set({ skills: next });
      await persistSkills(next);
    },
    setEnabled: async (id, enabled) => {
      await ensureLoaded();
      if (get().skills.some(skill => skill.id === id)) {
        await get().update(id, { enabled });
        return;
      }
      const disabledIds = new Set(get().disabledIds);
      if (enabled) disabledIds.delete(id); else disabledIds.add(id);
      set({ disabledIds });
      await localforage.setItem(DISABLED_SKILLS_KEY, [...disabledIds]);
    },
  };
});
