import { create } from 'zustand';

export interface ClipItem {
  id: string;
  kind: 'image' | 'video';
  blob: Blob;
  mimeType: string;
  name: string;
  naturalWidth?: number;
  naturalHeight?: number;
  sourceView: 'workflow';
}

interface ClipboardState {
  items: ClipItem[];
  setItems: (items: ClipItem[]) => void;
  clear: () => void;
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  items: [],
  setItems: (items) => set({ items }),
  clear: () => set({ items: [] }),
}));
