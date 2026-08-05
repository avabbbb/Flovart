import { nanoid } from 'nanoid';
import { createWorkflowNode } from '../components/workflow/constants';
import {
  ingestWorkflowMedia,
  loadWorkflowMediaBlob,
  releaseWorkflowMediaRecord,
  workflowBlobToDataUrl,
} from '../components/workflow/media';
import { workflowMediaStorage } from '../components/workflow/storage';
import type { WorkflowNode, WorkflowProject } from '../components/workflow/types';
import type { WorkflowNodeToolName } from '../components/workflow/nodeToolCatalog';
import { loadRuntimeArtifactBlob } from './runtimeArtifacts';
import { transformImage } from './imageTransform';
import { splitGrid } from './gridSplitter';
import { trimVideo, splitAudioVideo, mergeVideos } from './videoTools';
import { extractVideoFrame } from './videoFrameExtractor';
import { trimAudio, changeAudioSpeed } from './audioTools';
import {
  runWorkflowImageAgent,
  runWorkflowImageEdit,
  runWorkflowImageSplit,
  type WorkflowImageToolOutcome,
  type WorkflowImageToolRuntime,
} from './workflowImageTools';

/** 画布二次处理工具：AI 可直接对选中节点执行这些工具，结果作为新节点+连线回填画布。 */
export type { WorkflowNodeToolName } from '../components/workflow/nodeToolCatalog';

export type WorkflowNodeToolOutcome = WorkflowImageToolOutcome;

/** 图片工具经 WorkflowImageToolRuntime 走 Provider 路由；确定性工具只需画布媒体读入/写入。 */
export interface WorkflowNodeToolRuntime extends WorkflowImageToolRuntime {}

const nanoidFactory = () => nanoid;

function requireProject(runtime: WorkflowNodeToolRuntime, projectId: string): WorkflowProject {
  const project = runtime.getProject();
  if (!project || project.id !== projectId) throw new Error('项目已切换或删除');
  return project;
}

function requireMediaNode(project: WorkflowProject, nodeId: string, kind: 'image' | 'video' | 'audio'): WorkflowNode {
  const node = project.nodes.find(item => item.id === nodeId);
  if (!node) throw new Error('节点不存在或已被删除');
  if (node.type !== kind) throw new Error(`该工具只支持 ${kind} 节点`);
  if (!node.metadata.storageKey && !node.metadata.href && !node.metadata.artifactRef?.taskId) {
    throw new Error('节点还没有可用媒体，请先生成或选择媒体。');
  }
  return node;
}

async function loadSourceBlob(node: WorkflowNode, runtime: WorkflowNodeToolRuntime): Promise<Blob> {
  if (node.metadata.storageKey) {
    const blob = await (runtime.loadMedia || workflowMediaStorage.get)(node.metadata.storageKey);
    if (blob) return blob;
  }
  if (node.metadata.artifactRef?.taskId) {
    return loadRuntimeArtifactBlob(node.metadata.artifactRef.taskId, node.metadata.artifactRef.mimeType);
  }
  return loadWorkflowMediaBlob(undefined, node.metadata.href);
}

function resultNodePosition(source: WorkflowNode, index = 0) {
  return { x: source.position.x + source.width + 80, y: source.position.y + index * 44 };
}

