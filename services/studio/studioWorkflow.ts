import { createWorkflowNode } from '../../components/workflow/constants';
import type { WorkflowDocumentOperation, WorkflowProject, WorkflowResourceReference } from '../../components/workflow/types';
import { nanoid } from 'nanoid';
import { hostSelectionResource, StudioContractError, type CreativeHostAdapter, type CreativeHostId, type FlovartStudioCore, type HostContext, type HostImportResult, type HostImportTarget, type HostSelection, type MaterializedHostSelection, type StudioApplyRequest, type WorkflowResource } from './studioContract';
import { workflowResultArtifactId, workflowResultRevision, workflowResultTaskId } from './studioClient';

export interface StudioGenerationResult {
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  run: unknown;
  import?: HostImportResult;
  materialized: MaterializedHostSelection;
  /** 提交时冻结的执行目标；artifact 回写只认这份快照。 */
  executionTarget: StudioExecutionTarget;
}

/**
 * 提交时冻结的执行目标：artifact 只回写到 submit 瞬间捕获的宿主文档/选择，
 * 不读取 run 完成时的 live selection。沿用 expectedRevision 乐观并发令牌，
 * 与 StudioApplyRequest/StudioRunRequest 同一条 draftAuthority 通道。
 */
export interface StudioExecutionTarget {
  readonly projectId: string;
  readonly nodeId: string;
  readonly selectionSnapshot: HostSelection;
  readonly references: readonly WorkflowResourceReference[];
  readonly outputTarget: HostImportTarget | undefined;
  readonly hostTarget: CreativeHostId;
  readonly revision: number;
}

/** 冻结 outputTarget：把 submit 时的宿主文档/选择 locator 钉进 import target，
 *  宿主适配器据此定位原作文档而不是"当前激活"文档；未指定 target 时保持
 *  undefined，沿用各宿主适配器自己的默认输出位置。 */
function freezeOutputTarget(target: HostImportTarget | undefined, selection: HostSelection): HostImportTarget | undefined {
  if (!target) return undefined;
  const documentId = selection.locator.documentId;
  const pinned: HostImportTarget & { documentId?: string; sourceSelectionId?: string } = { ...target };
  if (typeof documentId === 'string' || typeof documentId === 'number') pinned.documentId = String(documentId);
  pinned.sourceSelectionId = selection.selectionId;
  return Object.freeze(pinned);
}

function freezeSelection(selection: HostSelection): HostSelection {
  return Object.freeze({ ...selection, locator: Object.freeze({ ...selection.locator }) });
}

function requireProject(project: WorkflowProject | null | undefined): WorkflowProject {
  if (!project) throw new StudioContractError('WORKSPACE_UNAVAILABLE', 'Flovart 当前没有可用的 Workflow。', true);
  return project;
}

function locatorKey(locator: HostSelection['locator']): string {
  return JSON.stringify(Object.entries(locator).sort(([left], [right]) => left.localeCompare(right)));
}

function sameSelection(left: HostSelection, right: HostSelection): boolean {
  return left.host === right.host
    && left.selectionId === right.selectionId
    && locatorKey(left.locator) === locatorKey(right.locator);
}

export function buildStudioReferenceOperations(
  project: WorkflowProject,
  selection: HostSelection,
  prompt: string,
  createId: () => string = () => nanoid(),
  materializedResource: WorkflowResource = hostSelectionResource(selection),
): { sourceNodeId: string; targetNodeId: string; operations: WorkflowDocumentOperation[] } {
  const sourceNodeId = createId();
  const targetNodeId = createId();
  const x = Math.max(...project.nodes.map(node => node.position.x + node.width), 0) + 80;
  const y = project.nodes.at(-1)?.position.y || 80;
  const source = createWorkflowNode(sourceNodeId, materializedResource.kind, { x, y }, {
    name: selection.label,
    mimeType: selection.mimeType,
    naturalWidth: selection.width,
    naturalHeight: selection.height,
    durationMs: selection.durationMs,
    resourceLocator: materializedResource.locator,
  });
  source.title = selection.label;
  const target = createWorkflowNode(targetNodeId, 'image', { x: x + source.width + 80, y }, {
    prompt: prompt.trim(),
    config: { mode: 'image', submode: 'image-to-image' },
  });
  target.title = 'Flovart 结果';
  return {
    sourceNodeId,
    targetNodeId,
    operations: [
      { type: 'add_node', node: source },
      { type: 'create_connected_node', fromNodeId: sourceNodeId, node: target },
    ],
  };
}

