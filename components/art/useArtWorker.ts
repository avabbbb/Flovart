import { useCallback, useEffect, useRef } from 'react';
import type { ArtToolId } from '../../components/art/artTools';
import type { ArtProgressCb } from '../../workers/art-protocol';
import { loadFallbackMediaBlob } from '../../components/workflow/media';

let workerSingleton: Worker | null = null;
let workerRefcount = 0;

function getWorker(): Worker {
  if (!workerSingleton) {
    workerSingleton = new Worker(new URL('../../workers/art-worker.ts', import.meta.url), { type: 'module' });
  }
  workerRefcount += 1;
  return workerSingleton;
}

function releaseWorker(): void {
  workerRefcount = Math.max(0, workerRefcount - 1);
  if (workerRefcount === 0 && workerSingleton) {
    workerSingleton.terminate();
    workerSingleton = null;
  }
}

export interface ArtRunResult {
  dataUrl: string;
  width: number;
  height: number;
}

export function useArtWorker() {
  const pendingRef = useRef<{ requestId: number; reject: (e: Error) => void } | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    workerRef.current = getWorker();
    return () => {
      if (pendingRef.current) {
        try { pendingRef.current.reject(new Error('已取消')); } catch { /* noop */ }
        pendingRef.current = null;
      }
      releaseWorker();
      workerRef.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    const w = workerRef.current;
    if (!w || !pendingRef.current) return;
    w.postMessage({ kind: 'cancel', requestId: pendingRef.current.requestId });
    pendingRef.current.reject(new Error('已取消'));
    pendingRef.current = null;
  }, []);

  const run = useCallback(
    async (
      toolId: ArtToolId,
      href: string,
      options?: Record<string, unknown>,
      onProgress?: ArtProgressCb,
    ): Promise<ArtRunResult> => {
      const w = workerRef.current;
      if (!w) throw new Error('Art worker 未初始化');
      // Cancel any in-flight run.
      if (pendingRef.current) cancel();
      const blob = await loadFallbackMediaBlob(href);
      const requestId = Date.now() + Math.floor(Math.random() * 1e6);
      return new Promise<ArtRunResult>((resolve, reject) => {
        pendingRef.current = { requestId, reject };
        const handler = (e: MessageEvent) => {
          const msg = e.data;
          if (!msg || msg.requestId !== requestId) return;
          if (msg.kind === 'progress') {
            onProgress?.(msg.phase, msg.value);
            return;
          }
          if (msg.kind === 'result') {
            w.removeEventListener('message', handler);
            pendingRef.current = null;
            resolve({ dataUrl: msg.dataUrl, width: msg.width, height: msg.height });
            return;
          }
          if (msg.kind === 'error') {
            w.removeEventListener('message', handler);
            pendingRef.current = null;
            reject(new Error(msg.message));
            return;
          }
        };
        w.addEventListener('message', handler);
        w.postMessage({ kind: 'process', requestId, toolId, blob, options });
      });
    },
    [cancel],
  );

  return { run, cancel };
}