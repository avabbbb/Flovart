import { nanoid } from 'nanoid';
import { dispatchWorkflowCommand, type WorkflowCommandEnvelope } from '../workflowDispatcher';
import { createWorkflowNode } from '../../components/workflow/constants';
import { ingestWorkflowMedia, loadWorkflowMediaBlob } from '../../components/workflow/media';
import { useWorkflowStore } from '../../components/workflow/store';
import type { WorkflowNode, WorkflowProject } from '../../components/workflow/types';
import { loadCreativeHostResource, registerCreativeHostResource } from './hostResourceRegistry';
import { createFlovartStudioCore } from './studioClient';
import { loadWorkflowArtifact } from './artifactRegistry';
import { StudioWorkflowController } from './studioWorkflow';
import { hostSelectionResource, hostSelectionReference, StudioContractError } from './studioContract';
import type { CreativeHostAdapter, FlovartArtifact, HostContext, HostImportResult, HostImportTarget, HostSelection, MaterializedHostSelection, StudioApplyRequest, StudioRunRequest } from './studioContract';
import { displayError } from '../displayError';

/**
 * Browser-Link 桥：把宿主面板等待的 __FLOVART_* 注入全局接到浏览器里的
 * Workflow authority。面板 ≠ 第二份状态——__FLOVART_BROWSER_WORKSPACE__ 只暴露
 * live getter（每次调用重新读 store），generate() 经由
 * createFlovartStudioCore → dispatchWorkflowCommand → applyWorkflowMutation，
 * 目标对象、draftVersion、mutationId/幂等回执、撤销栈全部仍由
 * draftAuthority/store 持有；本模块只做连线，不持有可变业务状态。
 *
 * Runtime 直连（绕过浏览器）会绕过 draftAuthority 的 expectedRevision/
 * mutationId 闸、丢 selection 绑定、避开 confirmWrite/费用确认——故不采用。
 */

const CONTROLLER_KEY = '__FLOVART_STUDIO_CONTROLLER__';
const OPEN_CANVAS_KEY = '__FLOVART_OPEN_CANVAS__';
const WORKSPACE_KEY = '__FLOVART_BROWSER_WORKSPACE__';
const LINK_READY_EVENT = 'flovart:link-ready';

export type StudioBrowserLinkStatus =
  | { state: 'linked'; projectId: string; revision: number }
  | { state: 'unavailable'; reason: string; retryable: true };

type StudioGlobal = typeof globalThis & {
  [CONTROLLER_KEY]?: StudioWorkflowController | null;
  [OPEN_CANVAS_KEY]?: (() => Promise<unknown> | unknown) | null;
  [WORKSPACE_KEY]?: BrowserWorkspaceBridge | null;
};

/** 暴露给 host-contract.js 里 createBrowserWorkspaceAdapter 的最小面。 */
export interface BrowserWorkspaceBridge {
  getActiveProject(): WorkflowProject | null;
  materializeSelection(args: { selection: HostSelection }): Promise<MaterializedHostSelection | { blob: Blob; kind?: string; mimeType?: string }>;
  importArtifact(args: { artifact: FlovartArtifact; target?: HostImportTarget }): Promise<HostImportResult>;
  subscribeContext?(listener: (context: unknown) => void): { dispose(): void };
}

function studioGlobal(): StudioGlobal {
  return globalThis as StudioGlobal;
}

/**
 * 面板↔Browser Workflow 之间的命令执行器：与 managed Agent SSE tool_call 到达
 * 浏览器后走的入口相同（workflowContract.dispatch → dispatchWorkflowCommand），
 * 因此 lease/revision/idempotency 语义完全一致。source 用 'operator' 表达
 * 「面板是工作区内的人类操作入口」，不伪装成外部 agent 写者。
 */