/** 把确定性工具产物写回画布：新节点 + 来源连线 + 选中，返回提交后的项目。 */
async function commitBlobResults(
  projectId: string,
  source: WorkflowNode,
  results: Array<{ blob: Blob; title: string; mimeType?: string }>,
  runtime: WorkflowNodeToolRuntime,
  createId: () => string = nanoid,
): Promise<{ status: 'committed'; project: WorkflowProject }> {
  const project = requireProject(runtime, projectId);
  const nodes: WorkflowNode[] = [];
  for (const [index, item] of results.entries()) {
    const mimeType = item.mimeType || item.blob.type || 'image/png';
    const kind = mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('audio/') ? 'audio' : 'image';
    const name = `${item.title}.${kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png'}`;
    const record = await ingestWorkflowMedia(new File([item.blob], name, { type: mimeType }));
    const size = record.naturalWidth && record.naturalHeight ? { width: Math.min(420, record.naturalWidth), height: Math.round(Math.min(420, record.naturalWidth) * record.naturalHeight / record.naturalWidth) } : { width: source.width, height: source.height };
    const node = {
      ...createWorkflowNode(createId(), kind, resultNodePosition(source, index), { ...record, status: 'success' as const, name: item.title }),
      ...size,
      title: item.title,
    };
    nodes.push(node);
    releaseWorkflowMediaRecord(record.storageKey);
  }
  const connections = nodes.map(node => ({ id: createId(), fromNodeId: source.id, toNodeId: node.id }));
  const next = {
    ...project,
    nodes: [...project.nodes, ...nodes],
    connections: [...project.connections, ...connections],
    selectedNodeIds: nodes.map(node => node.id),
  };
  await runtime.onProjectChange(next);
  return { status: 'committed', project: next };
}

const finite = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

/**
 * 对画布节点执行一个二次处理工具。AI 工具（upscale / remove-background / split-layers / edit）
 * 经 Provider 路由；确定性工具（旋转、切分、视频/音频处理）在本地完成。结果统一回填为新节点 + 连线。
 */
