import type { WorkflowNode } from './types';

/** LibTV 式「生成资产」：文本节点一键派生的图片资产类型。 */
export type WorkflowTextAssetKind = 'character' | 'scene' | 'prop';

export const WORKFLOW_TEXT_ASSET_KINDS: ReadonlyArray<{ id: WorkflowTextAssetKind; label: string; title: string; aspectRatio: string }> = [
  { id: 'character', label: '生成角色图', title: '角色图', aspectRatio: '3:4' },
  { id: 'scene', label: '生成场景图', title: '场景图', aspectRatio: '16:9' },
  { id: 'prop', label: '生成道具图', title: '道具图', aspectRatio: '1:1' },
];

const INSTRUCTIONS: Record<WorkflowTextAssetKind, string> = {
  character: '根据备注中的角色设定生成角色设定图：单一角色，全身正面站姿，干净浅色背景，服装、发型与配饰细节清晰。',
  scene: '根据备注中的场景描述生成场景概念图：不出现人物，交代空间结构、光线与氛围。',
  prop: '根据备注中的关键道具生成道具设定图：单个道具居中，干净背景，材质与结构细节清晰。',
};

/**
 * 备注不参与连线生成：派生资产时把原文直接写进新节点的 prompt。
 * 用户之后可以分别修改备注和生成提示词，不再有两份隐式输入的合并规则。
 */
export function buildTextAssetPrompt(kind: WorkflowTextAssetKind, content = ''): string {
  const instruction = INSTRUCTIONS[kind];
  const text = content.trim();
  return text ? `${instruction}\n\n备注内容：\n${text}` : instruction;
}

export function textAssetSpec(kind: WorkflowTextAssetKind) {
  return WORKFLOW_TEXT_ASSET_KINDS.find(item => item.id === kind) || WORKFLOW_TEXT_ASSET_KINDS[0];
}

export function canGenerateTextAssets(node: Pick<WorkflowNode, 'type' | 'metadata'> | null | undefined): boolean {
  return node?.type === 'text' && Boolean(node.metadata.content?.trim());
}