async function dispatchStudioCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
  const envelope: WorkflowCommandEnvelope = {
    id: `studio-link:${nanoid()}`,
    command,
    args,
    source: 'operator',
    ...(typeof args.idempotencyKey === 'string' ? { idempotencyKey: args.idempotencyKey } : {}),
  };
  const result = await dispatchWorkflowCommand(envelope);
  if (result.confirmation?.required) {
    throw new StudioContractError(
      'WORKSPACE_UNAVAILABLE',
      `这次制作需要先在 Flovart 画布中确认：${result.confirmation.summary}`,
      true,
    );
  }
  if (!result.ok) {
    const code = result.error?.code || 'COMMAND_FAILED';
    throw new StudioContractError(
      code === 'REVISION_CONFLICT' || code === 'NOT_FOUND' ? 'WORKSPACE_UNAVAILABLE' : 'HOST_IMPORT_FAILED',
      result.error?.message || 'Flovart 命令执行失败。',
      true,
    );
  }
  return result.result;
}

/** 显式降级：没有可用 Workflow 工程时走真实失败，不假成功。 */
function requireWorkspaceProject(projectId?: string): WorkflowProject {
  const state = useWorkflowStore.getState();
  const project = projectId
    ? state.projects.find(item => item.id === projectId)
    : state.projects.find(item => item.id === state.activeProjectId) || state.projects[0];
  if (!project) {
    throw new StudioContractError(
      'WORKSPACE_UNAVAILABLE',
      '请先打开 Flovart 画布（Workflow）后再从面板制作；面板不会离线伪造生成结果。',
      true,
    );
  }
  return project;
}

function findNode(project: WorkflowProject, selection: HostSelection): WorkflowNode | null {
  return project.nodes.find(node => node.id === selection.selectionId)
    || project.nodes.find(node => node.id === selection.locator.nodeId)
    || null;
}

/**
 * 把 materialized 宿主选择转成画布可执行 Blob：优先节点自己的
 * storageKey/href/artifactRef，再退回 creative-host 会话注册表。
 * 素材字节仍由 workflow storage/registry 持有——这里只做读取，不复制。
 */
async function materializeWorkflowSelection(selection: HostSelection): Promise<MaterializedHostSelection> {
  const project = requireWorkspaceProject(String(selection.locator.projectId || '') || undefined);
  const node = findNode(project, selection);
  if (!node) throw new StudioContractError('HOST_CONTEXT_UNAVAILABLE', '画布当前选择已变化，请重新选择节点。', true);
  const metadata = node.metadata || {};
  let blob: Blob | null = null;
  if (metadata.resourceLocator?.kind === 'creative-host') {
    blob = await loadCreativeHostResource(metadata.resourceLocator);
  }
  if (!blob) {
    blob = await loadWorkflowMediaBlob(metadata.storageKey, metadata.href, metadata.artifactRef).catch(() => null);
  }
  if (!blob) {
    throw new StudioContractError('HOST_CONTEXT_UNAVAILABLE', '当前节点没有可执行的媒体，请先在画布中准备素材。', true);
  }
  const resource = hostSelectionResource(selection);
  return {
    selection,
    resource: { ...resource, kind: selection.kind, mimeType: selection.mimeType || blob.type },
    reference: hostSelectionReference(selection, resource),
    blob,
  };
}

/**
 * 产物回写：把 artifact 作为新节点经 workflow.apply 落到当前工程——
 * 与面板在真实宿主中「生成并添加」同一语义，且同样走 draftAuthority 的
 * mutationId/expectedRevision，可撤销、有回执。
 */
