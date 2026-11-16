import { create } from 'zustand';
import type { WorkflowClip } from '../components/workflow/canvasClipboard';

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
  /** 画布节点 + 两端都在选区内的连线；切换项目不清空，可跨项目粘贴（P1-6） */
  workflowClip: WorkflowClip | null;
  setItems: (items: ClipItem[]) => void;
  setWorkflowClip: (clip: WorkflowClip | null) => void;
  clear: () => void;
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  items: [],
  workflowClip: null,
  setItems: (items) => set({ items }),
  setWorkflowClip: (workflowClip) => set({ workflowClip }),
  clear: () => set({ items: [], workflowClip: null }),
}));
