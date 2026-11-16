import localforage from 'localforage';
import { create } from 'zustand';

import type { ProductionSkillAttachment } from '../services/productionSkillCatalog';
import type { LocalFolderEntry } from '../services/localFolderSource';

// 放大的 Hub 窗口（Skills / History / Library）的开合状态与跨组件入口。
// 窗口挂在 App 顶层；真正的动作（插入画布、给 Composer 附 Skill）由拥有它的组件注册进来，
// 窗口只调用，不复制业务。
export type StudioHubKind = 'skills' | 'history' | 'library';

export const HISTORY_FAVORITES_KEY = 'flovart.history.favorites.v1';

export interface StudioHubHandlers {
  /** 生成历史 → 插入当前画布（InfiniteWorkflow 注册）。 */
  insertHistory?: (item: { id: string; source?: 'history' | 'asset'; sourceId?: string; name: string; href: string; mimeType: string; type: 'image' | 'video'; width?: number; height?: number; prompt?: string; projectId?: string; createdAt?: number }) => void;
  /** 本地文件夹条目 → 插入当前画布（InfiniteWorkflow 注册）。 */
  insertLibrary?: (entries: LocalFolderEntry[]) => void | Promise<void>;
  /** 选用 Skill → 附到 Agent Composer（ProductionSkillDeck 注册）。 */
  attachSkill?: (attachment: ProductionSkillAttachment) => void;
}

interface StudioHubState {
  open: boolean;
  hub: StudioHubKind;
  /** 侧栏子项：Skill 分组 / 画布 id / 文件夹 id。 */
  section: string | null;
  sidebarCollapsed: boolean;
  handlers: StudioHubHandlers;
  historyFavorites: ReadonlySet<string>;
  historyFavoritesLoaded: boolean;
  openHub: (hub: StudioHubKind, section?: string | null) => void;
  setSection: (hub: StudioHubKind, section: string | null) => void;
  close: () => void;
  toggleSidebar: () => void;
  register: <K extends keyof StudioHubHandlers>(name: K, handler: StudioHubHandlers[K] | undefined) => () => void;
  loadHistoryFavorites: () => Promise<void>;
  toggleHistoryFavorite: (id: string) => Promise<void>;
}

export const useStudioHubStore = create<StudioHubState>((set, get) => ({
  open: false,
  hub: 'skills',
  section: null,
  sidebarCollapsed: false,
  handlers: {},
  historyFavorites: new Set(),
  historyFavoritesLoaded: false,
  openHub: (hub, section = null) => set({ open: true, hub, section }),
  setSection: (hub, section) => set({ hub, section }),
  close: () => set({ open: false }),
  toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  register: (name, handler) => {
    set(state => ({ handlers: { ...state.handlers, [name]: handler } }));
    return () => {
      if (get().handlers[name] === handler) set(state => ({ handlers: { ...state.handlers, [name]: undefined } }));
    };
  },
  loadHistoryFavorites: async () => {
    const stored = await localforage.getItem<unknown[]>(HISTORY_FAVORITES_KEY);
    set({ historyFavorites: new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []), historyFavoritesLoaded: true });
  },
  toggleHistoryFavorite: async id => {
    if (!get().historyFavoritesLoaded) await get().loadHistoryFavorites();
    const next = new Set(get().historyFavorites);
    if (next.has(id)) next.delete(id); else next.add(id);
    set({ historyFavorites: next });
    await localforage.setItem(HISTORY_FAVORITES_KEY, [...next]);
  },
}));
