import { nanoid } from 'nanoid';
import { useEffect, useState } from 'react';
import type { PromptEnhanceMode, PromptEnhanceResult, UserApiKey } from '../../types';
import type { RouteFallbackResolution } from '../../services/routeMapping';
import '../../styles/workflow.css';
import type { GenerationCapability, GenerationMode } from '../../services/generationCapabilities';
import { StudioRightDrawer } from '../studio/StudioRightDrawer';
import { StudioMediaBrowser, type StudioMediaItem } from '../studio/StudioMediaBrowser';
import { ProductionCrewPanel } from '../agent/ProductionCrewPanel';
import { AgentHostPicker } from '../agent/AgentHostPicker';
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
import { discardWorkflowMediaRecord, fitWorkflowMediaSize, ingestWorkflowMedia, loadWorkflowMediaBlob, releaseWorkflowMediaRecord, workflowBlobToDataUrl, type WorkflowMediaRecord } from './media';
import type { AssetItem, AssetLibrary } from '../../types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import type { WorkflowProject } from './types';
import type { PromptIntent } from './promptIntent';

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
}

type WorkflowRightTab = 'agent' | 'history';

const WORKFLOW_DRAWER_MIN = 280;
const WORKFLOW_DRAWER_DEFAULT = 360;
const WORKFLOW_DRAWER_MAX = 640;

