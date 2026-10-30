// 自动派生：视频节点「新进入成功状态」时（上传、生成完成、素材库插入），
// 按用户开启的选项规划截帧 / 音视频分离任务。只做规划，执行复用现有 Operation。
// 防环：Operation 产出的节点（sourceOperationNodeId）不再触发；项目首次加载不触发。

import type { WorkflowNode } from '../components/workflow/types';

export interface AutoMediaDeriveSettings {
  firstFrame: boolean;
  lastFrame: boolean;
  avSplit: boolean;
}

export const DEFAULT_AUTO_MEDIA_DERIVE: AutoMediaDeriveSettings = { firstFrame: false, lastFrame: false, avSplit: false };

export type AutoMediaDeriveKind = 'first-frame' | 'last-frame' | 'av-split';

export interface AutoMediaDeriveTask {
  nodeId: string;
  kind: AutoMediaDeriveKind;
}

export function isAutoDeriveSourceVideo(node: WorkflowNode): boolean {
  return node.type === 'video'
    && node.metadata.status === 'success'
    && Boolean(node.metadata.storageKey || node.metadata.href)
    && !node.metadata.sourceOperationNodeId;
}

export function hasAutoMediaDerive(settings: AutoMediaDeriveSettings): boolean {
  return settings.firstFrame || settings.lastFrame || settings.avSplit;
}

export function planAutoMediaDerivations(
  previous: readonly WorkflowNode[] | undefined,
  next: readonly WorkflowNode[],
  settings: AutoMediaDeriveSettings,
  handled: ReadonlySet<string> = new Set(),
): AutoMediaDeriveTask[] {
  if (!previous || !hasAutoMediaDerive(settings)) return [];
  const wasReady = new Set(previous.filter(isAutoDeriveSourceVideo).map(node => node.id));
  const tasks: AutoMediaDeriveTask[] = [];
  for (const node of next) {
    if (!isAutoDeriveSourceVideo(node) || wasReady.has(node.id) || handled.has(node.id)) continue;
    if (settings.firstFrame) tasks.push({ nodeId: node.id, kind: 'first-frame' });
    if (settings.lastFrame) tasks.push({ nodeId: node.id, kind: 'last-frame' });
    if (settings.avSplit) tasks.push({ nodeId: node.id, kind: 'av-split' });
  }
  return tasks;
}

const AUTO_MEDIA_DERIVE_STORAGE_KEY = 'flovart.autoMediaDerive.v1';

export function loadAutoMediaDeriveSettings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): AutoMediaDeriveSettings {
  try {
    const raw = storage?.getItem(AUTO_MEDIA_DERIVE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUTO_MEDIA_DERIVE };
    const parsed = JSON.parse(raw) as Partial<AutoMediaDeriveSettings>;
    return { firstFrame: parsed.firstFrame === true, lastFrame: parsed.lastFrame === true, avSplit: parsed.avSplit === true };
  } catch {
    return { ...DEFAULT_AUTO_MEDIA_DERIVE };
  }
}

export function saveAutoMediaDeriveSettings(settings: AutoMediaDeriveSettings, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(AUTO_MEDIA_DERIVE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 存储不可用（隐私模式/配额）时仅本次会话生效。
  }
}
