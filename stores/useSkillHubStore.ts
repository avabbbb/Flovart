import { create } from 'zustand';

import {
  createLocalSkillRegistry,
  skillRegistryErrorMessage,
  type LocalSkillEntry,
} from '../services/localSkillRegistry';
import {
  fetchHubSkills,
  normalizeHubUrl,
  SkillHubError,
  type HubSkillSummary,
} from '../services/skillHubClient';

const HUB_STORAGE_KEY = 'iris.skill-hub.v1';

export type SkillHubStatus = 'idle' | 'syncing' | 'ready' | 'error';
export type SkillRegistryStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

interface PersistedSkillHubState {
  hubUrl: string;
  hubSkills: HubSkillSummary[];
}

function loadPersisted(): PersistedSkillHubState {
  try {
    const raw = localStorage.getItem(HUB_STORAGE_KEY);
    if (!raw) return { hubUrl: '', hubSkills: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedSkillHubState>;
    return {
      hubUrl: typeof parsed.hubUrl === 'string' ? parsed.hubUrl : '',
      hubSkills: Array.isArray(parsed.hubSkills) ? parsed.hubSkills : [],
    };
  } catch {
    return { hubUrl: '', hubSkills: [] };
  }
}

function persist(state: Pick<SkillHubState, 'hubUrl' | 'hubSkills'>) {
  try {
    localStorage.setItem(HUB_STORAGE_KEY, JSON.stringify({ hubUrl: state.hubUrl, hubSkills: state.hubSkills }));
  } catch { /* storage unavailable: keep in-memory only */ }
}

export interface SkillHubState {
  hubUrl: string;
  hubStatus: SkillHubStatus;
  hubError?: string;
  hubSkills: HubSkillSummary[];
  lastSyncedAt?: number;
  localSkills: LocalSkillEntry[];
  registryStatus: SkillRegistryStatus;
  registryError?: string;
  lastRefreshedAt?: number;
  setHubUrl: (url: string) => void;
  syncHub: () => Promise<void>;
  refreshLocal: () => Promise<void>;
  installFromHub: (id: string) => Promise<void>;
  uninstallSkill: (id: string) => Promise<void>;
}

const initial = loadPersisted();

export const useSkillHubStore = create<SkillHubState>((set, get) => ({
  hubUrl: initial.hubUrl,
  hubStatus: 'idle',
  hubSkills: initial.hubSkills,
  localSkills: [],
  registryStatus: 'idle',

  setHubUrl: url => {
    const hubUrl = normalizeHubUrl(url);
    set(state => {
      persist({ hubUrl, hubSkills: state.hubSkills });
      return { hubUrl, hubError: undefined, hubStatus: hubUrl ? 'idle' : 'idle' };
    });
  },

  syncHub: async () => {
    const { hubUrl } = get();
    if (!hubUrl) {
      set({ hubStatus: 'idle', hubSkills: [], hubError: undefined });
      return;
    }
    set({ hubStatus: 'syncing', hubError: undefined });
    try {
      const hubSkills = await fetchHubSkills(hubUrl);
      set(state => {
        persist({ hubUrl: state.hubUrl, hubSkills });
        return { hubSkills, hubStatus: 'ready', lastSyncedAt: Date.now() };
      });
    } catch (error) {
      set({
        hubStatus: 'error',
        hubError: error instanceof SkillHubError ? error.message : skillRegistryErrorMessage(error),
      });
    }
  },

  refreshLocal: async () => {
    set({ registryStatus: 'loading', registryError: undefined });
    try {
      const registry = await createLocalSkillRegistry();
      if (!registry) {
        set({ registryStatus: 'unavailable', localSkills: [] });
        return;
      }
      const localSkills = await registry.listLocalSkills();
      set({ localSkills, registryStatus: 'ready', lastRefreshedAt: Date.now() });
    } catch (error) {
      set({ registryStatus: 'error', registryError: skillRegistryErrorMessage(error) });
    }
  },

  installFromHub: async id => {
    const { hubUrl, hubStatus } = get();
    if (!hubUrl) throw new SkillHubError('INVALID_URL', '请先配置 Skill Hub 地址。');
    const registry = await createLocalSkillRegistry();
    if (!registry) throw new SkillHubError('UNREACHABLE', '安装需要桌面端 Managed Agent 连接。');
    await registry.installFromHub(id, hubUrl);
    await get().refreshLocal();
    if (hubStatus === 'ready') await get().syncHub();
  },

  uninstallSkill: async id => {
    const registry = await createLocalSkillRegistry();
    if (!registry) throw new SkillHubError('UNREACHABLE', '卸载需要桌面端 Managed Agent 连接。');
    await registry.uninstallSkill(id);
    await get().refreshLocal();
  },
}));
