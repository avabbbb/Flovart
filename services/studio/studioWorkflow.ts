import { createWorkflowNode } from '../../components/workflow/constants';
import type { WorkflowDocumentOperation, WorkflowHostSendRequest, WorkflowProject } from '../../components/workflow/types';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { nanoid } from 'nanoid';
import { hostSelectionReference, hostSelectionResource, StudioContractError, type CreativeHostAdapter, type FlovartArtifact, type FlovartStudioCore, type HostArtifactPersistence, type HostContext, type HostImportResult, type HostImportTarget, type HostSelection, type MaterializedHostSelection, type StudioApplyRequest, type StudioExecutionTarget, type StudioGenerationCandidate, type WorkflowResource } from './studioContract';
import { workflowResultArtifactId, workflowResultRevision, workflowResultTaskId } from './studioClient';

export type { StudioExecutionTarget } from './studioContract';

export interface CanvasSendRequest {
  projectId: string;
  nodeId: string;
  title: string;
  request: WorkflowHostSendRequest;
}

const ARTIFACT_HASH_CHUNK_SIZE = 1024 * 1024;

function blobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  if (typeof FileReader === 'undefined') return Promise.reject(new Error('当前环境无法读取候选素材字节。'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('读取候选素材失败。'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('候选素材读取结果不是二进制数据。'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

async function hashArtifactBlob(blob: Blob): Promise<string> {
  const hasher = sha256.create();
  for (let offset = 0; offset < blob.size; offset += ARTIFACT_HASH_CHUNK_SIZE) {
    const chunk = new Uint8Array(await blobArrayBuffer(blob.slice(offset, offset + ARTIFACT_HASH_CHUNK_SIZE)));
    hasher.update(chunk);
    if (offset + chunk.byteLength < blob.size) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return bytesToHex(hasher.digest());
}

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

interface PreparedStudioGeneration extends Omit<StudioGenerationResult, 'import'> {
  artifact: FlovartArtifact;
}

type FlovartArtifactWithIntegrity = FlovartArtifact & {
  artifactId: string;
  blob: Blob;
  sha256: string;
  byteSize: number;
};

interface CandidateImportState {
  candidate: StudioGenerationCandidate;
  importPromise?: Promise<HostImportResult>;
  importedResult?: HostImportResult;
  unknownResult?: HostImportResult;
}

/** 冻结 outputTarget：把 submit 时的宿主文档/选择 locator 钉进 import target，
 *  宿主适配器据此定位原作文档而不是"当前激活"文档；未指定 target 时保持
 *  undefined，沿用各宿主适配器自己的默认输出位置。 */
function freezeOutputTarget(target: HostImportTarget | undefined, selection: HostSelection): HostImportTarget | undefined {
  if (!target) return undefined;
  const documentId = selection.locator.documentId;
  const pinned: HostImportTarget & { documentId?: string; sourceSelectionId?: string } = { ...target };
  if (typeof documentId === 'string' || typeof documentId === 'number') pinned.documentId = String(documentId);
  const projectId = selection.locator.projectId;
  if (typeof projectId === 'string' || typeof projectId === 'number') pinned.projectId = String(projectId);
  pinned.sourceSelectionId = selection.selectionId;
  return Object.freeze(pinned);
}

function normalizeMimeType(value: string): string {
  return value.split(';', 1)[0].trim().toLowerCase();
}

function freezePersistenceReceipt(receipt: HostArtifactPersistence, artifact: FlovartArtifactWithIntegrity): HostArtifactPersistence {
  const mimeType = normalizeMimeType(receipt.mimeType || '');
  if (receipt.status !== 'persisted'
      || !receipt.artifactId
      || !/^[a-f0-9]{64}$/i.test(receipt.sha256)
      || receipt.sha256.toLowerCase() !== artifact.sha256
      || !Number.isSafeInteger(receipt.byteSize)
      || receipt.byteSize !== artifact.byteSize
      || mimeType !== normalizeMimeType(artifact.mimeType)
      || !receipt.createdAt) {
    throw new StudioContractError('HOST_IMPORT_FAILED', 'Resolve 没有为候选返回匹配的 durable artifact 回执。', true);
  }
  if (receipt.artifactId !== artifact.artifactId
      || (receipt.taskId && artifact.taskId && receipt.taskId !== artifact.taskId)
      || (receipt.modelId && artifact.modelId && receipt.modelId !== artifact.modelId)) {
    throw new StudioContractError('HOST_IMPORT_FAILED', 'Resolve 持久化回执的素材身份与候选不一致。', true);
  }
  // Copy only the public receipt contract. A host bridge must never expose its local path here.
  return Object.freeze({
    status: 'persisted',
    artifactId: receipt.artifactId,
    ...(receipt.taskId ? { taskId: receipt.taskId } : {}),
    ...(receipt.modelId ? { modelId: receipt.modelId } : {}),
    sha256: receipt.sha256.toLowerCase(),
    byteSize: receipt.byteSize,
    mimeType,
    createdAt: receipt.createdAt,
  });
}

function freezeSelection(selection: HostSelection): HostSelection {
  return Object.freeze({ ...selection, locator: Object.freeze({ ...selection.locator }) });
}

function requireProject(project: WorkflowProject | null | undefined): WorkflowProject {
  if (!project) throw new StudioContractError('WORKSPACE_UNAVAILABLE', 'Iris 当前没有可用的 Workflow。', true);
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
  target.title = 'Iris 结果';
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
  private readonly candidates = new Map<string, CandidateImportState>();

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

  private async runGeneration(prompt: string, target?: HostImportTarget): Promise<PreparedStudioGeneration> {
    const context = await this.adapter.getContext();
    if (!context.available) throw new StudioContractError('HOST_CONTEXT_UNAVAILABLE', '当前创作软件没有可用文档。', true);
    const liveSelection = await this.adapter.getSelection();
    if (!liveSelection) throw new StudioContractError('HOST_CONTEXT_UNAVAILABLE', '请先在创作软件中选择一个素材。');
    const selection = freezeSelection(liveSelection);
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
    if (!taskId && !artifactId) throw new StudioContractError('HOST_IMPORT_FAILED', 'Iris 没有返回可回写的制作产物。', true);
    const artifact = await this.core.artifactGet({ ...(taskId ? { taskId } : {}), ...(artifactId ? { artifactId } : {}) });
    if (!artifact) throw new StudioContractError('HOST_IMPORT_FAILED', 'Iris 已运行，但暂时没有可回写的产物。', true);
    return {
      projectId: executionTarget.projectId,
      sourceNodeId: graph.sourceNodeId,
      targetNodeId: executionTarget.nodeId,
      run,
      materialized,
      executionTarget,
      artifact: {
        ...artifact,
        ...(artifact.artifactId || !artifactId ? {} : { artifactId }),
        ...(artifact.taskId || !taskId ? {} : { taskId }),
      },
    };
  }

  async generate(prompt: string, target?: HostImportTarget): Promise<StudioGenerationResult> {
    const prepared = await this.runGeneration(prompt, target);
    // 回写只使用冻结的 outputTarget（携带 submit 时宿主文档/选择的 pin），
    // 即使运行期间 live selection 换成 B，产物仍落在 A 对应的文档/输出位置。
    const artifact = prepared.artifact;
    if (prepared.executionTarget.hostTarget === 'after-effects') {
      if (!artifact.blob) throw new StudioContractError('HOST_IMPORT_FAILED', 'After Effects 固定素材需要可读取的本地产物字节。', true);
      if (artifact.blob.size === 0) throw new StudioContractError('HOST_IMPORT_FAILED', 'Iris 返回了空素材，无法固定为版本。', true);
      artifact.sha256 = await hashArtifactBlob(artifact.blob);
      artifact.byteSize = artifact.blob.size;
    }
    const imported: HostImportResult = await this.adapter.importArtifact(artifact, prepared.executionTarget.outputTarget);
    if (!imported.ok) throw new StudioContractError('HOST_IMPORT_FAILED', imported.message || '生成结果回写创作软件失败。', true);
    return {
      projectId: prepared.projectId,
      sourceNodeId: prepared.sourceNodeId,
      targetNodeId: prepared.targetNodeId,
      run: prepared.run,
      import: imported,
      materialized: prepared.materialized,
      executionTarget: prepared.executionTarget,
    };
  }

  async prepareCandidate(
    prompt: string,
    target: HostImportTarget = { kind: 'media-pool' },
    _onProgress?: (progress: number) => void,
  ): Promise<StudioGenerationCandidate> {
    if (this.adapter.id !== 'resolve') throw new StudioContractError('HOST_IMPORT_FAILED', '候选审核当前仅用于 Resolve Media Pool。');
    if (target.kind !== 'media-pool') throw new StudioContractError('HOST_IMPORT_FAILED', 'Resolve 候选必须先进入 Media Pool。');
    const prepared = await this.runGeneration(prompt, target);
    return this.persistCandidate(prepared.artifact, prepared.executionTarget, prepared.run, prepared.materialized);
  }

  /** 校验字节 / SHA-256 / 格式并 durable 持久化，登记为待导入候选（生成候选与 Canvas 发送共用）。 */
  private async persistCandidate(
    artifact: FlovartArtifact,
    executionTarget: StudioExecutionTarget,
    run: unknown,
    materialized: MaterializedHostSelection,
  ): Promise<StudioGenerationCandidate> {
    if (!artifact.blob || artifact.blob.size <= 0) {
      throw new StudioContractError('HOST_IMPORT_FAILED', 'Resolve 候选需要可读取的非空本地产物字节。', true);
    }
    const declaredByteSize = artifact.byteSize;
    if (declaredByteSize !== undefined && declaredByteSize !== artifact.blob.size) {
      throw new StudioContractError('HOST_IMPORT_FAILED', 'Resolve 候选字节数与素材不一致。', true);
    }
    const digest = await hashArtifactBlob(artifact.blob);
    if (artifact.sha256 && artifact.sha256.toLowerCase() !== digest) {
      throw new StudioContractError('HOST_IMPORT_FAILED', 'Resolve 候选 SHA-256 与素材不一致。', true);
    }
    const normalizedArtifact: FlovartArtifactWithIntegrity = {
      ...artifact,
      artifactId: artifact.artifactId || this.createId(),
      ...(artifact.taskId ? { taskId: artifact.taskId } : {}),
      blob: artifact.blob,
      mimeType: normalizeMimeType(artifact.mimeType || artifact.blob.type),
      sha256: digest,
      byteSize: artifact.blob.size,
    };
    if (!normalizedArtifact.mimeType) throw new StudioContractError('HOST_IMPORT_FAILED', 'Resolve 候选缺少素材格式。', true);
    if (!this.adapter.persistArtifact) throw new StudioContractError('HOST_IMPORT_FAILED', 'Resolve 当前没有 durable artifact 持久化能力。', true);
    const rawReceipt = await this.adapter.persistArtifact(normalizedArtifact);
    const persistenceReceipt = freezePersistenceReceipt(rawReceipt, normalizedArtifact);
    const candidateId = this.createId();
    if (this.candidates.has(candidateId)) throw new StudioContractError('HOST_IMPORT_FAILED', '候选身份冲突，请重试。', true);
    const candidate: StudioGenerationCandidate = Object.freeze({
      candidateId,
      artifact: Object.freeze(normalizedArtifact),
      persistenceReceipt,
      executionTarget,
      run,
      materialized,
    });
    this.candidates.set(candidateId, { candidate });
    return candidate;
  }

  /**
   * Canvas 登记的“发送到宿主”请求（只读）。只列出属于当前宿主、当前宿主项目、仍待确认的请求。
   * 宿主项目身份不一致时不列出，避免把结果导入到别的 Resolve 项目。
   */
  async listCanvasSendRequests(): Promise<CanvasSendRequest[]> {
    const context = await this.adapter.getContext();
    if (!context.available) return [];
    const project = requireProject(await this.core.inspect());
    return project.nodes
      .filter(node => node.metadata.hostSend?.status === 'requested' && node.metadata.hostSend.host === this.adapter.id)
      .filter(node => !node.metadata.hostSend?.hostProjectId || !context.projectId || node.metadata.hostSend.hostProjectId === context.projectId)
      .map(node => ({ projectId: project.id, nodeId: node.id, title: node.title, request: node.metadata.hostSend! }));
  }

  /**
   * 用户在宿主面板确认后执行一个 Canvas 发送请求：取运行产物 → 校验并持久化 → 导入 Media Pool →
   * 把结果写回请求状态。复用候选导入的全部安全检查（冻结宿主项目、未知结果不重试）。
   */
  async sendCanvasResult(nodeId: string): Promise<HostImportResult> {
    if (this.adapter.id !== 'resolve') throw new StudioContractError('HOST_IMPORT_FAILED', '从画布发送当前仅支持 Resolve Media Pool。');
    const context = await this.adapter.getContext();
    if (!context.available) throw new StudioContractError('HOST_CONTEXT_UNAVAILABLE', '当前 Resolve 没有可用项目。', true);
    const project = requireProject(await this.core.inspect());
    const node = project.nodes.find(item => item.id === nodeId);
    const request = node?.metadata.hostSend;
    if (!node || !request || request.host !== this.adapter.id || request.status !== 'requested') {
      throw new StudioContractError('HOST_IMPORT_FAILED', '找不到这个画布发送请求，可能已处理或被撤销。');
    }
    if (request.hostProjectId && context.projectId && request.hostProjectId !== context.projectId) {
      throw new StudioContractError('HOST_CONTEXT_UNAVAILABLE', '这个结果属于另一个 Resolve 项目，请切回原项目后再导入。', true);
    }
    const ref = node.metadata.artifactRef;
    if (!ref?.taskId && !ref?.artifactId) {
      throw new StudioContractError('HOST_IMPORT_FAILED', '这个结果还没有可交接的运行产物；请在画布中重新运行后再发送。', true);
    }
    const artifact = await this.core.artifactGet({ ...(ref.taskId ? { taskId: ref.taskId } : {}), ...(ref.artifactId ? { artifactId: ref.artifactId } : {}) });
    if (!artifact) throw new StudioContractError('HOST_IMPORT_FAILED', 'Iris 暂时取不到这个结果的产物，请稍后重试。', true);
    const selection: HostSelection = freezeSelection({
      host: this.adapter.id,
      selectionId: request.sourceNodeId,
      label: node.title,
      kind: 'video',
      locator: { ...request.sourceLocator },
    });
    const resource = hostSelectionResource(selection);
    const materialized: MaterializedHostSelection = { selection, resource, reference: hostSelectionReference(selection, resource) };
    const executionTarget: StudioExecutionTarget = Object.freeze({
      projectId: project.id,
      nodeId,
      selectionSnapshot: selection,
      references: Object.freeze([materialized.reference]),
      outputTarget: freezeOutputTarget({ kind: 'media-pool' }, selection),
      hostTarget: selection.host,
      revision: project.draftVersion || 1,
    });
    const candidate = await this.persistCandidate(artifact, executionTarget, null, materialized);
    const result = await this.importCandidate(candidate.candidateId);
    await this.recordCanvasSendResult(project.id, nodeId, result);
    return result;
  }

  private async recordCanvasSendResult(projectId: string, nodeId: string, result: HostImportResult) {
    const status = result.importStatus === 'confirmed' ? 'imported' : result.importStatus === 'rejected' ? 'rejected' : 'unknown';
    // 状态回写失败不改变导入事实：导入结果已返回给面板，画布下次刷新可重试回写。
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const latest = requireProject(await this.core.inspect(projectId));
      const current = latest.nodes.find(item => item.id === nodeId)?.metadata.hostSend;
      if (!current) return;
      const mutationId = this.createId();
      try {
        await this.core.apply({
          projectId: latest.id,
          expectedRevision: latest.draftVersion || 1,
          mutationId,
          idempotencyKey: mutationId,
          operations: [{ type: 'update_node', id: nodeId, metadata: { hostSend: { ...current, status, updatedAt: new Date().toISOString(), ...(result.message ? { message: result.message } : {}) } } }],
          intent: status === 'imported' ? '结果已加入 Resolve Media Pool' : '记录 Resolve 导入结果',
        });
        return;
      } catch {
        // revision 冲突：重读一次再试；仍失败则放弃回写。
      }
    }
  }

  async importCandidate(candidateId: string): Promise<HostImportResult> {
    const state = this.candidates.get(candidateId);
    if (!state) throw new StudioContractError('HOST_IMPORT_FAILED', '找不到待导入的 Resolve 候选，请重新打开任务。');
    if (state.importedResult) return state.importedResult;
    if (state.unknownResult) return state.unknownResult;
    if (state.importPromise) return state.importPromise;

    state.importPromise = Promise.resolve().then(async () => {
      try {
        const result = await this.adapter.importArtifact(
          state.candidate.artifact,
          state.candidate.executionTarget.outputTarget,
          state.candidate.persistenceReceipt,
        );
        const importStatus = result.importStatus === 'rejected'
          ? 'rejected'
          : result.importStatus === 'unknown' || !result.ok
            ? 'unknown'
            : 'confirmed';
        const classified: HostImportResult = {
          ...result,
          ok: importStatus === 'confirmed',
          importStatus,
        };
        if (importStatus === 'confirmed') state.importedResult = classified;
        if (importStatus === 'unknown') state.unknownResult = classified;
        return classified;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error || '未知错误');
        const classified: HostImportResult = {
          ok: false,
          importStatus: 'unknown',
          artifactId: state.candidate.artifact.artifactId,
          taskId: state.candidate.artifact.taskId,
          modelId: state.candidate.artifact.modelId,
          sha256: state.candidate.artifact.sha256,
          byteSize: state.candidate.artifact.byteSize,
          message: `Resolve 导入请求结果未知，请先检查 Media Pool 再决定后续操作。${detail ? ` ${detail}` : ''}`,
        };
        state.unknownResult = classified;
        return classified;
      }
    }).then(result => {
      state.importPromise = undefined;
      return result;
    });
    return state.importPromise;
  }
}
