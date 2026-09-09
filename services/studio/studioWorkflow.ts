import { createWorkflowNode } from '../../components/workflow/constants';
import type { WorkflowDocumentOperation, WorkflowProject } from '../../components/workflow/types';
import { nanoid } from 'nanoid';
import { hostSelectionResource, StudioContractError, type CreativeHostAdapter, type FlovartStudioCore, type HostContext, type HostImportResult, type HostImportTarget, type HostSelection, type MaterializedHostSelection, type StudioApplyRequest, type WorkflowResource } from './studioContract';
import { workflowResultArtifactId, workflowResultRevision, workflowResultTaskId } from './studioClient';

export interface StudioGenerationResult {
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  run: unknown;
  import?: HostImportResult;
  materialized: MaterializedHostSelection;
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
    await this.assertSelection(context, selection);
    await this.core.registerHostResource(materialized);
    const project = requireProject(await this.core.inspect(context.projectId));
    const graph = buildStudioReferenceOperations(project, selection, prompt, this.createId, materialized.resource);
    const mutationId = this.createId();
    const applyRequest: StudioApplyRequest = {
      projectId: project.id,
      expectedRevision: project.draftVersion || 1,
      mutationId,
      idempotencyKey: mutationId,
      operations: graph.operations,
      intent: `从${context.title || context.host}选择「${selection.label}」并生成新图层`,
    };
    const applied = await this.core.apply(applyRequest);
    const run = await this.core.run({
      projectId: project.id,
      nodeId: graph.targetNodeId,
      expectedRevision: workflowResultRevision(applied),
      idempotencyKey: this.createId(),
    });
    await this.assertSelection(context, selection);
    const taskId = workflowResultTaskId(run);
    const artifactId = workflowResultArtifactId(run);
    if (!taskId && !artifactId) throw new StudioContractError('HOST_IMPORT_FAILED', 'Flovart 没有返回可回写的制作产物。', true);
    const artifact = await this.core.artifactGet({ ...(taskId ? { taskId } : {}), ...(artifactId ? { artifactId } : {}) });
    if (!artifact) throw new StudioContractError('HOST_IMPORT_FAILED', 'Flovart 已运行，但暂时没有可回写的产物。', true);
    const imported: HostImportResult = await this.adapter.importArtifact(artifact, target);
    if (!imported.ok) throw new StudioContractError('HOST_IMPORT_FAILED', imported.message || '生成结果回写创作软件失败。', true);
    return { projectId: project.id, sourceNodeId: graph.sourceNodeId, targetNodeId: graph.targetNodeId, run, import: imported, materialized };
  }
}