function readWorkflowDrawerWidth() {
  if (typeof window === 'undefined') return WORKFLOW_DRAWER_DEFAULT;
  try {
    const stored = Number(localStorage.getItem('workflowRightPanelWidth'));
    return Number.isFinite(stored) && stored >= WORKFLOW_DRAWER_MIN && stored <= WORKFLOW_DRAWER_MAX
      ? stored
      : WORKFLOW_DRAWER_DEFAULT;
  } catch {
    return WORKFLOW_DRAWER_DEFAULT;
  }
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
}: WorkflowWorkspaceProps) {
  const hydrated = useWorkflowStore(state => state.hydrated);
  const projects = useWorkflowStore(state => state.projects);
  const activeProjectId = useWorkflowStore(state => state.activeProjectId);
  const setActiveProject = useWorkflowStore(state => state.setActiveProject);
  const createProject = useWorkflowStore(state => state.createProject);
  const updateProject = useWorkflowStore(state => state.updateProject);
  const activeProject = projects.find(project => project.id === activeProjectId) || null;
  // These queries only switch interaction mode (inline pane vs drawer). CSS
  // and container queries own the actual geometry and wrapping.
  const mediumViewport = useMediaQuery('(max-width: 1023px)');
  const [desktopLeftOpen, setDesktopLeftOpen] = useState(true);
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false);
  const leftOpen = mediumViewport ? mobileLeftOpen : desktopLeftOpen;
  const setLeftOpen = (open: boolean) => mediumViewport ? setMobileLeftOpen(open) : setDesktopLeftOpen(open);
  const [desktopRightOpen, setDesktopRightOpen] = useState(() => localStorage.getItem('workflowRightPanelOpenV2') === 'true');
  const [mobileRightOpen, setMobileRightOpen] = useState(false);
  const rightOpen = mediumViewport ? mobileRightOpen : desktopRightOpen;
  const setRightOpen = (open: boolean) => mediumViewport ? setMobileRightOpen(open) : setDesktopRightOpen(open);
  const [rightTab, setRightTab] = useState<WorkflowRightTab>('agent');
  const [rightWidth, setRightWidth] = useState(readWorkflowDrawerWidth);
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [writerRecoveryPending, setWriterRecoveryPending] = useState(false);
  const [sidebarTabRequest, setSidebarTabRequest] = useState<{ tab: 'layers' | 'assets'; nonce: number }>();
  const agentConnectionStatus = useAgentConnectionStore(state => state.status);
  const writerStatus = useAgentConnectionStore(state => state.writerStatus);

  useEffect(() => {
    if (hydrated && projects.length > 0 && !activeProjectId) setActiveProject(projects[0].id);
  }, [activeProjectId, hydrated, projects, setActiveProject]);

  useEffect(() => {
    localStorage.setItem('workflowRightPanelWidth', String(rightWidth));
  }, [rightWidth]);

  useEffect(() => {
    localStorage.setItem('workflowRightPanelOpenV2', String(desktopRightOpen));
  }, [desktopRightOpen]);

  useEffect(() => {
    if (mediumViewport) setMobileRightOpen(false);
  }, [mediumViewport]);

  const commitProjectPatch = (projectId: string, patch: Partial<WorkflowProject>, intent: string) => {
    const current = useWorkflowStore.getState().projects.find(project => project.id === projectId);
    if (!current) return false;
    const ops = workflowDocumentOperationsFromFrames(
      { nodes: current.nodes, connections: current.connections },
      { nodes: patch.nodes || current.nodes, connections: patch.connections || current.connections },
    );
    if (!ops.length) {
      updateProject(projectId, patch);
      return true;
    }
    const result = applyWorkflowMutation(current, {
      projectId,
      expectedRevision: current.draftVersion || 1,
      mutationId: nanoid(),
      source: 'ui',
      intent,
      ops,
    });
    if (result.ok === false) {
      setWorkspaceNotice(result.error.message);
      return false;
    }
    updateProject(projectId, {
      nodes: result.project.nodes,
      connections: result.project.connections,
      selectedNodeIds: patch.selectedNodeIds || result.project.selectedNodeIds,
      viewport: patch.viewport || result.project.viewport,
      draftVersion: result.project.draftVersion,
      draftChangeSets: result.project.draftChangeSets,
      draftRedoStack: result.project.draftRedoStack,
      workflowMutationReceipts: result.project.workflowMutationReceipts,
    });
    return true;
  };

  const recoverWriter = async () => {
    setWriterRecoveryPending(true);
    try {
      await activateBrowserWorkflowWriter();
      setWorkspaceNotice('Flovart 画布已重新激活。');
    } catch (error) {
      setWorkspaceNotice(error instanceof Error ? error.message : 'Flovart 画布暂不可用。');
    } finally {
      setWriterRecoveryPending(false);
    }
  };

  useEffect(() => {
    if (mediumViewport) setMobileLeftOpen(false);
  }, [mediumViewport]);

  const insertSharedMedia = async (media: WorkflowSharedMedia) => {
    if (!activeProject) return;
    const expectedProjectId = activeProject.id;
    let record: WorkflowMediaRecord | undefined;
    try {
      setWorkspaceNotice('');
      if (!/^https?:\/\//i.test(media.href)) {
        const blob = await loadWorkflowMediaBlob(undefined, media.href);
        record = await ingestWorkflowMedia(new File([blob], media.name, { type: blob.type || media.mimeType }));
      }
      const current = useWorkflowStore.getState().projects.find(project => project.id === expectedProjectId);
      if (!current) {
        if (record) await discardWorkflowMediaRecord(record.storageKey);
        return;
      }
      const type = record?.type || media.type;
      const size = fitWorkflowMediaSize(type, record?.naturalWidth || media.width, record?.naturalHeight || media.height);
      const k = Math.max(current.viewport.k, 0.12);
      const center = { x: (360 - current.viewport.x) / k, y: (220 - current.viewport.y) / k };
      const storedMetadata = record && (({ type: _type, ...metadata }) => metadata)(record);
      const node = {
        ...createWorkflowNode(nanoid(), type, { x: center.x - size.width / 2, y: center.y - size.height / 2 }, storedMetadata
          ? storedMetadata
          : { href: media.href, mimeType: media.mimeType, name: media.name, naturalWidth: media.width, naturalHeight: media.height, status: 'success' }),
        ...size,
        freeResize: false,
        title: media.name,
      };
      if (!commitProjectPatch(current.id, { nodes: [...current.nodes, node], selectedNodeIds: [node.id] }, '从素材库插入媒体节点')) {
        if (record) await discardWorkflowMediaRecord(record.storageKey);
        return;
      }
      if (record) releaseWorkflowMediaRecord(record.storageKey);
    } catch (error) {
      if (record) await discardWorkflowMediaRecord(record.storageKey);
      setWorkspaceNotice(error instanceof Error ? error.message : '共享素材导入失败');
    }
  };

  const mediaSourceOf = (media: WorkflowSharedMedia) => media.source || (media.id.startsWith('history:') ? 'history' : 'asset');
  const historyMedia = Array.isArray(sharedMedia) ? sharedMedia.filter(media => mediaSourceOf(media) === 'history') : [];

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
      setWorkspaceNotice(error instanceof Error ? error.message : (language === 'zho' ? '反推失败' : 'Analysis Failed'));
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
          tabRequest={sidebarTabRequest}
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
              onOpenAgent={() => {
                if (rightOpen && rightTab === 'agent') {
                  // 已打开且停在制作状态页：执行收起
                  setRightOpen(false);
                } else {
                  // 关闭中或停在其它页：打开并切到制作状态
                  setRightTab('agent');
                  setRightOpen(true);
                  onOpenAgent?.();
                }
              }}
              agentOpen={rightOpen && rightTab === 'agent'}
              rightPanelInset={rightOpen && !mediumViewport ? rightWidth + 24 : 12}
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

      <StudioRightDrawer
        open={rightOpen}
        onOpenChange={setRightOpen}
        outerGap={0}
        width={rightWidth}
        minWidth={WORKFLOW_DRAWER_MIN}
        maxWidth={WORKFLOW_DRAWER_MAX}
        onWidthChange={setRightWidth}
        flush
        activeTab={rightTab}
        onTabChange={tab => setRightTab(tab as WorkflowRightTab)}
        tabs={[
          { id: 'agent', label: language === 'zho' ? '制作状态' : 'Production', icon: undefined },
          { id: 'history', label: language === 'zho' ? '生成历史' : 'History', icon: undefined },
        ]}
      >
        {rightTab === 'agent' && (activeProject ? (
          <div className="h-full overflow-auto">{rightOpen && <AgentHostPicker />}<ProductionCrewPanel project={activeProject} /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, height: '100%', padding: '0 32px', textAlign: 'center', color: 'var(--isl-ink-soft)', fontSize: 13 }}>
            <strong style={{ color: 'var(--isl-ink)' }}>制作状态需要一个 Workflow 项目</strong>
            <span>创建后，Brief、任务状态、回执与产物会在这里汇合。</span>
            <button type="button" aria-label="新建工作流" onClick={() => createProject()}
              style={{ marginTop: 6, padding: '7px 16px', border: 0, borderRadius: 9, color: '#fff', background: 'var(--isl-accent, #1677ff)', cursor: 'pointer', fontSize: 12 }}>
              创建项目
            </button>
          </div>
        ))}
        {rightTab === 'history' && (
          <StudioMediaBrowser
            mode="history"
            items={historyMedia}
            language={language}
            onInsert={media => { void insertSharedMedia(media as WorkflowSharedMedia); }}
            onReversePrompt={onReversePrompt ? async media => {
              const blob = await loadWorkflowMediaBlob(undefined, media.href);
              return onReversePrompt(await workflowBlobToDataUrl(blob), media.mimeType || blob.type, media.width, media.height);
            } : undefined}
          />
        )}
      </StudioRightDrawer>
    </section>
  );
}