export class StudioWorkflowController {
  constructor(
    private readonly adapter: CreativeHostAdapter,
    private readonly core: FlovartStudioCore,
    private readonly createId: () => string = () => nanoid(),
  ) {}

  private async assertSelection(context: HostContext, selection: HostSelection) {
    const currentContext = await this.adapter.getContext();
    const currentSelection = await this.adapter.getSelection();
    if (
      !currentContext.available
      || (context.documentId && currentContext.documentId && context.documentId !== currentContext.documentId)
      || !currentSelection
      || !sameSelection(selection, currentSelection)
    ) {
      throw new StudioContractError('HOST_CONTEXT_UNAVAILABLE', '创作软件中的文档或选择已变化，请重新选择后再制作。', true);
    }
  }

  async generate(prompt: string, target?: HostImportTarget): Promise<StudioGenerationResult> {
    const context = await this.adapter.getContext();
    if (!context.available) throw new StudioContractError('HOST_CONTEXT_UNAVAILABLE', '当前创作软件没有可用文档。', true);
    const selection = await this.adapter.getSelection();
    if (!selection) throw new StudioContractError('HOST_CONTEXT_UNAVAILABLE', '请先在创作软件中选择一个素材。');
    if (!prompt.trim()) throw new StudioContractError('INPUT_RESOLUTION_FAILED', '请输入这次制作的描述。');

    const materialized = await this.adapter.materializeSelection(selection);
    // 提交前最后一次确认宿主上下文没有漂移；此后不再读 live selection。
    await this.assertSelection(context, selection);
    await this.core.registerHostResource(materialized);
    const project = requireProject(await this.core.inspect(context.projectId));
    const graph = buildStudioReferenceOperations(project, selection, prompt, this.createId, materialized.resource);

    // ── 冻结 ExecutionTarget：之后 run 提交、artifact 回写都只认这份快照。───
    const executionTarget: StudioExecutionTarget = Object.freeze({
      projectId: project.id,
      nodeId: graph.targetNodeId,
      selectionSnapshot: freezeSelection(selection),
      references: Object.freeze([materialized.reference]),
      outputTarget: freezeOutputTarget(target, selection),
      hostTarget: selection.host,
      revision: project.draftVersion || 1,
    });

    const mutationId = this.createId();
    const applyRequest: StudioApplyRequest = {
      projectId: executionTarget.projectId,
      expectedRevision: executionTarget.revision,
      mutationId,
      idempotencyKey: mutationId,
      operations: graph.operations,
      intent: `从${context.title || context.host}选择「${selection.label}」并生成新图层`,
    };
    const applied = await this.core.apply(applyRequest);
    const run = await this.core.run({
      projectId: executionTarget.projectId,
      nodeId: executionTarget.nodeId,
      expectedRevision: workflowResultRevision(applied),
      idempotencyKey: this.createId(),
    });
    const taskId = workflowResultTaskId(run);
    const artifactId = workflowResultArtifactId(run);
    if (!taskId && !artifactId) throw new StudioContractError('HOST_IMPORT_FAILED', 'Flovart 没有返回可回写的制作产物。', true);
    const artifact = await this.core.artifactGet({ ...(taskId ? { taskId } : {}), ...(artifactId ? { artifactId } : {}) });
    if (!artifact) throw new StudioContractError('HOST_IMPORT_FAILED', 'Flovart 已运行，但暂时没有可回写的产物。', true);
    // 回写只使用冻结的 outputTarget（携带 submit 时宿主文档/选择的 pin），
    // 即使运行期间 live selection 换成 B，产物仍落在 A 对应的文档/输出位置。
    const imported: HostImportResult = await this.adapter.importArtifact(artifact, executionTarget.outputTarget);
    if (!imported.ok) throw new StudioContractError('HOST_IMPORT_FAILED', imported.message || '生成结果回写创作软件失败。', true);
    return {
      projectId: executionTarget.projectId,
      sourceNodeId: graph.sourceNodeId,
      targetNodeId: executionTarget.nodeId,
      run,
      import: imported,
      materialized,
      executionTarget,
    };
  }
}
