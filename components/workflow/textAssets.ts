import type { WorkflowNode } from './types';

/** LibTV 式「生成资产」：文本节点一键派生的图片资产类型。 */
export type WorkflowTextAssetKind = 'character' | 'scene' | 'prop';

export const WORKFLOW_TEXT_ASSET_KINDS: ReadonlyArray<{ id: WorkflowTextAssetKind; label: string; title: string; aspectRatio: string }> = [
  { id: 'character', label: '生成角色图', title: '角色图', aspectRatio: '3:4' },
  { id: 'scene', label: '生成场景图', title: '场景图', aspectRatio: '16:9' },
  { id: 'prop', label: '生成道具图', title: '道具图', aspectRatio: '1:1' },
];

const INSTRUCTIONS: Record<WorkflowTextAssetKind, string> = {
  character: '根据连入的文本中的角色设定生成角色设定图：单一角色，全身正面站姿，干净浅色背景，服装、发型与配饰细节清晰。',
  scene: '根据连入的文本中的场景描述生成场景概念图：不出现人物，交代空间结构、光线与氛围。',
  prop: '根据连入的文本中的关键道具生成道具设定图：单个道具居中，干净背景，材质与结构细节清晰。',
};

/**
 * 派生节点只写「要什么资产」的指令；文本本身经连线作为 prompt 上下文流入，
 * 用户改了原文后重跑即可，提示词与模型都留在画布节点上可二次微调。
 */
export function buildTextAssetPrompt(kind: WorkflowTextAssetKind): string {
  return INSTRUCTIONS[kind];
}

export function textAssetSpec(kind: WorkflowTextAssetKind) {
  return WORKFLOW_TEXT_ASSET_KINDS.find(item => item.id === kind) || WORKFLOW_TEXT_ASSET_KINDS[0];
}

export function canGenerateTextAssets(node: Pick<WorkflowNode, 'type' | 'metadata'> | null | undefined): boolean {
  return node?.type === 'text' && Boolean(node.metadata.content?.trim());
}
