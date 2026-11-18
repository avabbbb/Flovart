// Iris 故事版：画布节点的一种「读法」，不是第二份数据。
// - 素材分类直接从当前 Workflow 项目的节点派生（text / script → 文本，image → 图片，video → 视频）。
// - 用户手动改的分类写在节点自己的 metadata.storyboardTag 上，画布与故事版读同一份。
// - 故事版里新增的素材 = 在画布上建真节点；位置由 layoutStoryboardNodes 自动排（同类节点排成一行）。
// 纯函数，不依赖 React / store，便于单测。
import type { WorkflowNode, WorkflowPoint } from '../workflow/types';

export type StoryboardKind = 'text' | 'image' | 'video';
export type StoryboardTag = 'script' | 'character' | 'scene' | 'prop' | 'clip' | 'final' | 'other';
export type StoryboardFilter = 'all' | StoryboardTag;

/** 每类素材可用的分类，按显示顺序。视频没有「其他」：未分类的视频只出现在「全部」。 */
export const STORYBOARD_TAGS: Record<StoryboardKind, readonly StoryboardTag[]> = {
  text: ['script', 'other'],
  image: ['character', 'scene', 'prop', 'other'],
  video: ['clip', 'final'],
};

export const STORYBOARD_KINDS: readonly StoryboardKind[] = ['text', 'image', 'video'];

export interface StoryboardAsset {
  nodeId: string;
  /** 画布节点类型（text / script / image / video）。 */
  nodeType: WorkflowNode['type'];
  kind: StoryboardKind;
  /** 解析后的分类；null = 没有分类（只在「全部」里）。 */
  tag: StoryboardTag | null;
  /** 分类是用户显式写在节点上的，而不是推断的。 */
  explicitTag: boolean;
  title: string;
  /** 文本素材的正文（单行预览由 UI 截断）。 */
  text?: string;
  durationMs?: number;
  status?: WorkflowNode['metadata']['status'];
  media?: {
    storageKey?: string;
    href?: string;
    posterStorageKey?: string;
    poster?: string;
    artifactRef?: WorkflowNode['metadata']['artifactRef'];
    generated?: boolean;
  };
}

export type StoryboardBoard = Record<StoryboardKind, StoryboardAsset[]>;

export function isStoryboardTag(value: unknown): value is StoryboardTag {
  return typeof value === 'string' && (['script', 'character', 'scene', 'prop', 'clip', 'final', 'other'] as const).includes(value as StoryboardTag);
}

/** 节点属于故事版的哪一类；分组框、配置、处理步骤、音频、图形等不进故事版。 */
export function storyboardKindOf(node: Pick<WorkflowNode, 'type' | 'metadata'>): StoryboardKind | null {
  if (node.type === 'text' || node.type === 'script') return 'text';
  if (node.type === 'image') return 'image';
  if (node.type === 'video') return 'video';
  return null;
}

/** 分类：先认节点上显式写的 storyboardTag（且对这一类合法），再按节点已有语义推断。 */
export function storyboardTagOf(node: Pick<WorkflowNode, 'type' | 'metadata' | 'anchor' | 'shot'>, kind: StoryboardKind): { tag: StoryboardTag | null; explicit: boolean } {
  const explicit = node.metadata?.storyboardTag;
  if (isStoryboardTag(explicit) && STORYBOARD_TAGS[kind].includes(explicit)) return { tag: explicit, explicit: true };
  if (kind === 'text') return { tag: node.type === 'script' ? 'script' : 'other', explicit: false };
  if (kind === 'image') {
    const anchor = node.anchor?.kind;
    if (anchor === 'character') return { tag: 'character', explicit: false };
    if (anchor === 'scene') return { tag: 'scene', explicit: false };
    if (anchor === 'product') return { tag: 'prop', explicit: false };
    return { tag: 'other', explicit: false };
  }
  if (node.metadata?.pipelineRender) return { tag: 'final', explicit: false };
  if (node.shot) return { tag: 'clip', explicit: false };
  return { tag: null, explicit: false };
}

function textOf(node: WorkflowNode): string {
  if (node.type === 'script') return node.metadata.scriptBreakdown?.sourceText || node.metadata.content || '';
  return node.metadata.content || node.metadata.prompt || '';
}

function readingOrder(left: WorkflowNode, right: WorkflowNode) {
  // 画布上从上到下、从左到右；同一行（纵向差 < 40）按 x。
  const dy = left.position.y - right.position.y;
  if (Math.abs(dy) >= 40) return dy;
  return left.position.x - right.position.x;
}

