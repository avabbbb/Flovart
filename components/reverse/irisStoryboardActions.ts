// Iris 故事版的写入：全部落到当前 Workflow 项目的真节点上，经同一条 draft-authority 提交路径（可撤销、有回执）。
// commitWorkflowProjectPatch 在 WorkflowWorkspace 里（画布 chunk 懒加载），这里按需动态导入，不复制第二份提交实现。
import { nanoid } from 'nanoid';
import { createWorkflowNode } from '../workflow/constants';
import { discardWorkflowMediaRecord, fitWorkflowMediaSize, ingestWorkflowMedia, releaseWorkflowMediaRecord, type WorkflowMediaRecord } from '../workflow/media';
import { useWorkflowStore } from '../workflow/store';
import type { WorkflowNode, WorkflowNodeMetadata } from '../workflow/types';
import { layoutStoryboardNodes, withStoryboardTag, type StoryboardTag } from './irisStoryboard';

export interface StoryboardWriteResult { ok: boolean; error?: string; nodeIds?: string[] }

async function commit(projectId: string, nodes: WorkflowNode[], intent: string, selectedNodeIds?: string[]): Promise<StoryboardWriteResult> {
  const { commitWorkflowProjectPatch } = await import('../workflow/WorkflowWorkspace');
  const result = commitWorkflowProjectPatch(projectId, { nodes, ...(selectedNodeIds ? { selectedNodeIds } : {}) }, intent);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

function project(projectId: string) {
  return useWorkflowStore.getState().projects.find(item => item.id === projectId) || null;
}

/** 新建一个文本素材（剧本 / 其他）= 画布上新建一个文本节点，自动排到文本那一行。 */
export async function addStoryboardText(projectId: string, tag: 'script' | 'other', title: string, content = ''): Promise<StoryboardWriteResult> {
  const current = project(projectId);
  if (!current) return { ok: false, error: '项目不存在或已删除。' };
  const draft = createWorkflowNode(nanoid(), 'text', { x: 0, y: 0 }, { content, storyboardTag: tag });
  const [position] = layoutStoryboardNodes(current.nodes, [{ kind: 'text', width: draft.width, height: draft.height }]);
  const node: WorkflowNode = { ...draft, title, position };
  const result = await commit(projectId, [...current.nodes, node], `Iris 故事版：新建「${title}」`, [node.id]);
  return result.ok ? { ...result, nodeIds: [node.id] } : result;
}

/** 上传图片 / 视频 = 落盘后在画布上建媒体节点（与拖到画布同一份 ingest），同类排成一行。 */
export async function addStoryboardMedia(projectId: string, files: File[], tag?: StoryboardTag | null): Promise<StoryboardWriteResult> {
  const records: WorkflowMediaRecord[] = [];
  const discardAll = () => Promise.all(records.map(record => discardWorkflowMediaRecord(record.storageKey)));
  try {
    for (const file of files) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
      records.push(await ingestWorkflowMedia(file));
    }
    if (!records.length) return { ok: false, error: '没有可放进故事版的图片或视频。' };
    const current = project(projectId);
    if (!current) { await discardAll(); return { ok: false, error: '项目不存在或已删除。' }; }
    const drafts = records.map(record => {
      const kind = record.type === 'video' ? 'video' as const : 'image' as const;
      const size = fitWorkflowMediaSize(kind, record.naturalWidth, record.naturalHeight);
      return { kind, record, size };
    });
    const positions = layoutStoryboardNodes(current.nodes, drafts.map(item => ({ kind: item.kind, ...item.size })));
    const nodes = drafts.map((item, index) => {
      const { type: _type, warning: _warning, pendingPreview: _pending, ...metadata } = item.record as WorkflowMediaRecord & { warning?: string; pendingPreview?: boolean };
      const base = createWorkflowNode(nanoid(), item.kind, positions[index], { ...(metadata as WorkflowNodeMetadata), status: 'success' });
      const node: WorkflowNode = { ...base, ...item.size, freeResize: false, title: files[index]?.name || base.title };
      return tag ? withStoryboardTag(node, tag) : node;
    });
    const result = await commit(projectId, [...current.nodes, ...nodes], 'Iris 故事版：放入素材', nodes.map(node => node.id));
    if (!result.ok) { await discardAll(); return result; }
    records.forEach(record => releaseWorkflowMediaRecord(record.storageKey));
    return { ok: true, nodeIds: nodes.map(node => node.id) };
  } catch (error) {
    await discardAll();
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 改分类：写在节点自己的 metadata.storyboardTag 上（null = 回到按节点推断）。 */
export async function setStoryboardTag(projectId: string, nodeId: string, tag: StoryboardTag | null): Promise<StoryboardWriteResult> {
  const current = project(projectId);
  if (!current) return { ok: false, error: '项目不存在或已删除。' };
  if (!current.nodes.some(node => node.id === nodeId)) return { ok: false, error: '节点已不在画布上。' };
  return commit(projectId, current.nodes.map(node => node.id === nodeId ? withStoryboardTag(node, tag) : node), 'Iris 故事版：修改分类');
}

/** 改文本正文 = 改画布文本节点的 content；画布上同一节点立即显示。 */
export async function updateStoryboardText(projectId: string, nodeId: string, content: string): Promise<StoryboardWriteResult> {
  const current = project(projectId);
  const target = current?.nodes.find(node => node.id === nodeId);
  if (!current || !target) return { ok: false, error: '节点已不在画布上。' };
  if (target.type !== 'text' || (target.metadata.content || '') === content) return { ok: true };
  return commit(projectId, current.nodes.map(node => node.id === nodeId ? { ...node, metadata: { ...node.metadata, content } } : node), 'Iris 故事版：编辑文本');
}
