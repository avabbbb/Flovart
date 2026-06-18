import { nanoid } from 'nanoid';
import { useEffect, useState } from 'react';
import { workflowMediaStorage } from './storage';
import type { WorkflowNodeMetadata, WorkflowNodeType } from './types';

export type WorkflowMediaType = Extract<WorkflowNodeType, 'image' | 'video' | 'audio'>;

export interface WorkflowMediaRecord extends WorkflowNodeMetadata {
  type: WorkflowMediaType;
  storageKey: string;
  name: string;
  mimeType: string;
  bytes: number;
}

export function workflowMediaType(file: Pick<File, 'type'>): WorkflowMediaType {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  throw new Error('仅支持图片、视频或音频文件');
}

export function fitWorkflowMediaSize(type: WorkflowMediaType, naturalWidth?: number, naturalHeight?: number) {
  if (type === 'audio') return { width: 340, height: 120 };
  const width = naturalWidth || (type === 'video' ? 16 : 4);
  const height = naturalHeight || (type === 'video' ? 9 : 3);
  const scale = Math.min(420 / width, 320 / height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function inspectImage(url: string) {
  return new Promise<Pick<WorkflowMediaRecord, 'naturalWidth' | 'naturalHeight'>>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
    image.onerror = () => reject(new Error('无法读取图片信息'));
    image.src = url;
  });
}

function inspectTimedMedia(url: string, type: 'video' | 'audio') {
  return new Promise<Pick<WorkflowMediaRecord, 'naturalWidth' | 'naturalHeight' | 'durationMs'>>((resolve, reject) => {
    const media = document.createElement(type);
    media.preload = 'metadata';
    media.addEventListener('loadedmetadata', () => resolve({
      ...(type === 'video' ? {
        naturalWidth: (media as HTMLVideoElement).videoWidth,
        naturalHeight: (media as HTMLVideoElement).videoHeight,
      } : {}),
      durationMs: Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : undefined,
    }), { once: true });
    media.addEventListener('error', () => reject(new Error(type === 'video' ? '无法读取视频信息' : '无法读取音频信息')), { once: true });
    media.src = url;
    media.load();
  });
}

export async function inspectWorkflowMedia(file: File) {
  const type = workflowMediaType(file);
  const url = URL.createObjectURL(file);
  try {
    if (type === 'image') return await inspectImage(url);
    return await inspectTimedMedia(url, type);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function ingestWorkflowMedia(file: File): Promise<WorkflowMediaRecord> {
  const type = workflowMediaType(file);
  const inspected = await inspectWorkflowMedia(file);
  const storageKey = `workflow-media-${nanoid()}`;
  try {
    await workflowMediaStorage.set(storageKey, file);
    return {
      type,
      storageKey,
      name: file.name,
      mimeType: file.type,
      bytes: file.size,
      ...inspected,
      status: 'success',
    };
  } catch (error) {
    await workflowMediaStorage.remove(storageKey).catch(() => undefined);
    throw error;
  }
}

export function useWorkflowMediaUrl(storageKey?: string, fallbackHref?: string) {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({
    url: storageKey ? null : fallbackHref || null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setState({ url: storageKey ? null : fallbackHref || null, error: null });
    if (!storageKey) return () => undefined;
    void workflowMediaStorage.get(storageKey).then(blob => {
      if (!active) return;
      if (!blob) {
        setState({ url: null, error: '媒体文件不存在，请重新选择文件' });
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setState({ url: objectUrl, error: null });
    }).catch(() => {
      if (active) setState({ url: null, error: '媒体文件读取失败，请重新选择文件' });
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fallbackHref, storageKey]);

  return state;
}