/** 从画布节点派生故事版（三类素材，各自按画布阅读顺序）。 */
export function deriveStoryboard(nodes: readonly WorkflowNode[]): StoryboardBoard {
  const board: StoryboardBoard = { text: [], image: [], video: [] };
  const sorted = [...nodes].filter(node => node.isVisible !== false).sort(readingOrder);
  for (const node of sorted) {
    const kind = storyboardKindOf(node);
    if (!kind) continue;
    const { tag, explicit } = storyboardTagOf(node, kind);
    const metadata = node.metadata || {};
    board[kind].push({
      nodeId: node.id,
      nodeType: node.type,
      kind,
      tag,
      explicitTag: explicit,
      title: node.title || metadata.name || '',
      ...(kind === 'text' ? { text: textOf(node) } : {}),
      ...(metadata.durationMs ? { durationMs: metadata.durationMs } : {}),
      status: metadata.status,
      ...(kind !== 'text' ? {
        media: {
          storageKey: metadata.storageKey,
          href: metadata.href,
          posterStorageKey: metadata.posterStorageKey,
          poster: metadata.poster,
          artifactRef: metadata.artifactRef,
          generated: Boolean(metadata.artifactRef || metadata.generationHistoryId || metadata.generationRequestId || metadata.generationProviderTaskId || metadata.remoteUrl),
        },
      } : {}),
    });
  }
  return board;
}

/** 每个分类的数量（含 all）。 */
export function countStoryboardTags(assets: readonly StoryboardAsset[], kind: StoryboardKind): Record<StoryboardFilter, number> {
  const counts = { all: assets.length } as Record<StoryboardFilter, number>;
  for (const tag of STORYBOARD_TAGS[kind]) counts[tag] = 0;
  for (const asset of assets) if (asset.tag && asset.tag in counts) counts[asset.tag] += 1;
  return counts;
}

/** 按分类与搜索词筛选（标题与正文，忽略大小写与首尾空格）。 */
export function filterStoryboardAssets(assets: readonly StoryboardAsset[], filter: StoryboardFilter, query = ''): StoryboardAsset[] {
  const needle = query.trim().toLowerCase();
  return assets.filter(asset => {
    if (filter !== 'all' && asset.tag !== filter) return false;
    if (!needle) return true;
    return asset.title.toLowerCase().includes(needle) || (asset.text || '').toLowerCase().includes(needle);
  });
}

/** 改节点分类：返回新节点（不可变）；tag 为 null 时去掉显式分类，回到推断。 */
export function withStoryboardTag<T extends Pick<WorkflowNode, 'metadata'>>(node: T, tag: StoryboardTag | null): T {
  const { storyboardTag: _drop, ...rest } = node.metadata || {};
  return { ...node, metadata: tag ? { ...rest, storyboardTag: tag } : rest };
}

export interface StoryboardDraftSize { kind: StoryboardKind; width: number; height: number }

const LANE_GAP_X = 48;
const LANE_GAP_Y = 120;

/**
 * 故事版里新增的素材落到画布上的位置（反推画布）：
 * - 这一类已有节点：排在这一类最右边那个节点的右侧、顶对齐（同类成一行）。
 * - 这一类还没有：在现有内容下方另起一行（空画布从原点开始）。
 * 同一批里的多个素材依次往右排。只算位置，不建节点。
 */
export function layoutStoryboardNodes(
  existing: ReadonlyArray<Pick<WorkflowNode, 'type' | 'metadata' | 'position' | 'width' | 'height'>>,
  drafts: readonly StoryboardDraftSize[],
): WorkflowPoint[] {
  const placed: Array<{ kind: StoryboardKind | null; position: WorkflowPoint; width: number; height: number }> = existing.map(node => ({
    kind: storyboardKindOf(node), position: node.position, width: node.width, height: node.height,
  }));
  return drafts.map(draft => {
    const sameKind = placed.filter(item => item.kind === draft.kind);
    let position: WorkflowPoint;
    if (sameKind.length) {
      const rightmost = sameKind.reduce((best, item) => (item.position.x + item.width > best.position.x + best.width ? item : best));
      position = { x: rightmost.position.x + rightmost.width + LANE_GAP_X, y: rightmost.position.y };
    } else if (placed.length) {
      const left = Math.min(...placed.map(item => item.position.x));
      const bottom = Math.max(...placed.map(item => item.position.y + item.height));
      position = { x: left, y: bottom + LANE_GAP_Y };
    } else {
      position = { x: 0, y: 0 };
    }
    placed.push({ kind: draft.kind, position, width: draft.width, height: draft.height });
    return position;
  });
}