async function importArtifactToWorkspace(args: { artifact: FlovartArtifact; target?: HostImportTarget }): Promise<HostImportResult> {
  const { artifact } = args;
  const project = requireWorkspaceProject();
  const blob = artifact.blob || null;
  let storageKey: string | undefined;
  if (blob) {
    const file = new File([blob], artifact.name || `flovart-result.${artifact.mimeType === 'video/mp4' ? 'mp4' : 'png'}`, { type: artifact.mimeType });
    const record = await ingestWorkflowMedia(file);
    storageKey = record.storageKey;
  }
  const nodeId = `studio-result-${nanoid(8)}`;
  const x = Math.max(0, ...project.nodes.map(node => node.position.x + node.width)) + 80;
  const y = project.nodes.at(-1)?.position.y || 80;
  const node = createWorkflowNode(nodeId, artifact.kind === 'video' ? 'video' : artifact.kind === 'audio' ? 'audio' : 'image', { x, y }, {
    ...(storageKey ? { storageKey } : {}),
    ...(artifact.href ? { href: artifact.href } : {}),
    mimeType: artifact.mimeType,
  });
  node.title = artifact.name || 'Flovart 结果';
  const mutationId = `studio-import-${nanoid(8)}`;
  const result = await dispatchWorkflowCommand({
    id: `studio-link:${nanoid()}`,
    command: 'workflow.apply',
    source: 'operator',
    idempotencyKey: mutationId,
    args: {
      projectId: project.id,
      expectedRevision: project.draftVersion || 1,
      mutationId,
      idempotencyKey: mutationId,
      operations: [{ type: 'add_node', node }],
      intent: `导入 Flovart 产物「${node.title}」`,
    },
  });
  if (!result.ok) {
    throw new StudioContractError('HOST_IMPORT_FAILED', result.error?.message || '产物写入画布失败。', true);
  }
  return { ok: true, targetId: nodeId, message: `已添加「${node.title}」到当前画布。` };
}

export interface StudioBrowserLinkHandle {
  controller: StudioWorkflowController;
  dispose(): void;
  status(): StudioBrowserLinkStatus;
}

export interface InstallStudioBrowserLinkOptions {
  /** 面板侧 adapter；缺省时注入同包 host-contract 的 browser-workspace 适配器所需的工作区桥。 */
  adapter?: CreativeHostAdapter;
  /** 「打开画布」动作；缺省时面板给出明确的未连接提示而非假死。 */
  openCanvas?: () => Promise<unknown> | unknown;
  target?: StudioGlobal;
}

/**
 * 装配并注入面板契约：__FLOVART_BROWSER_WORKSPACE__（live getter，供
 * host-contract.js 的 createBrowserWorkspaceAdapter 用）+ __FLOVART_STUDIO_CONTROLLER__
 * + __FLOVART_OPEN_CANVAS__，并广播 flovart:link-ready。
 * 无 Workflow 工程时 controller 仍在，但其 generate() 经 requireWorkspaceProject
 * 显式失败——面板状态行显示「等待 Flovart」，而不是假链接。
 */
export function installStudioBrowserLink(options: InstallStudioBrowserLinkOptions = {}): StudioBrowserLinkHandle {
  const globalScope = options.target || studioGlobal();

  const workspaceBridge: BrowserWorkspaceBridge = {
    getActiveProject: () => {
      const state = useWorkflowStore.getState();
      return state.projects.find(item => item.id === state.activeProjectId) || state.projects[0] || null;
    },
    materializeSelection: ({ selection }) => materializeWorkflowSelection(selection),
    importArtifact: args => importArtifactToWorkspace(args),
  };
  globalScope[WORKSPACE_KEY] = workspaceBridge;

  const adapter = options.adapter || createBrowserWorkspaceAdapter(globalScope);

  const core = createFlovartStudioCore(dispatchStudioCommand, {
    registerHostResource: async materialized => registerCreativeHostResource(materialized),
    artifactGet: async args => loadWorkflowArtifact(args.artifactId || args.taskId || ''),
  });

  // 显式降级：inspect/apply/run 在没有任何 Workflow 工程时不假成功。
  const guardedCore = {
    ...core,
    inspect: async (projectId?: string) => core.inspect(requireWorkspaceProject(projectId).id),
    apply: async (request: StudioApplyRequest) => {
      requireWorkspaceProject(request.projectId);
      return core.apply(request);
    },
    run: async (request: StudioRunRequest) => {
      requireWorkspaceProject(request.projectId);
      return core.run(request);
    },
  };

  const controller = new StudioWorkflowController(adapter, guardedCore);
  globalScope[CONTROLLER_KEY] = controller;
  globalScope[OPEN_CANVAS_KEY] = options.openCanvas || (() => {
    throw new StudioContractError('WORKSPACE_UNAVAILABLE', '请连接 Flovart 后打开画布。', true);
  });
  globalScope.dispatchEvent?.(new Event(LINK_READY_EVENT));

  return {
    controller,
    status() {
      try {
        const project = requireWorkspaceProject();
        return { state: 'linked', projectId: project.id, revision: project.draftVersion || 1 };
      } catch (error) {
        return { state: 'unavailable', reason: displayError(error), retryable: true };
      }
    },
    dispose() {
      if (globalScope[CONTROLLER_KEY] === controller) globalScope[CONTROLLER_KEY] = null;
      if (globalScope[WORKSPACE_KEY] === workspaceBridge) globalScope[WORKSPACE_KEY] = null;
      globalScope[OPEN_CANVAS_KEY] = null;
    },
  };
}

