import { create } from 'zustand';

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

interface UpdaterStore {
  status: UpdaterStatus;
  availableVersion: string | null;
  releaseNotes: string | null;
  downloadProgress: number; // 0..1
  error: string | null;
  checkForUpdates: () => Promise<void>;
  applyUpdate: () => Promise<void>;
  autoCheckOnStartup: () => Promise<void>;
  reset: () => void;
}

function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
}

let autoChecked = false;
let currentUpdate: any = null;
let downloaded = 0;
let contentLength = 0;

export const useUpdaterStore = create<UpdaterStore>((set, get) => ({
  status: 'idle',
  availableVersion: null,
  releaseNotes: null,
  downloadProgress: 0,
  error: null,

  checkForUpdates: async () => {
    if (!isTauri()) return;
    set({ status: 'checking', error: null, availableVersion: null, releaseNotes: null });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      currentUpdate = update;
      if (update) {
        set({
          status: 'available',
          availableVersion: update.version,
          releaseNotes: update.body ?? null,
        });
      } else {
        set({ status: 'up-to-date' });
        setTimeout(() => get().status === 'up-to-date' && set({ status: 'idle' }), 4000);
      }
    } catch (err: any) {
      set({ status: 'error', error: String(err?.message ?? err) });
    }
  },

  applyUpdate: async () => {
    if (!currentUpdate) return;
    set({ status: 'downloading', downloadProgress: 0, error: null });
    downloaded = 0;
    contentLength = 0;
    try {
      await currentUpdate.downloadAndInstall((event: any) => {
        const ev = event?.event;
        if (ev === 'Started' && event?.data?.contentLength) {
          contentLength = event.data.contentLength;
        } else if (ev === 'Progress' && event?.data?.chunkLength) {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            set({ downloadProgress: Math.min(1, downloaded / contentLength) });
          }
        }
      });
      set({ status: 'ready', downloadProgress: 1 });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err: any) {
      set({ status: 'error', error: String(err?.message ?? err) });
    }
  },

  autoCheckOnStartup: async () => {
    if (autoChecked || !isTauri()) return;
    autoChecked = true;
    await get().checkForUpdates();
  },

  reset: () => set({ status: 'idle', error: null, availableVersion: null, releaseNotes: null, downloadProgress: 0 }),
}));
