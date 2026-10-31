import localforage from 'localforage';
import { create } from 'zustand';

import type { UserSkillRecord } from '../../services/canvasSkillRecipe';

export const MINE_SKILLS_KEY = 'flovart.skill.mine.v1';

function isUserSkill(value: unknown): value is UserSkillRecord {
  const item = value as Partial<UserSkillRecord> | null;
  return Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.prompt === 'string');
}

interface MineSkillsState {
  skills: UserSkillRecord[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (skill: UserSkillRecord) => Promise<void>;
}

// User-created Skills (我的), persisted locally and shared by the panel and the Skill popover.
export const useMineSkillsStore = create<MineSkillsState>((set, get) => ({
  skills: [],
  loaded: false,
  load: async () => {
    const stored = await localforage.getItem<unknown[]>(MINE_SKILLS_KEY);
    set({ skills: Array.isArray(stored) ? stored.filter(isUserSkill) : [], loaded: true });
  },
  save: async skill => {
    if (!get().loaded) await get().load();
    const next = [skill, ...get().skills.filter(item => item.id !== skill.id)];
    set({ skills: next });
    await localforage.setItem(MINE_SKILLS_KEY, next);
  },
}));
