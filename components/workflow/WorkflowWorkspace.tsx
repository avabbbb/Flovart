import { nanoid } from 'nanoid';
import { useEffect, useState } from 'react';
import type { PromptEnhanceMode, PromptEnhanceResult, UserApiKey } from '../../types';
import type { RouteFallbackResolution } from '../../services/routeMapping';
import '../../styles/workflow.css';
import type { GenerationCapability, GenerationMode } from '../../services/generationCapabilities';
import { activateBrowserWorkflowWriter } from '../../services/agentHostDiscovery';
import { useAgentConnectionStore } from '../../stores/useAgentConnectionStore';
import { createWorkflowNode } from './constants';
import { applyWorkflowMutation, workflowDocumentOperationsFromFrames } from './draftAuthority';
import { InfiniteWorkflow } from './InfiniteWorkflow';
import { WorkflowGenerationCapabilitiesProvider, type WorkflowSharedMedia } from './WorkflowConfigPanel';
import { useWorkflowStore } from './store';
import type { WorkflowModelOptions } from './WorkflowNodePromptBar';
import type { WorkflowImageToolHandlers } from './WorkflowNodeToolbar';
import { WorkflowSidebar } from './WorkflowSidebar';
import { discardWorkflowMediaRecord, fitWorkflowMediaSize, ingestWorkflowMedia, inspectWorkflowMedia, loadWorkflowMediaBlob, releaseWorkflowMediaRecord, type WorkflowMediaRecord } from './media';
import { localFolderHref, readLocalFolderFile, type LocalFolderEntry } from '../../services/localFolderSource';
import type { AssetItem, AssetLibrary } from '../../types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import type { WorkflowNodeMetadata, WorkflowProject } from './types';
import type { PromptIntent } from './promptIntent';
import { displayError } from '../../services/displayError';

