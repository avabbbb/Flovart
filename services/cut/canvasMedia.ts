// 画布 → Cut：把当前 Workflow 项目里的图片 / 视频 / 音频节点列成可导入的素材。
import type { WorkflowNode, WorkflowProject } from '../../components/workflow/types';
import type { CutClip, CutProject, CutSourceKind } from './timeline';

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
  /** 当前结果版本（canvasNodeVersion）。 */
  version: string;
}

/** 画布素材 id：带版本时每个版本一份素材，旧版本片段在用户确认替换前保持原样。 */
export function canvasSourceId(nodeId: string, version?: string) {
  return version ? `node:${nodeId}@${shortHash(version)}` : `node:${nodeId}`;
}

function shortHash(value: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

type VersionedNode = { metadata?: Pick<WorkflowNode['metadata'], 'storageKey' | 'href' | 'artifactRef'> | null };

/** 节点结果的版本：内容哈希 > 产物 id > 存储键 > 链接；没有结果时为空串。 */
export function canvasNodeVersion(node: VersionedNode | null | undefined): string {
  const metadata = node?.metadata || {};
  const ref = metadata.artifactRef;
  if (ref?.sha256) return `sha256:${ref.sha256}`;
  if (ref?.artifactId) return `artifact:${ref.artifactId}`;
  if (metadata.storageKey) return `key:${metadata.storageKey}`;
  if (metadata.href) return `href:${metadata.href}`;
  if (ref?.taskId) return `task:${ref.taskId}:${ref.outputIndex ?? 0}`;
  return '';
}

export interface CutStaleClip { clipId: string; nodeId: string; currentVersion: string }

/** 画布节点结果变了的联动片段（节点被删或暂时没有结果的不算）。 */
export function staleCanvasClips(project: Pick<CutProject, 'clips'>, nodes: ReadonlyArray<{ id: string } & VersionedNode>): CutStaleClip[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  return project.clips.flatMap((clip: CutClip): CutStaleClip[] => {
    if (!clip.link) return [];
    const node = byId.get(clip.link.sourceNodeId);
    const currentVersion = canvasNodeVersion(node);
    if (!node || !currentVersion || currentVersion === clip.link.sourceVersion) return [];
    return [{ clipId: clip.id, nodeId: clip.link.sourceNodeId, currentVersion }];
  });
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
      version: canvasNodeVersion(node),
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
