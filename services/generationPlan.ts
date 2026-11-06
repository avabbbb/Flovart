import type { ProductModelMode, UserApiKey } from '../types';
import type { WorkflowGenerationMode, WorkflowNode, WorkflowProject } from '../components/workflow/types';
import { buildCanonicalGenerationInput, resolveWorkflowInputs } from '../components/workflow/inputResolver';
import { promptIntentFromNode } from '../components/workflow/promptIntent';
import { getProductModel, resolveProductModelRoute, type ProductModelDefinition } from './productModelCatalog';
import { resolveProviderGenerationExtension } from './userScriptProviderAdapter';
import { planReferenceTranscodes } from './referenceTranscode';
import type { GenerationGateDetails, PlanNotice, PlanReference } from './generationGate';

// 未显式选择 submode 时，只从同一份参考推导输入模式；runWorkflowGeneration 与计划卡共用。
export function deriveProductMode(
  mode: WorkflowGenerationMode,
  submode: ProductModelMode | undefined,
  productModel: ProductModelDefinition | undefined,
  media: ReadonlyArray<{ kind: string }>,
): ProductModelMode {
  if (submode) return submode;
  const fallback: ProductModelMode = mode === 'video' ? 'text-to-video' : 'text-to-image';
  if (!productModel) return fallback;
  const modes = productModel.capabilities.modes;
  if (mode === 'image' && media.some(resource => resource.kind === 'image') && modes.includes('image-to-image')) return 'image-to-image';
  if (mode === 'video' && media.length > 0) {
    const imageCount = media.filter(resource => resource.kind === 'image').length;
    const needsGeneralReference = media.some(resource => resource.kind === 'video' || resource.kind === 'audio') || imageCount > 1;
    if (needsGeneralReference && modes.includes('reference-to-video')) return 'reference-to-video';
    if (imageCount > 0 && modes.includes('image-to-video')) return 'image-to-video';
  }
  return fallback;
}

export interface GenerationPlanChecks {
  references: PlanReference[];
  warnings: PlanNotice[];
  blockers: PlanNotice[];
}

const EMPTY: GenerationPlanChecks = { references: [], warnings: [], blockers: [] };

// 计划卡的提交前检查：与运行时同一套 resolveWorkflowInputs → canonical → provider.validate，文案一致。
// 只读、同步、不发请求；主线路不可用时不校验（运行时可能走备用线路，仍有兜底校验）。
export function buildGenerationPlanChecks(input: {
  node: WorkflowNode;
  project: Pick<WorkflowProject, 'nodes' | 'connections'>;
  keys: UserApiKey[];
  mode: 'image' | 'video';
}): GenerationPlanChecks {
  const { node, project, keys, mode } = input;
  const warnings: PlanNotice[] = [];
  const blockers: PlanNotice[] = [];
  const config = node.metadata.config;
  const modelRef = config?.modelId || '';
  if (!modelRef) {
    return { ...EMPTY, blockers: [{ code: 'model-missing', message: '请先在 PromptBar 明确选择' + (mode === 'video' ? '视频' : '图片') + '产品模型。' }] };
  }
  const productModel = getProductModel(modelRef);
  if (productModel?.capability !== mode) {
    return { ...EMPTY, blockers: [{ code: 'model-mismatch', message: 'Workflow ' + (mode === 'video' ? '视频' : '图片') + '生成仅支持平台预设产品模型，请重新选择模型。' }] };
  }
  if (node.metadata.status === 'error' && productModel.id.toLowerCase().includes('seedance')) {
    warnings.push({ code: 'retry-new-task', message: 'Seedance 重试会创建一个全新任务，可能再次消耗额度。' });
  }
  try {
    const resolvedInputs = resolveWorkflowInputs(node, project.nodes, project.connections, { promptIntent: promptIntentFromNode(node, 'generate') });
    const productMode = deriveProductMode(mode, config?.submode as ProductModelMode | undefined, productModel, resolvedInputs.references.map(reference => reference.resource));
    const canonical = buildCanonicalGenerationInput({ targetNode: node, inputs: resolvedInputs, prompt: '', mode, submode: productMode, parameters: { modelId: productModel.id } });
    for (const diagnostic of canonical.diagnostics) {
      if (diagnostic.severity === 'error') blockers.push({ code: 'input-error', message: diagnostic.message });
    }
    const route = resolveProductModelRoute(productModel.id, productMode, keys);
    const validation = route
      ? resolveProviderGenerationExtension(route.key).generation.validate(canonical, { provider: route.key.provider, routeId: route.routeId, productModelId: productModel.id })
      : null;
    const errors = validation?.errors ?? [];
    // 只有分辨率越界且可算出目标尺寸时运行时才会提议转码；这类问题不拦，提示即可。
    const transcode = errors.length ? planReferenceTranscodes(canonical, errors) : null;
    const references: PlanReference[] = canonical.references.map(reference => {
      const resource = reference.resource;
      const issue = errors.find(error => error.resourceId && error.resourceId === resource.resourceId);
      return {
        title: resource.title,
        kind: resource.kind as PlanReference['kind'],
        ...(resource.durationMs ? { durationSec: Math.round(resource.durationMs / 100) / 10 } : {}),
        ...(resource.bytes ? { sizeBytes: resource.bytes } : {}),
        ...(resource.naturalWidth && resource.naturalHeight ? { width: resource.naturalWidth, height: resource.naturalHeight } : {}),
        status: issue ? (transcode ? 'warn' : 'block') : 'ok',
        ...(issue ? { message: issue.message } : {}),
      };
    });
    if (transcode) {
      warnings.push({
        code: 'reference-transcode',
        message: '参考视频分辨率不符合要求，提交前会询问是否在本机转码：' + transcode.map(item => '「' + item.title + '」' + item.fromWidth + '×' + item.fromHeight + ' → ' + item.toWidth + '×' + item.toHeight).join('；'),
      });
    } else {
      for (const message of new Set(errors.map(error => error.message))) blockers.push({ code: 'reference-limit', message });
    }
    return { references, warnings, blockers };
  } catch {
    // 解析失败交给运行时报错；计划卡不因此拦截。
    return { references: [], warnings, blockers };
  }
}

export function applyPlanChecks(details: GenerationGateDetails, checks: GenerationPlanChecks): GenerationGateDetails {
  return {
    ...details,
    ...(checks.references.length ? { references: checks.references } : {}),
    ...(checks.warnings.length ? { warnings: [...(details.warnings ?? []), ...checks.warnings] } : {}),
    ...(checks.blockers.length ? { blockers: [...(details.blockers ?? []), ...checks.blockers] } : {}),
  };
}
