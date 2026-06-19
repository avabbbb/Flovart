import { nanoid } from 'nanoid';
import { useEffect, useState } from 'react';
import { workflowMediaStorage } from './storage';
import type { WorkflowNode, WorkflowNodeMetadata, WorkflowNodeType, WorkflowProject } from './types';

export type WorkflowMediaType = Extract<WorkflowNodeType, 'image' | 'video' | 'audio'>;

export interface WorkflowMediaRecord extends WorkflowNodeMetadata {
  type: WorkflowMediaType;
  storageKey: string;
  name: string;
  mimeType: string;
  bytes: number;
}

const transientReferences = new Map<string, Set<string>>();
const pendingReferences = new Set<string>();
let canonicalReferences = new Set<string>();

function collectNodeKeys(nodes: WorkflowNode[], keys = new Set<string>()) {
  nodes.forEach(node => {
    if (node.metadata.storageKey) keys.add(node.metadata.storageKey);
  });
  return keys;
}

export function collectWorkflowMediaKeys(projects: Array<Pick<WorkflowProject, 'nodes'>>) {
  return projects.reduce((keys, project) => collectNodeKeys(project.nodes, keys), new Set<string>());
}

export function setWorkflowMediaCanonicalProjects(projects: Array<Pick<WorkflowProject, 'nodes'>>) {
  canonicalReferences = collectWorkflowMediaKeys(projects);
}

export function registerWorkflowMediaTransientReferences(owner: string, nodeGroups: WorkflowNode[][]) {
  transientReferences.set(owner, nodeGroups.reduce((keys, nodes) => collectNodeKeys(nodes, keys), new Set<string>()));
}

export function unregisterWorkflowMediaTransientReferences(owner: string) {
  transientReferences.delete(owner);
}

export async function pruneWorkflowMedia() {
  const keys = await workflowMediaStorage.keys();
  const reachable = new Set([...canonicalReferences, ...pendingReferences]);
  transientReferences.forEach(keys => keys.forEach(key => reachable.add(key)));
  await Promise.all(keys.filter(key => !reachable.has(key)).map(key => workflowMediaStorage.remove(key)));
}

export function releaseWorkflowMediaRecord(storageKey: string) {
  pendingReferences.delete(storageKey);
}

export async function discardWorkflowMediaRecord(storageKey: string) {
  pendingReferences.delete(storageKey);
  await workflowMediaStorage.remove(storageKey).catch(() => undefined);
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

export async function createWorkflowVideoPoster(blob: Blob, maxWidth = 640): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadeddata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('无法提取视频封面')), { once: true });
      video.src = url;
      video.load();
    });
    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;
    const width = Math.min(maxWidth, sourceWidth);
    const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .76));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function ingestWorkflowMedia(file: File): Promise<WorkflowMediaRecord> {
  const type = workflowMediaType(file);
  const inspected = await inspectWorkflowMedia(file);
  const storageKey = `workflow-media-${nanoid()}`;
  pendingReferences.add(storageKey);
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
    pendingReferences.delete(storageKey);
    await workflowMediaStorage.remove(storageKey).catch(() => undefined);
    throw error;
  }
}

export function useWorkflowMediaUrl(storageKey?: string, fallbackHref?: string) {
  const mediaKey = storageKey || fallbackHref || '';
  const [state, setState] = useState<{ key: string; url: string | null; error: string | null }>({
    key: mediaKey,
    url: storageKey ? null : fallbackHref || null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setState({ key: mediaKey, url: storageKey ? null : fallbackHref || null, error: null });
    if (!storageKey) return () => undefined;
    void workflowMediaStorage.get(storageKey).then(blob => {
      if (!active) return;
      if (!blob) {
        setState({ key: mediaKey, url: null, error: '媒体文件不存在，请重新选择文件' });
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setState({ key: mediaKey, url: objectUrl, error: null });
    }).catch(() => {
      if (active) setState({ key: mediaKey, url: null, error: '媒体文件读取失败，请重新选择文件' });
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fallbackHref, mediaKey, storageKey]);

  return state.key === mediaKey ? state : { url: storageKey ? null : fallbackHref || null, error: null };
}