export interface WorkflowWorkspaceProps {
  theme: 'light' | 'dark';
  language: 'en' | 'zho';
  resolveGenerationCapability?: (mode: GenerationMode, modelId?: string) => GenerationCapability;
  sharedMedia?: WorkflowSharedMedia[];
  onReversePrompt?: (imageHref: string, mimeType: string, width?: number, height?: number) => Promise<string>;
  onRunNode?: (projectId: string, nodeId: string, promptIntent?: PromptIntent) => Promise<void> | void;
  onStopNode?: (projectId: string, nodeId: string) => void;
  onSaveWorkflowMedia?: (projectId: string, nodeId: string) => void;
  imageTools?: WorkflowImageToolHandlers;
  t: (key: string, ...args: any[]) => string;
  userApiKeys: UserApiKey[];
  confirmRouteFallback?: (resolution: RouteFallbackResolution) => boolean | Promise<boolean>;
  dynamicModelOptions: WorkflowModelOptions;
  onOpenSettings?: () => void;
  onEnhancePrompt?: (payload: { prompt: string; mode: PromptEnhanceMode; stylePreset?: string }) => Promise<PromptEnhanceResult>;
  isEnhancingPrompt?: boolean;
  onOpenAgent?: () => void;
  /** Reflects the global Agent drawer (mounted by the App shell, not here). */
  agentOpen?: boolean;
  focusNodeRequest?: { nodeId: string; nonce: number };
  assetLibrary: AssetLibrary;
  onRenameAsset: (id: string, name: string) => void;
  onRemoveAsset: (id: string) => void;
  onUpdateAssetTags?: (id: string, tags: string[]) => void;
  onRemoveAssetFromFolder?: (itemId: string, folderId: string) => void;
  onBatchRemoveAssets?: (ids: string[]) => void;
  onBatchAddAssetsToFolder?: (ids: string[], folderId: string) => void;
  onBatchAddAssetTags?: (ids: string[], tags: string[]) => void;
  onCreateFolder: (parentId: string | null, name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onRemoveFolder: (id: string, deleteItems: boolean) => void;
  /** Bubble a transient status toast up to the app shell (e.g. node deleted). */
  onNotify?: (message: string, level?: 'info' | 'success' | 'warning' | 'error') => void;
}

export interface WorkflowPatchResult {
  ok: boolean;
  error?: string;
}

/**
 * Shared media-insert entry point so the App-level right drawer (History tab)
 * and the in-canvas sidebar commit through the same mutation path — same
 * changeset/receipt bookkeeping, same media-record lifecycle.
 */
export async function insertSharedMediaIntoProject(media: WorkflowSharedMedia): Promise<WorkflowPatchResult> {
  const store = useWorkflowStore.getState();
  const activeProject = store.projects.find(project => project.id === store.activeProjectId) || null;
  if (!activeProject) return { ok: false, error: '没有可用的 Workflow 项目。' };
  const expectedProjectId = activeProject.id;
  let record: WorkflowMediaRecord | undefined;
  try {
    if (!/^https?:\/\//i.test(media.href)) {
      const blob = await loadWorkflowMediaBlob(undefined, media.href);
      record = await ingestWorkflowMedia(new File([blob], media.name, { type: blob.type || media.mimeType }));
    }
    if (!useWorkflowStore.getState().projects.some(project => project.id === expectedProjectId)) {
      if (record) await discardWorkflowMediaRecord(record.storageKey);
      return { ok: false };
    }
    const type = record?.type || media.type;
    const storedMetadata = record && (({ type: _type, ...metadata }) => metadata)(record);
    const current = useWorkflowStore.getState().projects.find(project => project.id === expectedProjectId);
    if (!current) {
      if (record) await discardWorkflowMediaRecord(record.storageKey);
      return { ok: false };
    }
    const nodes = layoutMediaNodes([{
      type,
      naturalWidth: record?.naturalWidth || media.width,
      naturalHeight: record?.naturalHeight || media.height,
      title: media.name,
      metadata: storedMetadata
        ? storedMetadata as WorkflowNodeMetadata
        : { href: media.href, mimeType: media.mimeType, name: media.name, naturalWidth: media.width, naturalHeight: media.height, status: 'success' },
    }], current);
    const committed = commitWorkflowProjectPatch(current.id, { nodes: [...current.nodes, ...nodes], selectedNodeIds: nodes.map(node => node.id) }, '从素材库插入媒体节点');
    if (!committed.ok) {
      if (record) await discardWorkflowMediaRecord(record.storageKey);
      return committed;
    }
    if (record) releaseWorkflowMediaRecord(record.storageKey);
    return { ok: true };
  } catch (error) {
    if (record) await discardWorkflowMediaRecord(record.storageKey);
    return { ok: false, error: displayError(error, '共享素材导入失败') };
  }
}

/** Apply a node/connection patch through the draft-authority mutation path so undo + receipts stay intact. */
export function commitWorkflowProjectPatch(projectId: string, patch: Partial<WorkflowProject>, intent: string): WorkflowPatchResult {
  const current = useWorkflowStore.getState().projects.find(project => project.id === projectId);
  if (!current) return { ok: false, error: '项目不存在或已删除。' };
  const ops = workflowDocumentOperationsFromFrames(
    { nodes: current.nodes, connections: current.connections },
    { nodes: patch.nodes || current.nodes, connections: patch.connections || current.connections },
  );
  if (!ops.length) {
    useWorkflowStore.getState().updateProject(projectId, patch);
    return { ok: true };
  }
  const result = applyWorkflowMutation(current, {
    projectId,
    expectedRevision: current.draftVersion || 1,
    mutationId: nanoid(),
    source: 'ui',
    intent,
    ops,
  });
  if (result.ok === false) return { ok: false, error: result.error.message };
  useWorkflowStore.getState().updateProject(projectId, {
    nodes: result.project.nodes,
    connections: result.project.connections,
    selectedNodeIds: patch.selectedNodeIds || result.project.selectedNodeIds,
    viewport: patch.viewport || result.project.viewport,
    draftVersion: result.project.draftVersion,
    draftChangeSets: result.project.draftChangeSets,
    draftRedoStack: result.project.draftRedoStack,
    workflowMutationReceipts: result.project.workflowMutationReceipts,
  });
  return { ok: true };
}

// 把一批媒体元数据按视口中心铺成节点；单条时保持原有"落在中心"的行为。
function layoutMediaNodes(
  items: Array<{ type: 'image' | 'video' | 'audio'; metadata: WorkflowNodeMetadata; naturalWidth?: number; naturalHeight?: number; title: string }>,
  project: WorkflowProject,
) {
  const k = Math.max(project.viewport.k, 0.12);
  const origin = { x: (360 - project.viewport.x) / k, y: (220 - project.viewport.y) / k };
  const columns = Math.min(4, Math.max(1, items.length));
  return items.map((item, index) => {
    const size = fitWorkflowMediaSize(item.type, item.naturalWidth, item.naturalHeight);
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...createWorkflowNode(nanoid(), item.type, {
        x: origin.x - size.width / 2 + column * 48,
        y: origin.y - size.height / 2 + row * 48,
      }, item.metadata),
      ...size,
      freeResize: false,
      title: item.title,
    };
  });
}

