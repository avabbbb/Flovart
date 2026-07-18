import { nanoid } from 'nanoid';
import { useEffect, useState } from 'react';
import type { ModelPreference, PromptEnhanceMode, PromptEnhanceResult, UserApiKey } from '../../types';
import '../../styles/workflow.css';
import type { GenerationCapability, GenerationMode } from '../../services/generationCapabilities';
import { StudioRightDrawer } from '../studio/StudioRightDrawer';
import { StudioMediaBrowser, type StudioMediaItem } from '../studio/StudioMediaBrowser';
import { createWorkflowNode } from './constants';
import { InfiniteWorkflow } from './InfiniteWorkflow';
import { WorkflowGenerationCapabilitiesProvider, type WorkflowSharedMedia } from './WorkflowConfigPanel';
import { useWorkflowStore } from './store';
import type { WorkflowModelOptions } from './WorkflowNodePromptBar';
import { WorkflowAgentPanel, type WorkflowOnlineTurnInput } from './WorkflowAgentPanel';
import type { WorkflowImageToolHandlers } from './WorkflowNodeToolbar';
import { WorkflowSidebar } from './WorkflowSidebar';
import { discardWorkflowMediaRecord, fitWorkflowMediaSize, ingestWorkflowMedia, loadWorkflowMediaBlob, releaseWorkflowMediaRecord, workflowBlobToDataUrl, type WorkflowMediaRecord } from './media';
import type { AssetItem, AssetLibrary } from '../../types';

export interface WorkflowWorkspaceProps {
  theme: 'light' | 'dark';
  language: 'en' | 'zho';
  resolveGenerationCapability?: (mode: GenerationMode, modelId?: string) => GenerationCapability;
  sharedMedia?: WorkflowSharedMedia[];
  onReversePrompt?: (imageHref: string, mimeType: string, width?: number, height?: number) => Promise<string>;
  onRunNode?: (projectId: string, nodeId: string) => Promise<void> | void;
  onStopNode?: (projectId: string, nodeId: string) => void;
  onSaveWorkflowMedia?: (projectId: string, nodeId: string) => void;
  imageTools?: WorkflowImageToolHandlers;
  t: (key: string, ...args: any[]) => string;
  userApiKeys: UserApiKey[];
  modelPreference: ModelPreference;
  dynamicModelOptions: WorkflowModelOptions;
  onOpenSettings?: () => void;
  onEnhancePrompt?: (payload: { prompt: string; mode: PromptEnhanceMode; stylePreset?: string }) => Promise<PromptEnhanceResult>;
  isEnhancingPrompt?: boolean;
  onOpenAgent?: () => void;
  onOnlineAgentTurn?: (input: WorkflowOnlineTurnInput) => Promise<void>;
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
  modelPreference,
  dynamicModelOptions,
  onOpenSettings,
  onEnhancePrompt,
  isEnhancingPrompt,
  onOpenAgent,
  onOnlineAgentTurn,
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
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem('workflowRightPanelOpen') !== 'false');
  const [rightTab, setRightTab] = useState<WorkflowRightTab>('agent');
  const [rightWidth, setRightWidth] = useState(() => Number(localStorage.getItem('workflowRightPanelWidth')) || 390);
  const [workspaceNotice, setWorkspaceNotice] = useState('');

  useEffect(() => {
    if (hydrated && projects.length > 0 && !activeProjectId) setActiveProject(projects[0].id);
  }, [activeProjectId, hydrated, projects, setActiveProject]);

  useEffect(() => {
    localStorage.setItem('workflowRightPanelWidth', String(rightWidth));
  }, [rightWidth]);

  useEffect(() => {
    localStorage.setItem('workflowRightPanelOpen', String(rightOpen));
  }, [rightOpen]);

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
      updateProject(current.id, { nodes: [...current.nodes, node], selectedNodeIds: [node.id] });
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
        onProjectChange={patch => activeProject && updateProject(activeProject.id, patch)}
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
      />
      <main className="workflow-workspace__main">
        {workspaceNotice && <div className="workflow-workspace__notice" role="status">{workspaceNotice}</div>}
        <WorkflowGenerationCapabilitiesProvider resolve={resolveGenerationCapability} sharedMedia={sharedMedia}>
          {activeProject ? (
            <InfiniteWorkflow
              project={activeProject}
              updateProject={patch => updateProject(activeProject.id, patch)}
              onRunNode={nodeId => {
                if (onRunNode) void onRunNode(activeProject.id, nodeId);
                else updateProject(activeProject.id, {
                  nodes: activeProject.nodes.map(node => node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: 'error', error: '生成适配器尚未连接' } } : node),
                });
              }}
              onStopNode={nodeId => onStopNode?.(activeProject.id, nodeId)}
              onSaveWorkflowMedia={nodeId => onSaveWorkflowMedia?.(activeProject.id, nodeId)}
              imageTools={imageTools}
              onReversePrompt={onReversePrompt}
              onOpenAgent={() => {
                setRightTab('agent');
                setRightOpen(prev => {
                  const next = !prev;
                  if (next) onOpenAgent?.();
                  return next;
                });
              }}
              agentOpen={rightOpen && rightTab === 'agent'}
              t={t}
              theme={theme}
              language={language}
              userApiKeys={userApiKeys}
              modelPreference={modelPreference}
              dynamicModelOptions={dynamicModelOptions}
              onOpenSettings={onOpenSettings}
              onEnhancePrompt={onEnhancePrompt}
              isEnhancingPrompt={isEnhancingPrompt}
              assetLibrary={assetLibrary}
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
        outerGap={12}
        width={rightWidth}
        minWidth={320}
        maxWidth={520}
        onWidthChange={setRightWidth}
        activeTab={rightTab}
        onTabChange={tab => setRightTab(tab as WorkflowRightTab)}
        tabs={[
          { id: 'agent', label: 'Agent', icon: undefined },
          { id: 'history', label: language === 'zho' ? '生成历史' : 'History', icon: undefined },
        ]}
      >
        {activeProject && rightTab === 'agent' && (
          <WorkflowAgentPanel
            embedded
            project={activeProject}
            onClose={() => setRightOpen(false)}
            onOnlineTurn={onOnlineAgentTurn}
            onProjectChange={patch => updateProject(activeProject.id, patch)}
          />
        )}
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