/**
 * 与 integrations/studio/shared/host-contract.js 中 createBrowserWorkspaceAdapter
 * 同形的 TS 版：面板绑 Browser Workflow 的 live 选择而非宿主进程。默认导出供
 * installStudioBrowserLink 在调用方没自带 adapter 时使用。
 */
function createBrowserWorkspaceAdapter(globalScope: StudioGlobal): CreativeHostAdapter {
  const workspace = (): BrowserWorkspaceBridge => {
    const api = globalScope[WORKSPACE_KEY];
    if (!api || typeof api.getActiveProject !== 'function') {
      throw new StudioContractError('HOST_CONTEXT_UNAVAILABLE', 'Flovart Browser Workflow 尚未注入工作区连接。', true);
    }
    return api;
  };
  const projectOf = () => workspace().getActiveProject() || null;
  const selectionFromProject = (project: WorkflowProject | null): HostSelection | null => {
    if (!project || !Array.isArray(project.nodes)) return null;
    const selectedIds = Array.isArray(project.selectedNodeIds) ? project.selectedNodeIds : [];
    const node = project.nodes.find(item => selectedIds.includes(item.id)) || null;
    if (!node) return null;
    return {
      host: 'browser-workspace',
      selectionId: String(node.id),
      label: node.title || String(node.id),
      kind: node.type === 'video' ? 'video' : 'image',
      locator: { projectId: String(project.id), nodeId: String(node.id) },
      mimeType: node.metadata?.mimeType,
      width: node.metadata?.naturalWidth,
      height: node.metadata?.naturalHeight,
      ...(Number.isFinite(node.metadata?.durationMs) ? { durationMs: node.metadata!.durationMs } : {}),
    };
  };
  const adapter: CreativeHostAdapter = {
    id: 'browser-workspace',
    async getContext() {
      const project = projectOf();
      return {
        host: 'browser-workspace',
        available: Boolean(project),
        ...(project ? { projectId: project.id, documentId: project.id, documentName: project.title, title: project.title } : {}),
      };
    },
    async getSelection() {
      return selectionFromProject(projectOf());
    },
    async materializeSelection(selection) {
      const current = selectionFromProject(projectOf());
      if (!current || current.selectionId !== selection.selectionId || locatorKeyOf(current.locator) !== locatorKeyOf(selection.locator)) {
        throw new StudioContractError('HOST_CONTEXT_UNAVAILABLE', 'Flovart 画布当前选择已变化，请重新选择节点。', true);
      }
      const result = await workspace().materializeSelection({ selection });
      if (result && 'resource' in result && 'reference' in result) return result as MaterializedHostSelection;
      const details = result as { blob?: Blob; kind?: 'image' | 'video'; mimeType?: string };
      const resource = hostSelectionResource({ ...selection, ...(details.kind ? { kind: details.kind } : {}), ...(details.mimeType ? { mimeType: details.mimeType } : selection.mimeType ? { mimeType: selection.mimeType } : {}) });
      return { selection, resource, reference: hostSelectionReference(selection, resource), ...(details.blob ? { blob: details.blob } : {}) };
    },
    async importArtifact(artifact, target = { kind: 'new-layer' }) {
      return workspace().importArtifact({ artifact, target });
    },
    subscribeContext(listener) {
      const api = workspace();
      if (typeof api.subscribeContext === 'function') return api.subscribeContext(listener);
      const timer = setInterval(async () => listener(await adapter.getContext()), 500);
      return { dispose: () => clearInterval(timer) };
    },
  };
  return adapter;
}

function locatorKeyOf(locator: HostSelection['locator']): string {
  return JSON.stringify(Object.entries(locator).sort(([left], [right]) => left.localeCompare(right)));
}