export function WorkflowWorkspace({
  theme,
  language,
  resolveGenerationCapability,
  sharedMedia = [],
  onReversePrompt,
  onRunNode,
  onStopNode,
  onSaveWorkflowMedia,
  imageTools,
  t,
  userApiKeys,
  confirmRouteFallback,
  dynamicModelOptions,
  onOpenSettings,
  onEnhancePrompt,
  isEnhancingPrompt,
  onOpenAgent,
  agentOpen = false,
  focusNodeRequest,
  assetLibrary,
  onRenameAsset,
  onRemoveAsset,
  onUpdateAssetTags,
  onRemoveAssetFromFolder,
  onBatchRemoveAssets,
  onBatchAddAssetsToFolder,
  onBatchAddAssetTags,
  onCreateFolder,
  onRenameFolder,
  onRemoveFolder,
  onNotify,
}: WorkflowWorkspaceProps) {
  const hydrated = useWorkflowStore(state => state.hydrated);
  const projects = useWorkflowStore(state => state.projects);
  const activeProjectId = useWorkflowStore(state => state.activeProjectId);
  const setActiveProject = useWorkflowStore(state => state.setActiveProject);
  const createProject = useWorkflowStore(state => state.createProject);
  const updateProject = useWorkflowStore(state => state.updateProject);
  const activeProject = projects.find(project => project.id === activeProjectId) || null;
  // These queries only switch interaction mode (inline sidebar vs hidden). CSS
  // and container queries own the actual geometry and wrapping.
  const mediumViewport = useMediaQuery('(max-width: 1023px)');
  const [desktopLeftOpen, setDesktopLeftOpen] = useState(true);
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false);
  const leftOpen = mediumViewport ? mobileLeftOpen : desktopLeftOpen;
  const setLeftOpen = (open: boolean) => mediumViewport ? setMobileLeftOpen(open) : setDesktopLeftOpen(open);
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [writerRecoveryPending, setWriterRecoveryPending] = useState(false);
  const [sidebarTabRequest, setSidebarTabRequest] = useState<{ tab: 'layers' | 'assets'; nonce: number }>();
  // 图层点击 → 画布聚焦：本地请求与 App 下发的 focusNodeRequest 合并，
  // 谁更新谁生效（nonce 即时间戳）。
  const [localFocusRequest, setLocalFocusRequest] = useState<{ nodeId: string; nonce: number }>();
  const agentConnectionStatus = useAgentConnectionStore(state => state.status);
  const writerStatus = useAgentConnectionStore(state => state.writerStatus);

  useEffect(() => {
    if (hydrated && projects.length > 0 && !activeProjectId) setActiveProject(projects[0].id);
  }, [activeProjectId, hydrated, projects, setActiveProject]);

  const commitProjectPatch = (projectId: string, patch: Partial<WorkflowProject>, intent: string) => {
    const result = commitWorkflowProjectPatch(projectId, patch, intent);
    if (!result.ok && result.error) setWorkspaceNotice(result.error);
    return result.ok;
  };

  const recoverWriter = async () => {
    setWriterRecoveryPending(true);
    try {
      await activateBrowserWorkflowWriter();
      setWorkspaceNotice('Flovart 画布已重新激活。');
    } catch (error) {
      setWorkspaceNotice(displayError(error, 'Flovart 画布暂不可用。'));
    } finally {
      setWriterRecoveryPending(false);
    }
  };

  useEffect(() => {
    if (mediumViewport) setMobileLeftOpen(false);
  }, [mediumViewport]);

  // 一批素材只产生一个 Draft ChangeSet，避免批量插入把撤销栈冲散。
  const commitMediaNodes = (
    items: Array<{ type: 'image' | 'video' | 'audio'; metadata: WorkflowNodeMetadata; naturalWidth?: number; naturalHeight?: number; title: string }>,
    intent: string,
  ) => {
    if (!activeProject || !items.length) return false;
    const current = useWorkflowStore.getState().projects.find(project => project.id === activeProject.id);
    if (!current) return false;
    const nodes = layoutMediaNodes(items, current);
    return commitProjectPatch(current.id, { nodes: [...current.nodes, ...nodes], selectedNodeIds: nodes.map(node => node.id) }, intent);
  };

  const insertLocalFolderEntries = async (entries: LocalFolderEntry[]) => {
    if (!activeProject) return;
    setWorkspaceNotice('');
    const prepared: Array<{ type: 'image' | 'video' | 'audio'; metadata: WorkflowNodeMetadata; naturalWidth?: number; naturalHeight?: number; title: string }> = [];
    const failures: string[] = [];
    for (const entry of entries) {
      try {
        // 引用原文件：这里只读取尺寸与时长，不复制字节进项目存储。
        const file = await readLocalFolderFile(entry.folderId, entry.relativePath);
        const info = await inspectWorkflowMedia(file);
        const { naturalWidth, naturalHeight, durationMs } = info;
        prepared.push({
          type: entry.kind,
          naturalWidth,
          naturalHeight,
          title: entry.name,
          metadata: {
            sourceType: 'localFolder',
            href: localFolderHref(entry.folderId, entry.relativePath),
            name: entry.name,
            mimeType: entry.mimeType,
            bytes: entry.bytes,
            naturalWidth,
            naturalHeight,
            durationMs,
            status: 'success',
          },
        });
      } catch (error) {
        failures.push(`${entry.name}：${displayError(error, '读取失败')}`);
      }
    }
    const committed = commitMediaNodes(prepared, '从本地文件夹插入素材节点');
    if (failures.length) {
      setWorkspaceNotice(`已放入 ${committed ? prepared.length : 0} 个，${failures.length} 个读取失败（${failures[0]}）`);
      return;
    }
    if (!prepared.length) {
      setWorkspaceNotice('没有可用的素材。');
      return;
    }
    if (!committed) setWorkspaceNotice('画布项目已切换，未写入节点。');
  };

  const insertSharedMedia = async (media: WorkflowSharedMedia) => {
    if (!activeProject) return;
    setWorkspaceNotice('');
    const result = await insertSharedMediaIntoProject(media);
    if (!result.ok && result.error) setWorkspaceNotice(result.error);
  };


  const insertAssetItem = (item: AssetItem) => {
    void insertSharedMedia({
      id: `asset:${item.id}`,
      source: 'asset',
      sourceId: item.id,
      name: item.name || '我的素材',
      href: item.dataUrl,
      mimeType: item.mimeType,
      type: item.mimeType.startsWith('video') ? 'video' : 'image',
      folderIds: item.folderIds,
      tags: item.tags,
      width: item.width,
      height: item.height,
      createdAt: item.createdAt,
      prompt: item.prompt,
    } as WorkflowSharedMedia);
  };

  const reverseAssetPrompt = async (item: AssetItem) => {
    if (!onReversePrompt) return;
    try {
      const prompt = await onReversePrompt(item.dataUrl, item.mimeType, item.width, item.height);
      await navigator.clipboard?.writeText(prompt);
      setWorkspaceNotice(language === 'zho' ? 'Prompt 已复制' : 'Prompt Copied');
    } catch (error) {
      setWorkspaceNotice(displayError(error, (language === 'zho' ? '反推失败' : 'Analysis Failed')));
    }
  };

  if (!hydrated) return <div className="workflow-loading">正在加载 Workflow...</div>;

  return (
    <section className="workflow-workspace" data-theme={theme} data-language={language}>
      <WorkflowSidebar
        open={leftOpen}
        onOpenChange={setLeftOpen}
        outerGap={12}
        project={activeProject}
        onProjectChange={patch => activeProject && commitProjectPatch(activeProject.id, patch, '编辑 Workflow 图层')}
        language={language}
assetLibrary={assetLibrary}
          onInsertAsset={insertAssetItem}
          onRenameAsset={onRenameAsset}
          onRemoveAsset={onRemoveAsset}
          onUpdateAssetTags={onUpdateAssetTags}
          onRemoveAssetFromFolder={onRemoveAssetFromFolder}
          onBatchRemoveAssets={onBatchRemoveAssets}
          onBatchAddAssetsToFolder={onBatchAddAssetsToFolder}
          onBatchAddAssetTags={onBatchAddAssetTags}
          onReverseAsset={reverseAssetPrompt}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onRemoveFolder={onRemoveFolder}
          onInsertLocalFolderEntries={entries => insertLocalFolderEntries(entries)}
          tabRequest={sidebarTabRequest}
          onFocusNode={nodeId => setLocalFocusRequest({ nodeId, nonce: Date.now() })}
          docked={!mediumViewport}
      />
      <main className="workflow-workspace__main">
        {workspaceNotice && <div className="workflow-workspace__notice" role="status">{workspaceNotice}</div>}
        {writerStatus === 'revoked' && (
          <div className="workflow-workspace__notice flex items-center justify-between gap-3" role="status" data-testid="workflow-writer-recovery">
            <span>{language === 'zho' ? 'Flovart 画布已关闭，当前页面需要重新激活。' : 'The Flovart canvas was closed. Reactivate this page to continue.'}</span>
            <button type="button" onClick={() => void recoverWriter()} disabled={writerRecoveryPending || agentConnectionStatus !== 'ready'} className="shrink-0" style={{ color: 'var(--wf-accent, var(--isl-accent))' }}>
              {writerRecoveryPending ? (language === 'zho' ? '恢复中…' : 'Recovering…') : (language === 'zho' ? '重新打开 Flovart' : 'Reopen Flovart')}
            </button>
          </div>
        )}
        <WorkflowGenerationCapabilitiesProvider resolve={resolveGenerationCapability} sharedMedia={sharedMedia}>
          {activeProject ? (
            <InfiniteWorkflow
              project={activeProject}
              updateProject={patch => updateProject(activeProject.id, patch)}
              onRunNode={(nodeId, promptIntent) => {
                if (onRunNode) void onRunNode(activeProject.id, nodeId, promptIntent);
                else commitProjectPatch(activeProject.id, {
                  nodes: activeProject.nodes.map(node => node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: 'error', error: '生成适配器尚未连接' } } : node),
                }, '记录节点执行适配器错误');
              }}
              onStopNode={nodeId => onStopNode?.(activeProject.id, nodeId)}
              onSaveWorkflowMedia={nodeId => onSaveWorkflowMedia?.(activeProject.id, nodeId)}
              imageTools={imageTools}
              onReversePrompt={onReversePrompt}
              onOpenAgent={onOpenAgent}
              agentOpen={agentOpen}
              focusNodeRequest={localFocusRequest && localFocusRequest.nonce > (focusNodeRequest?.nonce ?? 0) ? localFocusRequest : focusNodeRequest}
              t={t}
              theme={theme}
              language={language}
              userApiKeys={userApiKeys}
              confirmRouteFallback={confirmRouteFallback}
              dynamicModelOptions={dynamicModelOptions}
              onOpenSettings={onOpenSettings}
              onEnhancePrompt={onEnhancePrompt}
              isEnhancingPrompt={isEnhancingPrompt}
              assetLibrary={assetLibrary}
              onOpenAssets={() => {
                setSidebarTabRequest({ tab: 'assets', nonce: Date.now() });
                setLeftOpen(true);
              }}
              onNotify={onNotify}
            />
          ) : (
            <div className="workflow-empty">
              <h1>Workflow</h1>
              <p>使用节点组织提示词、参考素材和生成配置。</p>
              <button type="button" aria-label="新建工作流" onClick={() => createProject()}>新建工作流</button>
            </div>
          )}
        </WorkflowGenerationCapabilitiesProvider>
      </main>

    </section>
  );
}

