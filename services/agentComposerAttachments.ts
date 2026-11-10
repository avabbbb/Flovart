// 对话框本地附件：粘贴截图 / 拖入视频后，在发送这一轮时转成模型可看的图片块。
// 图片缩到长边 ≤1024px；视频抽首/中/尾帧。附件不写画布，只在当轮对话里可见。
import type { ImageContent } from '@earendil-works/pi-ai';
import { extractVideoFrame } from './videoFrameExtractor';
import { toImageContent } from './agentMediaView';

export const AGENT_ATTACHMENT_MAX = 6;
export const AGENT_ATTACHMENT_MAX_BYTES = 200 * 1024 * 1024;

export interface AgentComposerAttachment {
  id: string;
  name: string;
  kind: 'image' | 'video';
  mimeType: string;
  bytes: number;
  /** 本地预览用 object URL，移除时必须 revoke。 */
  previewUrl: string;
  file: File;
}

export function attachmentKind(mimeType: string): AgentComposerAttachment['kind'] | null {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return null;
}

export function createComposerAttachment(file: File): AgentComposerAttachment | null {
  const kind = attachmentKind(file.type);
  if (!kind || file.size > AGENT_ATTACHMENT_MAX_BYTES) return null;
  return {
    id: 'attachment-' + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)),
    name: file.name || (kind === 'image' ? '粘贴的图片' : '拖入的视频'),
    kind,
    mimeType: file.type,
    bytes: file.size,
    previewUrl: URL.createObjectURL(file),
    file,
  };
}

/** 合并新附件并强制上限；超出的返回给调用方释放。 */
export function mergeComposerAttachments(
  current: readonly AgentComposerAttachment[],
  incoming: readonly AgentComposerAttachment[],
  max = AGENT_ATTACHMENT_MAX,
): { kept: AgentComposerAttachment[]; rejected: AgentComposerAttachment[] } {
  const room = Math.max(0, max - current.length);
  return {
    kept: [...current, ...incoming.slice(0, room)],
    rejected: incoming.slice(room),
  };
}

export function releaseComposerAttachment(attachment: AgentComposerAttachment | undefined) {
  if (!attachment) return;
  try {
    URL.revokeObjectURL(attachment.previewUrl);
  } catch {
    // 已被浏览器回收时忽略。
  }
}

/**
 * 把附件转成模型图片块。图片直接用；视频抽首/中/尾帧，备注里带上时间点。
 * 失败不抛：写进 notes，这一轮仍能继续。
 */
export async function composerAttachmentsToImages(
  attachments: readonly AgentComposerAttachment[],
  maxImages = AGENT_ATTACHMENT_MAX,
): Promise<{ images: ImageContent[]; notes: string[] }> {
  const images: ImageContent[] = [];
  const notes: string[] = [];
  for (const attachment of attachments) {
    if (images.length >= maxImages) {
      notes.push(attachment.name + '：已达 ' + maxImages + ' 张上限，未附带');
      continue;
    }
    try {
      if (attachment.kind === 'image') {
        images.push(await toImageContent(attachment.file));
        notes.push('本地图片「' + attachment.name + '」');
        continue;
      }
      const taken: string[] = [];
      for (const frame of ['first', 'middle', 'last'] as const) {
        if (images.length >= maxImages) break;
        const extracted = await extractVideoFrame(attachment.file, frame);
        images.push(await toImageContent(extracted.blob));
        taken.push(frame === 'first' ? '首' : frame === 'middle' ? '中' : '尾');
      }
      notes.push('本地视频「' + attachment.name + '」' + taken.join('/') + '帧');
    } catch (error) {
      notes.push(attachment.name + '：读取失败（' + (error instanceof Error ? error.message : String(error)) + '）');
    }
  }
  return { images, notes };
}
