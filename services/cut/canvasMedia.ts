// 画布 → Cut：把当前 Workflow 项目里的图片 / 视频 / 音频节点列成可导入的素材。
import type { WorkflowNode, WorkflowProject } from '../../components/workflow/types';
import type { CutSourceKind } from './timeline';

export interface CutCanvasMedia {
  nodeId: string;
  kind: CutSourceKind;
  title: string;
  storageKey?: string;
  href?: string;
  artifactRef?: WorkflowNode['metadata']['artifactRef'];
  poster?: string;
  posterStorageKey?: string;
  durationMs?: number;
}

export function canvasSourceId(nodeId: string) {
  return `node:${nodeId}`;
}

export function listCanvasMedia(project: Pick<WorkflowProject, 'nodes'> | null | undefined): CutCanvasMedia[] {
  if (!project) return [];
  return project.nodes.flatMap((node): CutCanvasMedia[] => {
    const kind = node.type;
    if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return [];
    const metadata = node.metadata || {};
    if (!metadata.storageKey && !metadata.href && !metadata.artifactRef) return [];
    return [{
      nodeId: node.id,
      kind: kind as CutSourceKind,
      title: node.title || node.type,
      storageKey: metadata.storageKey,
      href: metadata.href,
      artifactRef: metadata.artifactRef,
      poster: metadata.poster,
      posterStorageKey: metadata.posterStorageKey,
      durationMs: metadata.durationMs,
    }];
  });
}

export function mediaKindOfFile(file: Pick<File, 'type' | 'name'>): CutSourceKind | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'mov', 'webm', 'mkv', 'm4v'].includes(ext)) return 'video';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'].includes(ext)) return 'audio';
  return null;
}
