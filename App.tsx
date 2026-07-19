import React, { useState, useCallback, useEffect, useMemo, Suspense } from 'react';
import { generateId } from './utils/helpers';
import type { AssetLibrary, UserApiKey, PromptEnhanceMode, GenerationHistoryItem, ThemeMode } from './types';
import { addAsset, removeAsset, renameAsset, addFolder, renameFolder, removeFolder, loadAssetLibraryAsync, saveAssetLibraryAsync, updateAssetTags, removeAssetFromFolder, batchRemoveAssets, batchAddAssetsToFolder, batchAddAssetTags } from './utils/assetStorage';
import { loadGenerationHistoryAsync, saveGenerationHistoryAsync, addGenerationHistoryItem } from './utils/generationHistory';
import { reversePromptStreamWithProvider, enhancePromptWithProvider } from './services/aiGateway';
import { getCompactChromeMetrics } from './utils/uiScale';
import { useApiKeys, normalizeApiKeyEntry } from './hooks/useApiKeys';
import { useToast } from './hooks/useToast';
import ToastStack from './components/Toast';
import { AppShell } from './components/AppShell';
import { StudioTopMenu, type StudioMenuModel } from './components/studio/StudioTopMenu';
import { useWorkspaceStore } from './stores/useWorkspaceStore';
import { useWorkflowStore } from './components/workflow/store';
import { getGenerationCapability, type GenerationMode } from './services/generationCapabilities';
import { cancelWorkflowGeneration, runWorkflowGeneration } from './services/workflowGeneration';
import { ingestWorkflowMedia, loadWorkflowMediaBlob, releaseWorkflowMediaRecord } from './components/workflow/media';
import { createWorkflowNode } from './components/workflow/constants';
import { setWorkflowNodeRunner } from './services/workflowDispatcher';
import { runWorkflowOnlineAgent } from './services/workflowOnlineAgent';
import type { WorkflowOnlineTurnInput } from './components/workflow/WorkflowAgentPanel';
import { translations } from './utils/translations';
import './styles/generation.css';
import type { TableProcessResult } from './services/tableMediaProcessor';
import { resolveRouteMappingForSubmit, type RouteFallbackResolution } from './services/routeMapping';

