/** 画布二次处理工具目录（轻量，无重型依赖；服务实现见 services/workflowNodeTools.ts）。 */
export type WorkflowNodeToolName =
  | 'upscale'
  | 'remove-background'
  | 'split-layers'
  | 'edit'
  | 'rotate'
  | 'split-grid'
  | 'video-trim'
  | 'video-av-split'
  | 'video-merge'
  | 'video-extract-frame'
  | 'audio-trim'
  | 'audio-speed';

export const WORKFLOW_NODE_TOOLS: readonly WorkflowNodeToolName[] = [
  'upscale', 'remove-background', 'split-layers', 'edit', 'rotate', 'split-grid',
  'video-trim', 'video-av-split', 'video-merge', 'video-extract-frame', 'audio-trim', 'audio-speed',
];

export const WORKFLOW_NODE_TOOL_LABELS: Record<WorkflowNodeToolName, string> = {
  upscale: '高清放大',
  'remove-background': '移除背景',
  'split-layers': '拆分图层',
  edit: '图片编辑',
  rotate: '旋转镜像',
  'split-grid': '宫格切分',
  'video-trim': '视频剪辑',
  'video-av-split': '音视频分离',
  'video-merge': '视频拼接',
  'video-extract-frame': '导出视频帧',
  'audio-trim': '音频截取',
  'audio-speed': '音频变速',
};

export function isWorkflowNodeTool(value: string): value is WorkflowNodeToolName {
  return (WORKFLOW_NODE_TOOLS as readonly string[]).includes(value);
}
