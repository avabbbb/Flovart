import { create } from 'zustand';
import localforage from 'localforage';

export interface PromptHistoryEntry {
    id: string;
    prompt: string;
    mode: 'image' | 'video' | 'text';
    source: 'canvas' | 'workflow';
    model?: string;
    timestamp: number;
}

const MAX_ENTRIES = 500;

const historyStore = localforage.createInstance({
    name: 'flovart',
    storeName: 'prompt-history',
});

function createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface PromptHistoryState {
    entries: PromptHistoryEntry[];
    isOpen: boolean;
    loaded: boolean;
    pendingInsert: { text: string; nonce: number } | null;
    load: () => Promise<void>;
    record: (input: Omit<PromptHistoryEntry, 'id' | 'timestamp'>) => void;
    search: (query: string) => PromptHistoryEntry[];
    clearAll: () => Promise<void>;
    open: () => void;
    close: () => void;
    toggle: () => void;
    insert: (text: string) => void;
    consumeInsert: () => void;
}

export const usePromptHistoryStore = create<PromptHistoryState>((set, get) => ({
    entries: [],
    isOpen: false,
    loaded: false,
    pendingInsert: null,

    load: async () => {
        if (get().loaded) return;
        const stored = await historyStore.getItem<PromptHistoryEntry[]>('entries');
        set({ entries: stored || [], loaded: true });
    },

    record: (input) => {
        const text = input.prompt.trim();
        if (!text) return;
        const entries = get().entries;
        const existing = entries.find(e => e.prompt === text);
        let next: PromptHistoryEntry[];
        if (existing) {
            next = [{ ...existing, ...input, timestamp: Date.now() }, ...entries.filter(e => e.id !== existing.id)];
        } else {
            next = [{ ...input, id: createId(), timestamp: Date.now() }, ...entries];
        }
        if (next.length > MAX_ENTRIES) next = next.slice(0, MAX_ENTRIES);
        set({ entries: next });
        void historyStore.setItem('entries', next);
    },

    search: (query) => {
        const q = query.trim().toLowerCase();
        const entries = get().entries;
        if (!q) return entries.slice(0, 50);
        return entries.filter(e => e.prompt.toLowerCase().includes(q)).slice(0, 50);
    },

    clearAll: async () => {
        set({ entries: [] });
        await historyStore.removeItem('entries');
    },

    open: () => { void get().load(); set({ isOpen: true }); },
    close: () => set({ isOpen: false }),
    toggle: () => { if (get().isOpen) set({ isOpen: false }); else { void get().load(); set({ isOpen: true }); } },

    insert: (text) => { set({ pendingInsert: { text, nonce: Date.now() }, isOpen: false }); },
    consumeInsert: () => { set({ pendingInsert: null }); },
}));
