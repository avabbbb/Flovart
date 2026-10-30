import type { WorkflowGenerationConfig, WorkflowGenerationMode, WorkflowNode } from '../components/workflow/types';

// LibTV 式参数继承：批量/下游新建的生成节点沿用同模式候选节点的模型与风格参数。
// 只继承「怎么生成」；count / seedanceRefs / operationParameters 是单次运行状态，继承会重复引用或放大花费，因此排除。
const INHERITED_KEYS = [
  'providerId', 'modelId', 'submode', 'aspectRatio', 'preserveReferenceAspectRatio', 'resolution', 'durationSec', 'quality',
  'generateAudio', 'watermark', 'enhancePrompt', 'styleId', 'camera', 'cameraMovement', 'audioVoice', 'audioFormat', 'audioSpeed',
] as const satisfies readonly (keyof WorkflowGenerationConfig)[];

/** 第一个同模式且带 config 的候选节点胜出；否则返回 undefined，运行时走原有默认。 */
export function inheritGenerationConfig(mode: WorkflowGenerationMode, candidates: readonly (WorkflowNode | undefined)[]): WorkflowGenerationConfig | undefined {
  const config = candidates.find(node => node?.metadata.config?.mode === mode)?.metadata.config;
  if (!config) return undefined;
  const picked: Partial<WorkflowGenerationConfig> = Object.fromEntries(
    INHERITED_KEYS.filter(key => config[key] !== undefined).map(key => [key, config[key]]),
  );
  return { ...picked, mode };
}