export function WorkflowContextPanel({ project }: { project: WorkflowProject }) {
  const running = project.nodes.filter(node => node.metadata.status === 'loading').length;
  const failed = project.nodes.filter(node => node.metadata.status === 'error').length;
  const latestReceipt = [...(project.draftChangeSets || [])].reverse()[0];
  return (
    <section className="h-full overflow-auto p-5" aria-label="Workflow 上下文">
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <header>
          <p className="text-[10px] font-bold tracking-[0.16em]" style={{ color: 'var(--isl-ink-soft)' }}>WORKFLOW CONTEXT</p>
          <h2 className="mt-1 text-base font-semibold" style={{ color: 'var(--isl-ink)' }}>{project.title}</h2>
          <p className="mt-1 text-xs leading-6" style={{ color: 'var(--isl-ink-soft)' }}>当前项目的节点、运行状态和最近变更。</p>
        </header>
        <div className="grid gap-3 sm:grid-cols-3">
          <ContextCard label="节点" value={String(project.nodes.length)} />
          <ContextCard label="连接" value={String(project.connections.length)} />
          <ContextCard label="状态" value={running > 0 ? `${running} 项运行中` : failed > 0 ? `${failed} 项异常` : '已准备'} />
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface)' }}>
          <p className="text-[10px] font-bold tracking-[0.14em]" style={{ color: 'var(--isl-ink-soft)' }}>最近变更</p>
          <p className="mt-2 text-xs leading-5" style={{ color: 'var(--isl-ink-soft)' }}>
            {latestReceipt ? `${latestReceipt.intent} · v${latestReceipt.resultDraftVersion}` : '尚无变更记录。'}
          </p>
        </div>
      </div>
    </section>
  );
}

function ContextCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border p-4" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface)' }}><small className="block text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>{label}</small><strong className="mt-1 block text-sm" style={{ color: 'var(--isl-ink)' }}>{value}</strong></div>;
}
