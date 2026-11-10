// Agent 读画布媒体：把图片/视频节点转成模型可看的图片块。
// 图片缩到长边 ≤ 1024px（JPEG），视频按需抽首/中/尾帧；单次最多 6 张，控制上下文与费用。
import type { ImageContent } from '@earendil-works/pi-ai';
import type { WorkflowNode } from '../components/workflow/types';
import { loadWorkflowMediaBlob, workflowBlobToDataUrl } from '../components/workflow/media';
import { extractVideoFrame } from './videoFrameExtractor';

export const AGENT_MEDIA_MAX_EDGE = 1024;
export const AGENT_MEDIA_MAX_IMAGES = 6;

export type AgentVideoFrame = 'first' | 'middle' | 'last';
export const AGENT_VIDEO_FRAMES: readonly AgentVideoFrame[] = ['first', 'middle', 'last'];
const FRAME_LABEL: Record<AgentVideoFrame, string> = { first: '首', middle: '中', last: '尾' };

export interface AgentMediaView {
  images: ImageContent[];
  // 每个节点一行：附带了什么、或为什么没有附带，按顺序对应 images。
  notes: string[];
}

export async function loadAgentNodeMedia(
  nodes: readonly WorkflowNode[],
  options: { frames?: readonly AgentVideoFrame[]; times?: readonly number[]; maxImages?: number } = {},
): Promise<AgentMediaView> {
  const maxImages = options.maxImages ?? AGENT_MEDIA_MAX_IMAGES;
  const frames = options.frames?.length ? options.frames : AGENT_VIDEO_FRAMES;
  // 调用方给了秒数就按秒切帧（任意时间点），否则仍按首/中/尾。
  const times = (options.times || []).filter(time => Number.isFinite(time) && time >= 0);
  const images: ImageContent[] = [];
  const notes: string[] = [];
  for (const node of nodes) {
    if (images.length >= maxImages) {
      notes.push(node.id + '：已达 ' + maxImages + ' 张上限，未附带');
      continue;
    }
    if (node.type !== 'image' && node.type !== 'video') {
      notes.push(node.id + '：' + node.type + ' 节点没有可查看的画面');
      continue;
    }
    try {
      const { storageKey, href, artifactRef } = node.metadata;
      const blob = await loadWorkflowMediaBlob(storageKey, href, artifactRef);
      if (node.type === 'image') {
        images.push(await toImageContent(blob));
        notes.push(node.id + '：图片「' + node.title + '」');
        continue;
      }
      if (times.length) {
        const taken: string[] = [];
        for (const time of times) {
          if (images.length >= maxImages) break;
          const extracted = await extractVideoFrame(blob, 'current', time);
          images.push(await toImageContent(extracted.blob));
          taken.push(time + 's');
        }
        notes.push(node.id + '：视频「' + node.title + '」帧 ' + taken.join('/'));
        continue;
      }
      const taken: string[] = [];
      for (const frame of frames) {
        if (images.length >= maxImages) break;
        const extracted = await extractVideoFrame(blob, frame);
        images.push(await toImageContent(extracted.blob));
        taken.push(FRAME_LABEL[frame]);
      }
      notes.push(node.id + '：视频「' + node.title + '」' + taken.join('/') + '帧');
    } catch (error) {
      notes.push(node.id + '：读取失败（' + (error instanceof Error ? error.message : String(error)) + '）');
    }
  }
  return { images, notes };
}

export async function toImageContent(blob: Blob): Promise<ImageContent> {
  const bitmap = await createImageBitmap(blob);
  try {
    // 长边超过 AGENT_MEDIA_MAX_EDGE 时等比缩小，不放大。
    const divisor = Math.max(1, Math.max(bitmap.width, bitmap.height) / AGENT_MEDIA_MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width / divisor));
    canvas.height = Math.max(1, Math.round(bitmap.height / divisor));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('图像处理上下文初始化失败');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { promise, resolve } = Promise.withResolvers<Blob | null>();
    canvas.toBlob(resolve, 'image/jpeg', 0.85);
    const jpeg = await promise;
    if (!jpeg) throw new Error('画面编码失败');
    const dataUrl = await workflowBlobToDataUrl(jpeg);
    return { type: 'image', data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}
