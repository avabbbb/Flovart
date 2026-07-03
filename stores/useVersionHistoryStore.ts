import { create } from 'zustand';
import type { Element } from '../types';

export type VersionType = 'generate' | 'split' | 'inpaint' | 'video' | 'restore' | 'initial';

export interface CanvasVersion {
    id: string;
    timestamp: number;
    type: VersionType;
    description: string;
    elements: Element[];
}

interface VersionHistoryState {
    versions: CanvasVersion[];
    maxVersions: number;
    addVersion: (elements: Element[], description: string, type: VersionType) => void;
    removeVersion: (id: string) => void;
    clearVersions: () => void;
    getVersion: (id: string) => CanvasVersion | undefined;
}

const MAX_VERSIONS = 30;

export const useVersionHistoryStore = create<VersionHistoryState>((set, get) => ({
    versions: [],
    maxVersions: MAX_VERSIONS,
    addVersion: (elements, description, type) => {
        const id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const version: CanvasVersion = {
            id,
            timestamp: Date.now(),
            type,
            description,
            elements: [...elements],
        };
        set(state => {
            const next = [...state.versions, version];
            if (next.length > state.maxVersions) {
                return { versions: next.slice(next.length - state.maxVersions) };
            }
            return { versions: next };
        });
    },
    removeVersion: (id) => {
        set(state => ({ versions: state.versions.filter(v => v.id !== id) }));
    },
    clearVersions: () => set({ versions: [] }),
    getVersion: (id) => get().versions.find(v => v.id === id),
}));