const SettingsPanel = React.lazy(() => import('./components/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const OnboardingWizard = React.lazy(() => import('./components/OnboardingWizard').then(m => ({ default: m.OnboardingWizard })));
const WorkflowWorkspace = React.lazy(() => import('./components/workflow/WorkflowWorkspace').then(m => ({ default: m.WorkflowWorkspace })));
const TableWorkspace = React.lazy(() => import('./components/table/TableWorkspace').then(m => ({ default: m.TableWorkspace })));
const AgentWorkspace = React.lazy(() => import('./components/agent/AgentWorkspace').then(m => ({ default: m.AgentWorkspace })));
const AssetAddModal = React.lazy(() => import('./components/AssetAddModal').then(m => ({ default: m.AssetAddModal })));

type ThemePalette = {
    appBackground: string;
    uiBgColor: string;
    buttonBgColor: string;
};

const THEME_PALETTES: Record<'light' | 'dark', ThemePalette> = {
    light: {
        appBackground: '#f1ede3',
        uiBgColor: 'rgba(250, 249, 246, 0.92)',
        buttonBgColor: '#19c8b9',
    },
    dark: {
        appBackground: '#131210',
        uiBgColor: 'rgba(32, 31, 29, 0.94)',
        buttonBgColor: '#3ad9c9',
    },
};

function isStorageQuotaError(err: unknown): boolean {
    if (err instanceof DOMException) {
        return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED';
    }
    return false;
}

const App: React.FC = () => {
    const [dataReady, setDataReady] = useState(false);
    const [assetLibrary, setAssetLibrary] = useState<AssetLibrary>({ folders: [], items: [] });
    const [generationHistory, setGenerationHistory] = useState<GenerationHistoryItem[]>([]);
    const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
    const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
    const [addAssetModal, setAddAssetModal] = useState<{ open: boolean; dataUrl: string; mimeType: string; width: number; height: number } | null>(null);
    const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('light');
    const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
    const [isAssetPanelOpen, setIsAssetPanelOpen] = useState(false);
    const [tableSourceNodeId, setTableSourceNodeId] = useState<string | null>(null);

    const toast = useToast();

    const language = useWorkspaceStore(s => s.language);
    const setLanguage = useWorkspaceStore(s => s.setLanguage);
    const activeView = useWorkspaceStore(s => s.activeView);
    const setActiveView = useWorkspaceStore(s => s.setActiveView);
    const themeMode = useWorkspaceStore(s => s.themeMode);
    const setThemeMode = useWorkspaceStore(s => s.setThemeMode);

    const workflowProjects = useWorkflowStore(s => s.projects);
    const activeWorkflowProjectId = useWorkflowStore(s => s.activeProjectId);
    const workflowCreateProject = useWorkflowStore(s => s.createProject);
    const workflowDeleteProjects = useWorkflowStore(s => s.deleteProjects);
    const workflowRenameProject = useWorkflowStore(s => s.renameProject);
    const workflowSetActiveProject = useWorkflowStore(s => s.setActiveProject);

    const activeWorkflowIndex = useMemo(() => Math.max(0, workflowProjects.findIndex(p => p.id === activeWorkflowProjectId)), [workflowProjects, activeWorkflowProjectId]);

    const resolvedTheme: 'light' | 'dark' = themeMode === 'system' ? systemTheme : themeMode;
    const themePalette = THEME_PALETTES[resolvedTheme];

    const {
        userApiKeys, setUserApiKeys, apiKeysLoaded, showOnboarding, setShowOnboarding,
        clearKeysOnExit, setClearKeysOnExit,
        handleAddApiKey, handleDeleteApiKey, handleUpdateApiKey, handleSetDefaultApiKey,
        dynamicModelOptions, usageSummaryMap,
    } = useApiKeys(isSettingsPanelOpen);

    useEffect(() => {
        Promise.all([
            loadAssetLibraryAsync(),
            loadGenerationHistoryAsync(),
        ]).then(([loadedAssets, loadedHistory]) => {
            setAssetLibrary(loadedAssets);
            setGenerationHistory(loadedHistory);
            setDataReady(true);
        }).catch(() => {
            setDataReady(true);
        });
    }, []);

    useEffect(() => {
        if (!dataReady) return;
        saveAssetLibraryAsync(assetLibrary).catch(console.error);
    }, [assetLibrary, dataReady]);

    useEffect(() => {
        if (!dataReady) return;
        saveGenerationHistoryAsync(generationHistory).catch(console.error);
    }, [generationHistory, dataReady]);

    useEffect(() => {
        const handleResize = () => setViewportWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const updateTheme = (event?: MediaQueryListEvent) => {
            setSystemTheme((event ? event.matches : media.matches) ? 'dark' : 'light');
        };
        updateTheme();
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', updateTheme);
            return () => media.removeEventListener('change', updateTheme);
        }
        media.addListener(updateTheme);
        return () => media.removeListener(updateTheme);
    }, []);

    useEffect(() => {
        const root = document.documentElement;
        root.dataset.theme = resolvedTheme;
        root.style.setProperty('--ui-bg-color', themePalette.uiBgColor);
        root.style.setProperty('--button-bg-color', themePalette.buttonBgColor);
        document.body.style.backgroundColor = themePalette.appBackground;
    }, [resolvedTheme, themePalette]);

    const t = useCallback((key: string, ...args: any[]): any => {
        const dict = translations[language] || translations.en;
        const value = dict[key];
        if (typeof value === 'function') return value(...args);
        return value ?? key;
    }, [language]);

    const confirmRouteFallback = useCallback((resolution: RouteFallbackResolution) => window.confirm(
        `主线路 ${resolution.unavailablePrimary.key.name || resolution.unavailablePrimary.key.provider} · ${resolution.unavailablePrimary.routeId || '未配置'} 当前不可用。\n\n是否改用 ${resolution.key.name || resolution.key.provider} · ${resolution.routeId}？`,
    ), []);

    const handleEnhancePrompt = useCallback(async (payload: { prompt: string; mode: PromptEnhanceMode; stylePreset?: string }) => {
        setIsEnhancingPrompt(true);
        try {
            const route = await resolveRouteMappingForSubmit(
                { kind: 'runtime-capability', capability: 'prompt-enhancement' },
                userApiKeys,
                confirmRouteFallback,
            );
            return await enhancePromptWithProvider(payload, route.routeId, route.key);
        } finally {
            setIsEnhancingPrompt(false);
        }
    }, [confirmRouteFallback, userApiKeys]);

    const saveGenerationToHistory = useCallback(async (payload: {
        name?: string;
        dataUrl: string;
        mimeType: string;
        width: number;
        height: number;
        prompt: string;
        mediaType?: 'image' | 'video';
    }) => {
        const item: GenerationHistoryItem = {
            id: generateId(),
            name: payload.name,
            dataUrl: payload.dataUrl,
            mimeType: payload.mimeType,
            width: payload.width,
            height: payload.height,
            prompt: payload.prompt,
            createdAt: Date.now(),
            mediaType: payload.mediaType,
        };
        setGenerationHistory(prev => addGenerationHistoryItem(prev, item));
    }, []);

    const resolveWorkflowGenerationCapability = useCallback((mode: GenerationMode, modelId?: string) => {
        return getGenerationCapability(userApiKeys, mode, modelId);
    }, [userApiKeys]);

    const workflowSharedMedia = useMemo(() => generationHistory.map(item => ({
        id: `history:${item.id}`,
        source: 'history' as const,
        sourceId: item.id,
        name: item.name || (item.mediaType === 'video' ? '生成视频' : '生成图片'),
        href: item.dataUrl,
        mimeType: item.mimeType,
        type: item.mediaType === 'video' || item.mimeType.startsWith('video/') ? 'video' as const : 'image' as const,
        width: item.width,
        height: item.height,
        createdAt: item.createdAt,
        prompt: item.prompt,
    })), [generationHistory]);

    const handleRunWorkflowNode = useCallback(async (projectId: string, nodeId: string) => {
        const project = useWorkflowStore.getState().projects.find(item => item.id === projectId);
        if (!project) return;
        await runWorkflowGeneration(project, nodeId, {
            userApiKeys,
            confirmRouteFallback,
            getProject: () => useWorkflowStore.getState().projects.find(item => item.id === projectId) || null,
            onProjectChange: (next) => useWorkflowStore.getState().updateProject(projectId, next),
            saveHistory: saveGenerationToHistory,
        });
    }, [confirmRouteFallback, saveGenerationToHistory, userApiKeys]);

    const handleSaveWorkflowMedia = useCallback(async (projectId: string, nodeId: string) => {
        const node = useWorkflowStore.getState().projects.find(item => item.id === projectId)?.nodes.find(item => item.id === nodeId);
        if (!node || (!node.metadata.storageKey && !node.metadata.href)) return;
        const blob = await loadWorkflowMediaBlob(node.metadata.storageKey, node.metadata.href);
        if (!blob) return;
        setAddAssetModal({ open: true, dataUrl: await blobToDataUrl(blob), mimeType: blob.type, width: node.width || 0, height: node.height || 0 });
    }, []);

    const handleWorkflowOnlineAgentTurn = useCallback((input: WorkflowOnlineTurnInput) => runWorkflowOnlineAgent(input, {
        userApiKeys,
        confirmRouteFallback,
    }), [confirmRouteFallback, userApiKeys]);

    useEffect(() => {
        setWorkflowNodeRunner(handleRunWorkflowNode, (projectId, nodeId) => {
            cancelWorkflowGeneration(projectId, nodeId);
        });
    }, [handleRunWorkflowNode]);

    const activeWorkflowProject = workflowProjects.find(project => project.id === activeWorkflowProjectId) || null;
    const activeWorkflowTitle = activeWorkflowProject?.title || 'Workflow';
    const handleWorkflowReversePrompt = useCallback(async (imageHref: string, mimeType: string, imgWidth?: number, imgHeight?: number): Promise<string> => {
        const route = await resolveRouteMappingForSubmit(
            { kind: 'runtime-capability', capability: 'image-understanding' },
            userApiKeys,
            confirmRouteFallback,
        );
        return reversePromptStreamWithProvider(imageHref, mimeType, route.routeId, route.key, () => undefined, undefined, language, { width: imgWidth, height: imgHeight });
    }, [confirmRouteFallback, language, userApiKeys]);

    const handleOpenTable = useCallback((nodeId?: string) => {
        setTableSourceNodeId(nodeId || null);
        setActiveView('table');
    }, [setActiveView]);

    const handleCommitTableResult = useCallback(async (result: TableProcessResult, sourceNodeId: string | null, name: string) => {
        const project = useWorkflowStore.getState().projects.find(item => item.id === useWorkflowStore.getState().activeProjectId);
        if (!project) throw new Error('请先创建 Workflow 项目。');
        const extension = result.mimeType.includes('webm') ? 'webm' : result.mimeType.includes('png') ? 'png' : 'webp';
        const file = new File([result.blob], `${name}.${extension}`, { type: result.mimeType, lastModified: Date.now() });
        const record = await ingestWorkflowMedia(file);
        const source = project.nodes.find(node => node.id === sourceNodeId);
        const node = createWorkflowNode(generateId(), record.type, source
            ? { x: source.position.x + source.width + 80, y: source.position.y }
            : { x: -project.viewport.x / project.viewport.k + 180, y: -project.viewport.y / project.viewport.k + 140 }, { ...record, status: 'success' });
        node.title = name;
        if (record.naturalWidth && record.naturalHeight) {
            node.width = Math.min(record.type === 'video' ? 480 : 420, record.naturalWidth);
            node.height = Math.round(node.width * record.naturalHeight / record.naturalWidth);
        }
        const connection = source ? [{ id: generateId(), fromNodeId: source.id, toNodeId: node.id }] : [];
        useWorkflowStore.getState().updateProject(project.id, {
            nodes: [...project.nodes, node],
            connections: [...project.connections, ...connection],
            selectedNodeIds: [node.id],
        });
        releaseWorkflowMediaRecord(record.storageKey);
        toast.show('预处理结果已发送到 Workflow。', 'success');
    }, [toast]);

    const handleSaveTableAsset = useCallback(async (result: TableProcessResult, name: string) => {
        const dataUrl = await blobToDataUrl(result.blob);
        setAssetLibrary(previous => addAsset(previous, {
            id: generateId(),
            name,
            folderIds: [],
            tags: ['Table 预处理'],
            dataUrl,
            mimeType: result.mimeType,
            width: result.width,
            height: result.height,
            createdAt: Date.now(),
            source: 'generation',
        }));
        toast.show('已保存到我的素材。', 'success');
    }, [toast]);

    const studioMenuModel: StudioMenuModel = useMemo(() => ({
        mode: activeView,
        title: activeView === 'workflow' ? activeWorkflowTitle : activeView === 'table' ? 'Table' : 'Agent',
        themeMode,
        resolvedTheme,
        language,
        status: {
            tone: 'ready',
            label: 'Ready',
            detail: 'All systems operational',
        },
        actions: {
            changeMode: setActiveView,
            setThemeMode,
            toggleLanguage: () => setLanguage(language === 'zho' ? 'en' : 'zho'),
            openSettings: () => setIsSettingsPanelOpen(true),
        },
        projectList: workflowProjects.map(project => ({ id: project.id, title: project.title })),
        activeProjectIndex: activeWorkflowIndex,
        projectActions: {
            create: () => workflowCreateProject(language === 'zho' ? '未命名工作流' : 'Untitled workflow'),
            remove: () => { if (activeWorkflowProjectId) workflowDeleteProjects([activeWorkflowProjectId]); },
            rename: (newTitle: string) => { if (activeWorkflowProjectId) workflowRenameProject(activeWorkflowProjectId, newTitle); },
            setActiveByIndex: (index: number) => { const target = workflowProjects[index]; if (target) workflowSetActiveProject(target.id); },
        },
    }), [activeView, activeWorkflowTitle, resolvedTheme, themeMode, language, setActiveView, setThemeMode, setLanguage, workflowProjects, activeWorkflowIndex, activeWorkflowProjectId, workflowCreateProject, workflowDeleteProjects, workflowRenameProject, workflowSetActiveProject]);

    const main = activeView === 'workflow' ? (
        <Suspense fallback={<div className="grid h-full place-content-center text-sm opacity-40">正在加载 Workflow...</div>}>
            <WorkflowWorkspace
                theme={resolvedTheme}
                language={language}
                resolveGenerationCapability={resolveWorkflowGenerationCapability}
                sharedMedia={workflowSharedMedia}
                onReversePrompt={handleWorkflowReversePrompt}
                onRunNode={handleRunWorkflowNode}
                onStopNode={(projectId, nodeId) => { cancelWorkflowGeneration(projectId, nodeId); }}
                onSaveWorkflowMedia={handleSaveWorkflowMedia}
                assetLibrary={assetLibrary}
                onRenameAsset={(id, name) => setAssetLibrary(prev => renameAsset(prev, id, name))}
                onRemoveAsset={id => setAssetLibrary(prev => removeAsset(prev, id))}
                onUpdateAssetTags={(id, tags) => setAssetLibrary(prev => updateAssetTags(prev, id, tags))}
                onRemoveAssetFromFolder={(itemId, folderId) => setAssetLibrary(prev => removeAssetFromFolder(prev, itemId, folderId))}
                onBatchRemoveAssets={ids => setAssetLibrary(prev => batchRemoveAssets(prev, ids))}
                onBatchAddAssetsToFolder={(ids, folderId) => setAssetLibrary(prev => batchAddAssetsToFolder(prev, ids, folderId))}
                onBatchAddAssetTags={(ids, tags) => setAssetLibrary(prev => batchAddAssetTags(prev, ids, tags))}
                onCreateFolder={(parentId, name) => setAssetLibrary(prev => addFolder(prev, { id: generateId(), name, parentId, createdAt: Date.now() }))}
                onRenameFolder={(id, name) => setAssetLibrary(prev => renameFolder(prev, id, name))}
                onRemoveFolder={(id, deleteItems) => setAssetLibrary(prev => removeFolder(prev, id, deleteItems))}
                onOnlineAgentTurn={handleWorkflowOnlineAgentTurn}
                t={t}
                userApiKeys={userApiKeys}
                confirmRouteFallback={confirmRouteFallback}
                dynamicModelOptions={dynamicModelOptions}
                onOpenSettings={() => setIsSettingsPanelOpen(true)}
                onEnhancePrompt={handleEnhancePrompt}
                isEnhancingPrompt={isEnhancingPrompt}
            />
        </Suspense>
    ) : activeView === 'table' ? (
        <Suspense fallback={<div className="grid h-full place-content-center text-sm opacity-40">正在加载 Table...</div>}>
            <TableWorkspace
                project={activeWorkflowProject}
                userApiKeys={userApiKeys}
                confirmRouteFallback={confirmRouteFallback}
                initialNodeId={tableSourceNodeId}
                onCommit={handleCommitTableResult}
                onSaveAsset={handleSaveTableAsset}
                onOpenWorkflow={() => setActiveView('workflow')}
                onOpenSettings={() => setIsSettingsPanelOpen(true)}
            />
        </Suspense>
    ) : (
        <Suspense fallback={<div className="grid h-full place-content-center text-sm opacity-40">正在加载 Agent...</div>}>
            <AgentWorkspace
                project={activeWorkflowProject}
                onCreateProject={() => workflowCreateProject(language === 'zho' ? '未命名工作流' : 'Untitled workflow')}
                onProjectChange={(projectId, patch) => useWorkflowStore.getState().updateProject(projectId, patch)}
                onOnlineTurn={handleWorkflowOnlineAgentTurn}
                onOpenWorkflow={() => setActiveView('workflow')}
                onOpenTable={handleOpenTable}
            />
        </Suspense>
    );

    return <AppShell
        themeBackground={themePalette.appBackground}
        topBar={<StudioTopMenu model={studioMenuModel} />}
        main={main}
        overlays={<>
            <Suspense fallback={null}>
                <SettingsPanel
                    isOpen={isSettingsPanelOpen}
                    onClose={() => setIsSettingsPanelOpen(false)}
                    resolvedTheme={resolvedTheme}
                    userApiKeys={userApiKeys}
                    onAddApiKey={handleAddApiKey}
                    onDeleteApiKey={handleDeleteApiKey}
                    onUpdateApiKey={handleUpdateApiKey}
                    onSetDefaultApiKey={handleSetDefaultApiKey}
                    t={t}
                    clearKeysOnExit={clearKeysOnExit}
                    setClearKeysOnExit={setClearKeysOnExit}
                    usageSummary={usageSummaryMap}
                />
                {addAssetModal?.open && <AssetAddModal
                    isOpen
                    previewDataUrl={addAssetModal.dataUrl}
                    library={assetLibrary}
                    onClose={() => setAddAssetModal(null)}
                    onConfirm={(folderIds, name, tags) => {
                        setAssetLibrary(previous => addAsset(previous, {
                            id: generateId(), name, folderIds, tags: tags || [], dataUrl: addAssetModal.dataUrl,
                            mimeType: addAssetModal.mimeType, width: addAssetModal.width, height: addAssetModal.height,
                            createdAt: Date.now(), source: 'generation',
                        }));
                        setAddAssetModal(null);
                        toast.show('已保存到我的素材。', 'success');
                    }}
                />}
            </Suspense>
            <ToastStack toasts={toast.toasts} onDismiss={toast.dismiss} />
        </>}
    />;
};

async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

export default App;