export async function runWorkflowNodeTool(
  projectId: string,
  nodeId: string,
  tool: WorkflowNodeToolName,
  args: Record<string, unknown>,
  runtime: WorkflowNodeToolRuntime,
): Promise<WorkflowNodeToolOutcome> {
  switch (tool) {
    case 'upscale':
      return runWorkflowImageAgent(projectId, nodeId, 'upscale', runtime, {
        targetLongEdge: args.targetLongEdge,
        algorithm: args.algorithm,
      });
    case 'remove-background':
      return runWorkflowImageAgent(projectId, nodeId, 'remove-background', runtime, {});
    case 'split-layers':
      return runWorkflowImageSplit(projectId, nodeId, runtime);
    case 'edit': {
      const mask = args.maskHref ? { href: String(args.maskHref), mimeType: String(args.maskMimeType || 'image/png') } : undefined;
      return runWorkflowImageEdit(projectId, nodeId, String(args.prompt || '根据描述修改图片'), mask, runtime);
    }
    case 'rotate': {
      const project = requireProject(runtime, projectId);
      const source = requireMediaNode(project, nodeId, 'image');
      const blob = await loadSourceBlob(source, runtime);
      const dataUrl = await (runtime.encodeDataUrl || workflowBlobToDataUrl)(blob);
      const rotation = String(args.rotation || 'rotate-90');
      const action = (['rotate-90', 'rotate-180', 'rotate-270', 'flip-h', 'flip-v'].includes(rotation) ? rotation : 'rotate-90') as 'rotate-90' | 'rotate-180' | 'rotate-270' | 'flip-h' | 'flip-v';
      const result = await transformImage(dataUrl, action);
      return commitBlobResults(projectId, source, [{ blob: result, title: '旋转镜像', mimeType: 'image/png' }], runtime);
    }
    case 'split-grid': {
      const project = requireProject(runtime, projectId);
      const source = requireMediaNode(project, nodeId, 'image');
      const blob = await loadSourceBlob(source, runtime);
      const dataUrl = await (runtime.encodeDataUrl || workflowBlobToDataUrl)(blob);
      const rows = Math.round(finite(args.rows, 2, 1, 6));
      const cols = Math.round(finite(args.cols, 2, 1, 6));
      const cells = await splitGrid(dataUrl, rows, cols);
      return commitBlobResults(
        projectId,
        source,
        cells.map(cell => ({ blob: cell.blob, title: `切分 ${cell.index + 1}`, mimeType: 'image/png' })),
        runtime,
      );
    }
    case 'video-trim': {
      const project = requireProject(runtime, projectId);
      const source = requireMediaNode(project, nodeId, 'video');
      const blob = await loadSourceBlob(source, runtime);
      const { blob: trimmed, durationSec } = await trimVideo(blob, finite(args.startSec, 0, 0, Number.MAX_SAFE_INTEGER), finite(args.endSec, 0, 0, Number.MAX_SAFE_INTEGER), source.metadata.name || 'video.mp4');
      return commitBlobResults(projectId, source, [{ blob: trimmed, title: `剪辑 ${durationSec.toFixed(1)}s`, mimeType: 'video/mp4' }], runtime);
    }
    case 'video-av-split': {
      const project = requireProject(runtime, projectId);
      const source = requireMediaNode(project, nodeId, 'video');
      const blob = await loadSourceBlob(source, runtime);
      const { videoBlob, audioBlob } = await splitAudioVideo(blob, source.metadata.name || 'video.mp4');
      return commitBlobResults(
        projectId,
        source,
        [
          { blob: videoBlob, title: '纯视频', mimeType: 'video/mp4' },
          { blob: audioBlob, title: '纯音频', mimeType: audioBlob.type || 'audio/mp3' },
        ],
        runtime,
      );
    }
    case 'video-merge': {
      const project = requireProject(runtime, projectId);
      const source = requireMediaNode(project, nodeId, 'video');
      const requested = Array.isArray(args.sourceNodeIds) ? args.sourceNodeIds.map(String) : [];
      const candidateIds = requested.length ? requested : project.connections.filter(connection => connection.toNodeId === nodeId).map(connection => connection.fromNodeId);
      const sources = Array.from(new Set(candidateIds))
        .map(id => project.nodes.find(node => node.id === id))
        .filter((node): node is WorkflowNode => Boolean(node && node.type === 'video' && (node.metadata.storageKey || node.metadata.href || node.metadata.artifactRef?.taskId)));
      if (sources.length < 2) throw new Error('视频拼接至少需要 2 个视频节点');
      const blobs = await Promise.all(sources.map(node => loadSourceBlob(node, runtime)));
      const merged = await mergeVideos(blobs, sources.map(node => node.metadata.name || 'video.mp4'));
      return commitBlobResults(projectId, source, [{ blob: merged, title: '视频拼接', mimeType: 'video/mp4' }], runtime);
    }
    case 'video-extract-frame': {
      const project = requireProject(runtime, projectId);
      const source = requireMediaNode(project, nodeId, 'video');
      const blob = await loadSourceBlob(source, runtime);
      const position = String(args.position || 'first') === 'last' ? 'last' : 'first';
      const frame = await extractVideoFrame(blob, position);
      return commitBlobResults(projectId, source, [{ blob: frame.blob, title: position === 'first' ? '首帧' : '尾帧', mimeType: 'image/jpeg' }], runtime);
    }
    case 'audio-trim': {
      const project = requireProject(runtime, projectId);
      const source = requireMediaNode(project, nodeId, 'audio');
      const blob = await loadSourceBlob(source, runtime);
      const { blob: trimmed, durationSec } = await trimAudio(blob, finite(args.startSec, 0, 0, Number.MAX_SAFE_INTEGER), finite(args.endSec, 0, 0, Number.MAX_SAFE_INTEGER), source.metadata.name || 'audio.mp3');
      return commitBlobResults(projectId, source, [{ blob: trimmed, title: `截取 ${durationSec.toFixed(1)}s`, mimeType: trimmed.type || 'audio/mpeg' }], runtime);
    }
    case 'audio-speed': {
      const project = requireProject(runtime, projectId);
      const source = requireMediaNode(project, nodeId, 'audio');
      const blob = await loadSourceBlob(source, runtime);
      const speed = finite(args.speed, 1, 0.25, 4);
      const result = await changeAudioSpeed(blob, speed, source.metadata.name || 'audio.mp3');
      return commitBlobResults(projectId, source, [{ blob: result, title: `变速 ${speed}x`, mimeType: 'audio/mpeg' }], runtime);
    }
    default:
      throw new Error(`未知画布工具：${String(tool)}`);
  }
}
