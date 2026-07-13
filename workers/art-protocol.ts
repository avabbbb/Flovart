import type { ArtToolId } from '../components/art/artTools';

export type ArtWorkerIn =
  | { kind: 'process'; requestId: number; toolId: ArtToolId; blob: Blob; options?: Record<string, unknown> }
  | { kind: 'cancel'; requestId: number };

export type ArtWorkerOut =
  | { kind: 'progress'; requestId: number; phase: string; value?: number }
  | { kind: 'result'; requestId: number; toolId: ArtToolId; dataUrl: string; width: number; height: number }
  | { kind: 'error'; requestId: number; message: string };

export type ArtProgressCb = (phase: string, value?: number) => void;

export interface ArtRunHandle {
  promise: Promise<string>;
  cancel: () => void;
}