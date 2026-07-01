





import React, { useState, useRef, useCallback, useEffect, useMemo, Suspense } from 'react';
import { exportToCanvas } from '@excalidraw/excalidraw';
import { Toolbar } from './components/Toolbar';
import { PromptBar } from './components/PromptBar';
import { Loader } from './components/Loader';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import type { Tool, Point, Element, ImageElement, TextElement, UserEffect, WheelAction, GroupElement, Board, VideoElement, AssetLibrary, AssetCategory, AssetItem, UserApiKey, ModelPreference, AIProvider, AICapability, PromptEnhanceMode, CharacterLockProfile, GenerationHistoryItem, ThemeMode, ChatAttachment, ImageFilters } from './types';
import { DEFAULT_IMAGE_FILTERS } from './types';
import { AssetLibraryPanel } from './components/AssetLibraryPanel';
import { ImageFilterPanel, buildCssFilter, temperatureMatrix, sharpenKernel } from './components/ImageFilterPanel';
import { ElementToolbar } from './components/ElementToolbar';
import { shouldRenderMediaInKonva } from './utils/canvasKonvaMediaEligibility';

// Lazy-loaded components (not needed for first paint)
const CanvasSettings = React.lazy(() => import('./components/CanvasSettings').then(m => ({ default: m.CanvasSettings })));
const OnboardingWizard = React.lazy(() => import('./components/OnboardingWizard').then(m => ({ default: m.OnboardingWizard })));
const RightPanel = React.lazy(() => import('./components/RightPanel').then(m => ({ default: m.RightPanel })));
const WorkflowWorkspace = React.lazy(() => import('./components/workflow/WorkflowWorkspace').then(m => ({ default: m.WorkflowWorkspace })));
const AssetAddModal = React.lazy(() => import('./components/AssetAddModal').then(m => ({ default: m.AssetAddModal })));
const ABCompareOverlay = React.lazy(() => import('./components/ABCompareOverlay').then(m => ({ default: m.ABCompareOverlay })));
import { loadAssetLibrary, addAsset, removeAsset, renameAsset, loadAssetLibraryAsync, saveAssetLibraryAsync } from './utils/assetStorage';
import { loadGenerationHistoryAsync, saveGenerationHistoryAsync } from './utils/generationHistory';
import { diagnoseKeyCapabilities, inferProviderFromModel, reversePromptStreamWithProvider, DEFAULT_PROVIDER_MODELS, generateImageWithProvider, generateVideoWithProvider, inferCapabilityFromModelName, executeUnifiedIgnition } from './services/aiGateway';
import type { MultimodalSlot } from './services/aiGateway';
import { fileToDataUrl, validateAndResizeImage, detectMediaType, resolveMimeType } from './utils/fileUtils';
import { translations } from './utils/translations';
// keyVault imports moved to hooks/useApiKeys.ts
// usageMonitor imports moved to hooks
import { getCompactChromeMetrics } from './utils/uiScale';
import { putImages, getImages, isIdbRef, isDataUrl, toIdbRef, fromIdbRef, deleteImages, getAllKeys } from './utils/imageDB';
import { putVideoBlob, getVideoBlob, isIdbVideoRef, toIdbVideoRef, fromIdbVideoRef, deleteVideoBlobs, getAllVideoKeys } from './utils/mediaDB';
import { collectVideoObjectUrls, diffRemovedObjectUrls } from './utils/objectUrlRegistry';
import { appendHistorySnapshot } from './utils/historyState';
import { compilePromptReferences } from './utils/semanticCompiler';
import { hydrateRawTextToTiptapJSON } from './utils/htmlHydrator';
import { readColdMedia, writeColdMedia } from './utils/mediaIndexedDB';
import { generateId, getElementBounds, rasterizeElements, createNewBoard, THEME_PALETTES, type Rect } from './utils/canvasHelpers';
import { persistBoardsToIDB, loadBoardsWithIDB, loadCharacterLocksWithIDB, persistCharacterLocksToIDB, safeSetItem, BOARDS_STORAGE_KEY, ACTIVE_BOARD_STORAGE_KEY, STORAGE_QUOTA_MESSAGE, STORAGE_SAVE_FAILED_MESSAGE, IMAGE_GENERATION_TIMEOUT_MS, VIDEO_GENERATION_TIMEOUT_MS } from './utils/boardPersistence';
import type { RuntimeJob, RuntimeSession, RuntimeError } from './types/runtime';
import { useApiKeys, DEFAULT_MODEL_PREFS, normalizeApiKeyEntry } from './hooks/useApiKeys';
import { useCanvasInteraction } from './hooks/useCanvasInteraction';
import { useIdbImageResolution } from './hooks/useIdbImageResolution';
import { useGeneration } from './hooks/useGeneration';
import { useToast } from './hooks/useToast';
import ToastStack from './components/Toast';
import { AppShell } from './components/AppShell';
import { FlovartExcalidrawStage } from './components/canvas/FlovartExcalidrawStage';
import type { ExcalidrawViewport } from './components/canvas/ExcalidrawInner';
import { CanvasFixedOverlay, useElementContainerRect } from './components/canvas/CanvasFixedOverlay';
import { type CanvasViewport } from './utils/canvasOverlayViewport';
import { StudioTopMenu, type StudioMenuModel } from './components/studio/StudioTopMenu';
import './styles/generation.css';
import { useWorkspaceStore } from './stores/useWorkspaceStore';
import { useWorkflowStore } from './components/workflow/store';
import { useRuntimeStore } from './stores/useRuntimeStore';
import type { CanvasElement, ElementGenerationState } from './types';
import type { VideoAspectRatio } from './services/aiGateway';
import { getFlovartRuntimeApi, getRuntimeErrorMessage } from './services/flovartRuntime';
import { executeFlovartCommand } from './tools/flovart/core.js';
import { syncCanvasElementsIntoRuntime } from './services/projectRuntimeBridge';
import { getGenerationCapability, type GenerationMode } from './services/generationCapabilities';
import { cancelWorkflowGeneration, runWorkflowGeneration } from './services/workflowGeneration';
import { workflowMediaStorage } from './components/workflow/storage';
import { loadWorkflowMediaBlob } from './components/workflow/media';
import { dispatchWorkflowCommand, setWorkflowNodeRunner } from './services/workflowDispatcher';
import { runWorkflowOnlineAgent } from './services/workflowOnlineAgent';
import type { WorkflowOnlineTurnInput } from './components/workflow/WorkflowAgentPanel';
import {
    buildAttachmentIgnitionReferences,
    buildElementIgnitionReferences,
    buildElementPromptGenerationState,
    createDefaultElementGenerationState,
    getElementGenerationMode,
    isPromptReferenceableElement,
} from './utils/elementPromptState';
import { modelRefModelId, resolveModelSelection } from './utils/modelRefs';
import { exportMediaArchive } from './utils/batchMediaExport';

const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';








const App: React.FC = () => {

    const [boards, setBoards] = useState<Board[]>(() => [createNewBoard('Board 1')]);
    const replaceRuntime = useRuntimeStore(state => state.replaceRuntime);
    const [dataReady, setDataReady] = useState(false);
    const [activeBoardId, setActiveBoardId] = useState<string>(() => {
        try {
            const saved = localStorage.getItem(ACTIVE_BOARD_STORAGE_KEY);
            return saved || '';
        } catch {
            return '';
        }
    });

    const activeBoard = useMemo(() => {
        return boards.find(b => b.id === activeBoardId) ?? boards[0];
    }, [boards, activeBoardId]);

    const { elements, history, historyIndex, panOffset, zoom } = activeBoard;

    const [activeTool, setActiveTool] = useState<Tool>('select');
    const [drawingOptions, setDrawingOptions] = useState({ strokeColor: '#111827', strokeWidth: 5 });
    const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
    const [prompt, setPrompt] = useState('');
    const [promptAttachments, setPromptAttachments] = useState<ChatAttachment[]>([]);
    const [nodePromptAttachments, setNodePromptAttachments] = useState<Record<string, ChatAttachment[]>>({});
    const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
    // @mention id tracking for PromptBar integration
    const [mentionedElementIds, setMentionedElementIds] = useState<string[]>([]);
    // Rich prompt editor document (TipTap JSON) for the docked PromptBar
    const [promptDocument, setPromptDocument] = useState<Record<string, unknown> | undefined>(undefined);
    // Phase 1.3: pending attachments injected from canvas ElementToolbar "加入对话" → Agent Chat
    const [pendingChatAttachments, setPendingChatAttachments] = useState<Array<{ url: string; mimeType: string }>>([]);
    // Phase 1.5: Excalidraw viewport + container ref for fixed overlay positioning
    const [excalidrawViewport, setExcalidrawViewport] = useState<ExcalidrawViewport>({ x: 0, y: 0, zoom: 1 });
    const excalidrawContainerRef = useRef<HTMLDivElement>(null);
    // Excalidraw API ref lifted from FlovartExcalidrawStage so App.tsx can drive
    // Magic Generate screenshot export + "加入对话" href resolution from ElementToolbar.
    const excalidrawApiRef = useRef<any>(null);

    // Phase 1.5 cleanup: Excalidraw-based screen→canvas coordinate conversion.
    // Replaces dead svgRef/getCanvasPoint (SVG deleted in Phase 1.1).
    // Excalidraw: screenX = (canvasX + scrollX) * zoom → canvasX = screenX / zoom - scrollX
    const screenToCanvas = useCallback((screenX: number, screenY: number): { x: number; y: number } => {
        const rect = excalidrawContainerRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        const xOnContainer = screenX - rect.left;
        const yOnContainer = screenY - rect.top;
        return {
            x: xOnContainer / excalidrawViewport.zoom - excalidrawViewport.x,
            y: yOnContainer / excalidrawViewport.zoom - excalidrawViewport.y,
        };
    }, [excalidrawViewport]);

    const getCanvasCenter = useCallback((): { x: number; y: number } => {
        const rect = excalidrawContainerRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return screenToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }, [screenToCanvas]);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const toast = useToast();
    const nodeGenerationRequestsRef = useRef(new Map<string, { controller: AbortController; timeoutId: number }>());
    const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
    const [isLayerMinimized, setIsLayerMinimized] = useState(() => {
        const saved = localStorage.getItem('layerPanelMinimized');
        return saved === 'true';
    });
    const [isInspirationMinimized, setIsInspirationMinimized] = useState(() => {
        const saved = localStorage.getItem('inspirationPanelMinimized');
        return saved === 'true';
    });
    const [rightPanelWidth, setRightPanelWidth] = useState(2); // right panel width for PromptBar
    const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
    const [wheelAction, setWheelAction] = useState<WheelAction>('pan');
    const [filterPanelElementId, setFilterPanelElementId] = useState<string | null>(null);
    const [outpaintMenuId, setOutpaintMenuId] = useState<string | null>(null);
    const [assetLibrary, setAssetLibrary] = useState<AssetLibrary>({ character: [], scene: [], prop: [] });

    useEffect(() => () => {
        nodeGenerationRequestsRef.current.forEach(request => {
            window.clearTimeout(request.timeoutId);
            request.controller.abort();
        });
        nodeGenerationRequestsRef.current.clear();
    }, []);
    const [generationHistory, setGenerationHistory] = useState<GenerationHistoryItem[]>([]);
    const [isAssetPanelOpen, setIsAssetPanelOpen] = useState(false);
    const [addAssetModal, setAddAssetModal] = useState<{ open: boolean; dataUrl: string; mimeType: string; width: number; height: number } | null>(null);

    useEffect(() => {
        if (!activeBoard) return;
        const current = useRuntimeStore.getState().runtime;
        replaceRuntime(syncCanvasElementsIntoRuntime(current, {
            projectId: activeBoard.id,
            canvasElements: elements,
            assetLibrary,
            viewport: { x: panOffset.x, y: panOffset.y, zoom },
        }));
    }, [activeBoard, assetLibrary, elements, panOffset.x, panOffset.y, replaceRuntime, zoom]);
    
    // Persist minimize state
    useEffect(() => {
        safeSetItem('layerPanelMinimized', isLayerMinimized.toString());
    }, [isLayerMinimized]);
    
    useEffect(() => {
        safeSetItem('inspirationPanelMinimized', isInspirationMinimized.toString());
    }, [isInspirationMinimized]);

    useEffect(() => {
        const handleResize = () => setViewportWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const chromeMetrics = useMemo(() => getCompactChromeMetrics(viewportWidth), [viewportWidth]);

    const hasShownStorageErrorRef = useRef(false);

    // 鈹€鈹€ Async boot: load boards, assets, character locks from IndexedDB 鈹€鈹€
    useEffect(() => {
        Promise.all([
            loadBoardsWithIDB(),
            loadAssetLibraryAsync(),
            loadGenerationHistoryAsync(),
            loadCharacterLocksWithIDB(),
        ]).then(([loadedBoards, loadedAssets, loadedHistory, loadedLocks]) => {
            setBoards(loadedBoards);
            if (loadedBoards.length > 0) setActiveBoardId(prev => prev || loadedBoards[0].id);
            setAssetLibrary(loadedAssets);
            setGenerationHistory(loadedHistory);
            setCharacterLocks(loadedLocks);
            setDataReady(true);
        }).catch(() => {
            setDataReady(true); // fall through with defaults
        });
    }, []);

    // 鈹€鈹€ Persist boards to IDB 鈹€鈹€
    useEffect(() => {
        if (!dataReady) return;
        persistBoardsToIDB(boards).then(() => {
            hasShownStorageErrorRef.current = false;
            setError(prev => (prev === STORAGE_QUOTA_MESSAGE || prev === STORAGE_SAVE_FAILED_MESSAGE ? null : prev));
        }).catch(err => {
            if (!hasShownStorageErrorRef.current) {
                hasShownStorageErrorRef.current = true;
                console.error('Failed to persist boards to IDB', err);
                setError(isStorageQuotaError(err) ? STORAGE_QUOTA_MESSAGE : STORAGE_SAVE_FAILED_MESSAGE);
            }
        });
    }, [boards, dataReady]);

    // 鈹€鈹€ Persist asset library to IDB 鈹€鈹€
    useEffect(() => {
        if (!dataReady) return;
        saveAssetLibraryAsync(assetLibrary).catch(console.error);
    }, [assetLibrary, dataReady]);

    useEffect(() => {
        if (!dataReady) return;
        saveGenerationHistoryAsync(generationHistory).catch(console.error);
    }, [generationHistory, dataReady]);

    useEffect(() => {
        if (!activeBoardId) return;
        try {
            localStorage.setItem(ACTIVE_BOARD_STORAGE_KEY, activeBoardId);
        } catch (err) {
            console.error('Failed to persist active board id', err);
        }
    }, [activeBoardId]);

    // 鈹€鈹€ Revoke blob: URLs for removed video elements 鈹€鈹€
    const activeVideoUrlsRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        const nextUrls = collectVideoObjectUrls(elements);
        const removed = diffRemovedObjectUrls(activeVideoUrlsRef.current, nextUrls);
        removed.forEach(url => URL.revokeObjectURL(url));
        activeVideoUrlsRef.current = nextUrls;
    }, [elements]);
    useEffect(() => {
        return () => {
            activeVideoUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
            activeVideoUrlsRef.current.clear();
        };
    }, []);

    const idbImageHrefs = elements.flatMap(el => {
        if (el.type !== 'image') return [];
        const hrefs = [el.href];
        if (el.mask) hrefs.push(el.mask);
        return hrefs.filter(h => isIdbRef(h));
    });
    const resolvedIdbImages = useIdbImageResolution(idbImageHrefs);
    const resolveHref = (href: string) => {
        if (isIdbRef(href)) return resolvedIdbImages[href] || TRANSPARENT_PIXEL;
        return href;
    };

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

    // 鈹€鈹€ Zustand store: shell-level state 鈹€鈹€
    const language = useWorkspaceStore(s => s.language);
    const setLanguage = useWorkspaceStore(s => s.setLanguage);
    const activeView = useWorkspaceStore(s => s.activeView);
    const setActiveView = useWorkspaceStore(s => s.setActiveView);
    const workflowProjects = useWorkflowStore(s => s.projects);
    const activeWorkflowProjectId = useWorkflowStore(s => s.activeProjectId);
    const activeWorkflowTitle = workflowProjects.find(project => project.id === activeWorkflowProjectId)?.title || 'Workflow';
    const themeMode = useWorkspaceStore(s => s.themeMode);
    const setThemeMode = useWorkspaceStore(s => s.setThemeMode);
    const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => {
        if (typeof window === 'undefined') return 'light';
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    });
    
    const [userEffects, setUserEffects] = useState<UserEffect[]>(() => {
        try {
            const saved = localStorage.getItem('userEffects');
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error("Failed to parse user effects from localStorage", error);
            return [];
        }
    });
    const [characterLocks, setCharacterLocks] = useState<CharacterLockProfile[]>([]);
    const [activeCharacterLockId, setActiveCharacterLockId] = useState<string | null>(() => {
        return localStorage.getItem('characterLocks.activeId') || null;
    });
    
    const [generationMode, setGenerationMode] = useState<'image' | 'video' | 'keyframe'>('image');
    const [videoAspectRatio, setVideoAspectRatio] = useState<VideoAspectRatio>('16:9');
    const [videoDurationSec, setVideoDurationSec] = useState<number>(5);
    const [videoResolution, setVideoResolution] = useState<string>('720p');
    const [videoGenerateAudio, setVideoGenerateAudio] = useState<boolean>(true);
    const [videoWatermark, setVideoWatermark] = useState<boolean>(false);
    const [progressMessage, setProgressMessage] = useState<string>('');
    const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);
    const [recentlyCompleted, setRecentlyCompleted] = useState<Set<string>>(new Set());
    const prevGeneratingIdsRef = useRef<Set<string>>(new Set());
    const runtimeSessionsRef = useRef<Record<string, RuntimeSession>>({});
    const runtimeJobsRef = useRef<Record<string, RuntimeJob>>({});
    const [isAutoEnhanceEnabled, setIsAutoEnhanceEnabled] = useState<boolean>(() => {
        try { return localStorage.getItem('autoEnhance.v1') === 'true'; } catch { return false; }
    });
    const [batchCount, setBatchCount] = useState<number>(1); // 1 = normal, 2/4 = batch mode

    useEffect(() => {
        const currentGenerating = new Set<string>();
        for (const el of elements) {
            if ((el as CanvasElement).generationState?.status === 'running') {
                currentGenerating.add(el.id);
            }
        }
        const newlyCompleted = new Set<string>();
        prevGeneratingIdsRef.current.forEach(id => {
            if (!currentGenerating.has(id)) newlyCompleted.add(id);
        });
        if (newlyCompleted.size > 0) {
            setRecentlyCompleted(prev => new Set([...prev, ...newlyCompleted]));
            setTimeout(() => {
                setRecentlyCompleted(prev => {
                    const next = new Set(prev);
                    newlyCompleted.forEach(id => next.delete(id));
                    return next;
                });
            }, 2000);
        }
        prevGeneratingIdsRef.current = currentGenerating;
    }, [elements]);

    // 鈹€鈹€ A/B 瀵规瘮鐘舵€?鈹€鈹€鈹€鈹€鈹€鈹€
    const [abCompare, setAbCompare] = useState<{
        imageA: { src: string; label: string };
        imageB: { src: string; label: string };
    } | null>(null);



  // Dynamically compute available models from user-configured API keys

    // Usage monitoring summary (recomputed when settings panel opens or keys change)

    // 鎸佷箙鍖?autoEnhance 寮€鍏?
    useEffect(() => {
        safeSetItem('autoEnhance.v1', isAutoEnhanceEnabled.toString());
    }, [isAutoEnhanceEnabled]);

    useEffect(() => {
        const stage = progressMessage?.trim();
        if (!stage) return;
        const now = Date.now();
        Object.values(runtimeJobsRef.current).forEach(job => {
            if (job.status !== 'running') return;
            job.progress = {
                pct: Math.max(job.progress.pct, 10),
                stage,
            };
            job.updatedAt = now;
        });
    }, [progressMessage]);

    const resolvedTheme = themeMode === 'system' ? systemTheme : themeMode;
    const themePalette = THEME_PALETTES[resolvedTheme];
    const canvasBackgroundColor = themePalette.canvasBackground;

    // 鈹€鈹€ Extracted: API key management 鈹€鈹€
    const {
        userApiKeys, setUserApiKeys, apiKeysLoaded, showOnboarding, setShowOnboarding,
        clearKeysOnExit, setClearKeysOnExit, modelPreference, setModelPreference,
        modelPreferenceSavedAt, modelPreferenceSaveError,
        activeUserKeyId, activeUserModelId, setActiveUserModelId, handleUserKeyChange,
        dynamicModelOptions, usageSummaryMap, getPreferredApiKey,
        handleAddApiKey, handleDeleteApiKey, handleUpdateApiKey, handleSetDefaultApiKey,
        modelAutoSwitchNotice,
    } = useApiKeys(isSettingsPanelOpen);

    useEffect(() => {
        if (!boards.length) return;
        if (!boards.some(board => board.id === activeBoardId)) {
            setActiveBoardId(boards[0].id);
        }
    }, [boards, activeBoardId]);
    
    useEffect(() => {
        safeSetItem('userEffects', JSON.stringify(userEffects));
    }, [userEffects]);



    useEffect(() => {
        if (!dataReady) return;
        persistCharacterLocksToIDB(characterLocks).catch(console.error);
    }, [characterLocks, dataReady]);

    useEffect(() => {
        if (activeCharacterLockId) {
            safeSetItem('characterLocks.activeId', activeCharacterLockId);
        } else {
            localStorage.removeItem('characterLocks.activeId');
        }
    }, [activeCharacterLockId]);

    useEffect(() => {
        if (activeCharacterLockId && !characterLocks.some(lock => lock.id === activeCharacterLockId)) {
            setActiveCharacterLockId(null);
        }
    }, [characterLocks, activeCharacterLockId]);

    // Close filter panel when selection changes
    useEffect(() => {
        if (filterPanelElementId && !selectedElementIds.includes(filterPanelElementId)) {
            setFilterPanelElementId(null);
        }
    }, [selectedElementIds, filterPanelElementId]);


    const handleAddUserEffect = useCallback((effect: UserEffect) => {
        setUserEffects(prev => [...prev, effect]);
    }, []);

    const handleDeleteUserEffect = useCallback((id: string) => {
        setUserEffects(prev => prev.filter(effect => effect.id !== id));
    }, []);





    const selectedSingleImage = useMemo<ImageElement | null>(() => {
        if (selectedElementIds.length !== 1) return null;
        const selected = elements.find(el => el.id === selectedElementIds[0]);
        return selected && selected.type === 'image' ? selected : null;
    }, [elements, selectedElementIds]);

    const activeCharacterLock = useMemo(() => {
        if (!activeCharacterLockId) return null;
        return characterLocks.find(lock => lock.id === activeCharacterLockId) || null;
    }, [activeCharacterLockId, characterLocks]);

    // Mention items for the docked PromptBar: all elements except currently selected ones.
    const mentionItems = useMemo(() => {
        return (activeBoard?.elements ?? [])
            .filter(el => !selectedElementIds.includes(el.id))
            .map(el => ({
                id: el.id,
                label: el.name || `${el.type} ${el.id.slice(-4)}`,
                thumbnail: '',
                elementType: el.type === 'embeddable' ? 'video' : el.type === 'image' ? 'image' : 'text',
                description: el.type,
            }));
    }, [activeBoard?.elements, selectedElementIds]);

    const handleLockCharacterFromSelection = useCallback((name?: string) => {
        if (!selectedSingleImage) {
            setError('Please select an image before locking a character.');
            return;
        }
        const lockName = name?.trim() || selectedSingleImage.name || `Character ${characterLocks.length + 1}`;
        const descriptor = [
            `Character lock: ${lockName}.`,
            'Keep face, hairstyle, costume, body shape, and age consistent across all shots.',
            'Do not alter identity unless explicitly requested.',
        ].join(' ');

        const next: CharacterLockProfile = {
            id: generateId(),
            name: lockName,
            anchorElementId: selectedSingleImage.id,
            referenceImage: selectedSingleImage.href,
            descriptor,
            createdAt: Date.now(),
            isActive: true,
        };

        setCharacterLocks(prev => [...prev.map(lock => ({ ...lock, isActive: false })), next]);
        setActiveCharacterLockId(next.id);
        setError(null);
    }, [selectedSingleImage, characterLocks.length]);

    const handleSetActiveCharacterLock = useCallback((id: string | null) => {
        setActiveCharacterLockId(id);
        setCharacterLocks(prev =>
            prev.map(lock => ({ ...lock, isActive: id ? lock.id === id : false }))
        );
    }, []);

    // 鈹€鈹€ Board mutation helpers (needed before useCanvasInteraction) 鈹€鈹€
    const updateActiveBoard = (updater: (board: Board) => Board) => {
        setBoards(prevBoards => prevBoards.map(board =>
            board.id === activeBoardId ? updater(board) : board
        ));
    };

    const setElements = (updater: (prev: Element[]) => Element[], commit: boolean = true) => {
        updateActiveBoard(board => {
            const newElements = updater(board.elements);
            if (commit) {
                const next = appendHistorySnapshot(board.history, board.historyIndex, newElements);
                return {
                    ...board,
                    elements: newElements,
                    history: next.history,
                    historyIndex: next.historyIndex,
                };
            } else {
                 const tempHistory = [...board.history];
                 tempHistory[board.historyIndex] = newElements;
                 return { ...board, elements: newElements, history: tempHistory };
            }
        });
    };

    const updateElementGenerationState = useCallback((id: string, generationState: ElementGenerationState) => {
        setElements(prev => prev.map(element => {
            if (element.id !== id || (element.type !== 'image' && element.type !== 'video')) return element;
            return {
                ...element,
                generationState,
            };
        }), false);
    }, [setElements]);

    const updateElementMedia = useCallback((id: string, media: { href: string; mimeType: string }) => {
        setElements(prev => prev.map(element => {
            if (element.id !== id || (element.type !== 'image' && element.type !== 'video')) return element;
            return {
                ...element,
                href: media.href,
                mimeType: media.mimeType,
                sourceKind: element.type === 'video' ? 'generation' : undefined,
            } as Element;
        }));
    }, [setElements]);

    const commitAction = useCallback((updater: (prev: Element[]) => Element[]) => {
        updateActiveBoard(board => {
            const newElements = updater(board.elements);
            const next = appendHistorySnapshot(board.history, board.historyIndex, newElements);
            return {
                ...board,
                elements: newElements,
                history: next.history,
                historyIndex: next.historyIndex,
            };
        });
    }, [activeBoardId]);

    // 鈹€鈹€ Paint mask callback (needed by useCanvasInteraction) 鈹€鈹€
    // 鈹€鈹€ getDescendants (needed by useCanvasInteraction) 鈹€鈹€
    const getDescendants = useCallback((elementId: string, allElements: Element[]): Element[] => {
        const descendants: Element[] = [];
        const children = allElements.filter(el => el.parentId === elementId);
        for (const child of children) {
            descendants.push(child);
            if (child.type === 'group') {
                descendants.push(...getDescendants(child.id, allElements));
            }
        }
        return descendants;
    }, []);

    const resolveColdMediaRef = useCallback(async (href: string) => {
        if (!href.startsWith('cold-media:')) return href;
        return await readColdMedia(href.slice('cold-media:'.length)) || href;
    }, []);

    // 鈹€鈹€ Extracted: canvas interaction (mouse, selection, refs) 鈹€鈹€
    const {
        elementsRef, previousToolRef, spacebarDownTime,
    } = useCanvasInteraction({
        elements, zoom, panOffset,
        activeTool, setActiveTool, drawingOptions, wheelAction,
        selectedElementIds, setSelectedElementIds,
        updateActiveBoard, setElements, commitAction,
        getDescendants,
    });

    // Fixed-overlay container rect. Drives position:fixed toolbars via placeOverlay.
    // Phase 1.5: switched from legacy svgRef to Excalidraw container ref.
    const canvasContainerRect = useElementContainerRect(excalidrawContainerRef);
    // Phase 1.5: Convert Excalidraw viewport → CanvasViewport for placeOverlay calls.
    // Excalidraw scrollX/Y are canvas-space scroll offsets; panScreenX/Y = scroll * zoom.
    const canvasViewport: CanvasViewport = useMemo(() => ({
        zoom: excalidrawViewport.zoom,
        panScreenX: excalidrawViewport.x * excalidrawViewport.zoom,
        panScreenY: excalidrawViewport.y * excalidrawViewport.zoom,
    }), [excalidrawViewport]);

    // 鈹€鈹€ Extracted: generation (AI image/video/batch) 鈹€鈹€
    const {
        isEnhancingPrompt, batchResults, setBatchResults,
        handleEnhancePrompt, saveGenerationToHistory,
        handleSplitImageLayers, handleUpscaleImage, handleRemoveImageBackground,
        handleOutpaint, handleGenerate, handleBatchGenerate,
        handleSelectBatchResult, handleSelectAllBatchResults,
    } = useGeneration({
        elements, selectedElementIds, prompt, generationMode, videoAspectRatio,
        videoDurationSec, videoResolution, videoGenerateAudio, videoWatermark,
        isAutoEnhanceEnabled, mentionedElementIds, chatAttachments, promptAttachments,
        activeCharacterLock, batchCount,
        modelPreference, userApiKeys,
        resolveMediaHref: resolveColdMediaRef,
        getCanvasCenter,
        setSelectedElementIds, setIsLoading, setError, setProgressMessage,
        setIsSettingsPanelOpen, setGenerationHistory,
        commitAction, getPreferredApiKey,
    });

    // Magic Generate handler: screenshot from Excalidraw selection → commit as ImageElement → run handleGenerate.
    const handleMagicGenerate = useCallback((dataUrl: string, width: number, height: number, bounds: { x: number; y: number; width: number; height: number }) => {
        const newId = generateId();
        const screenshotEl: ImageElement = {
            id: newId,
            type: 'image',
            x: bounds.x + bounds.width / 2 - width / 2,
            y: bounds.y + bounds.height + 24,
            width,
            height,
            href: dataUrl,
            mimeType: 'image/png',
            name: `Magic ${newId.slice(-4)}`,
        };
        commitAction(prev => [...prev, screenshotEl]);
        // Clear prompt selection; mention the new screenshot so handleGenerate picks it as reference_image.
        setSelectedElementIds([]);
        setMentionedElementIds([newId]);
        handleGenerate(undefined, 'prompt', 'image', [], [newId]);
    }, [commitAction, handleGenerate]);

    // Lifted Magic Generate trigger: ElementToolbar calls this when ≥2 elements selected.
    // Uses excalidrawApiRef to export selection → screenshot → handleMagicGenerate.
    const triggerMagicGenerate = useCallback(async () => {
        const api = excalidrawApiRef.current;
        if (!api) return;
        if (selectedElementIds.length < 2) return;
        const appState = api.getAppState();
        const files = api.getFiles();
        const allElements = api.getSceneElements();
        const selected = allElements.filter((e: any) => selectedElementIds.includes(e.id) && !e.isDeleted);
        if (selected.length === 0) return;
        const minX = Math.min(...selected.map((e: any) => e.x));
        const minY = Math.min(...selected.map((e: any) => e.y));
        const maxX = Math.max(...selected.map((e: any) => e.x + (e.width || 0)));
        const maxY = Math.max(...selected.map((e: any) => e.y + (e.height || 0)));
        const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        const canvas = await exportToCanvas({
            elements: selected,
            appState: { ...appState, selectedElementIds: Object.fromEntries(selectedElementIds.map(id => [id, true])) },
            files,
            mimeType: 'image/png',
            maxWidthOrHeight: 2048,
            quality: 1,
        } as any);
        const dataUrl = canvas.toDataURL('image/png', 0.8);
        handleMagicGenerate(dataUrl, canvas.width, canvas.height, bounds);
        api.updateScene({ appState: { selectedElementIds: {} } });
    }, [handleMagicGenerate, selectedElementIds]);

    // Lifted "加入对话" trigger: ElementToolbar calls this when a single image is selected.
    // Resolves href via resolveColdMediaRef → setPendingChatAttachments.
    const triggerAddToChat = useCallback(async () => {
        if (selectedElementIds.length !== 1) return;
        const id = selectedElementIds[0];
        const el = (activeBoard?.elements ?? []).find(e => e.id === id);
        if (!el || el.type !== 'image') return;
        const imgEl = el as ImageElement;
        const href = (imgEl as { href?: string }).href;
        if (!href) return;
        const resolved = await resolveColdMediaRef(href);
        if (!resolved) return;
        setPendingChatAttachments([{ url: resolved, mimeType: (imgEl as { mimeType?: string }).mimeType || 'image/png' }]);
        excalidrawApiRef.current?.updateScene({ appState: { selectedElementIds: {} } });
        setSelectedElementIds([]);
    }, [activeBoard, resolveColdMediaRef, selectedElementIds]);

    const resolveWorkflowGenerationCapability = useCallback((mode: GenerationMode, modelId?: string) => {
        const fallbackModel = mode === 'text'
            ? modelPreference.textModel
            : mode === 'video' ? modelPreference.videoModel : modelPreference.imageModel;
        return getGenerationCapability(userApiKeys, mode, modelId || fallbackModel);
    }, [modelPreference.imageModel, modelPreference.textModel, modelPreference.videoModel, userApiKeys]);

    const workflowSharedMedia = useMemo(() => {
        const mediaType = (mimeType: string) => mimeType.startsWith('image/')
            ? 'image' as const
            : mimeType.startsWith('video/') ? 'video' as const : null;
        return [
            ...Object.entries(assetLibrary).flatMap(([category, items]) => items.flatMap(item => {
                const type = mediaType(item.mimeType);
                return type ? [{ id: `asset:${item.id}`, source: 'asset' as const, sourceId: item.id, name: item.name || '我的素材', href: item.dataUrl, mimeType: item.mimeType, type, category: category as AssetCategory, width: item.width, height: item.height, createdAt: item.createdAt, prompt: item.prompt }] : [];
            })),
            ...generationHistory.flatMap(item => {
                const type = mediaType(item.mimeType);
                return type ? [{ id: `history:${item.id}`, source: 'history' as const, sourceId: item.id, name: item.name || item.prompt || '生成历史', href: item.dataUrl, mimeType: item.mimeType, type, width: item.width, height: item.height, createdAt: item.createdAt, prompt: item.prompt }] : [];
            }),
        ];
    }, [assetLibrary, generationHistory]);

    const handleRunWorkflowNode = useCallback(async (projectId: string, nodeId: string) => {
        const project = useWorkflowStore.getState().projects.find(item => item.id === projectId);
        if (!project) return;
        await runWorkflowGeneration(project, nodeId, {
            userApiKeys,
            modelPreference,
            saveHistory: saveGenerationToHistory,
            getProject: () => useWorkflowStore.getState().projects.find(item => item.id === projectId) || null,
            onProjectChange: nextProject => {
                useWorkflowStore.getState().updateProject(projectId, {
                    nodes: nextProject.nodes,
                    connections: nextProject.connections,
                });
            },
        });
    }, [modelPreference, saveGenerationToHistory, userApiKeys]);

    const handleSaveWorkflowMedia = useCallback(async (projectId: string, nodeId: string) => {
        const node = useWorkflowStore.getState().projects.find(item => item.id === projectId)?.nodes.find(item => item.id === nodeId);
        if (!node || node.type !== 'image') return;
        let dataUrl = node.metadata.href || '';
        if (node.metadata.storageKey) {
            const blob = await workflowMediaStorage.get(node.metadata.storageKey);
            if (!blob) return;
            dataUrl = (await fileToDataUrl(new File([blob], node.metadata.name || 'workflow-image', { type: node.metadata.mimeType || blob.type }))).dataUrl;
        }
        if (!dataUrl) return;
        setAddAssetModal({ open: true, dataUrl, mimeType: node.metadata.mimeType || 'image/png', width: node.metadata.naturalWidth || node.width, height: node.metadata.naturalHeight || node.height });
    }, []);

    const handleWorkflowOnlineAgentTurn = useCallback((input: WorkflowOnlineTurnInput) => runWorkflowOnlineAgent(input, {
        userApiKeys,
        modelPreference,
    }), [modelPreference, userApiKeys]);

    useEffect(() => {
        setWorkflowNodeRunner(handleRunWorkflowNode, (projectId, nodeId) => {
            if (!cancelWorkflowGeneration(projectId, nodeId)) throw new Error('该节点当前没有运行中的生成任务。');
        });
        return () => setWorkflowNodeRunner(undefined);
    }, [handleRunWorkflowNode]);

    const getInlineApiKeyForElement = useCallback((element: CanvasElement) => {
        const model = element.generationState?.modelId || (element.type === 'video' ? modelPreference.videoModel : modelPreference.imageModel);
        const capability = inferCapabilityFromModelName(model);
        const resolved = resolveModelSelection(model, userApiKeys, capability);
        return resolved?.key || getPreferredApiKey(capability, inferProviderFromModel(modelRefModelId(model)));
    }, [getPreferredApiKey, modelPreference.imageModel, modelPreference.videoModel, userApiKeys]);

    useEffect(() => {
        setSelectedElementIds([]);
        setPrompt('');
    }, [activeBoardId]);


    const addChatAttachment = useCallback((payload: Omit<ChatAttachment, 'id'>) => {
        setChatAttachments(prev => {
            const exists = prev.some(item => item.href === payload.href);
            if (exists) return prev;
            return [...prev, { ...payload, id: generateId() }];
        });
    }, []);

    const addPromptAttachment = useCallback((payload: Omit<ChatAttachment, 'id'>) => {
        setPromptAttachments(prev => {
            const exists = prev.some(item => item.href === payload.href);
            if (exists) return prev;
            return [...prev, { ...payload, id: generateId() }];
        });
    }, []);

    const handleAddAttachmentFromCanvas = useCallback((payload: { id: string; name?: string; href: string; mimeType: string }) => {
        addChatAttachment({
            name: payload.name || `Canvas ${payload.id.slice(-4)}`,
            href: payload.href,
            mimeType: payload.mimeType,
            source: 'canvas',
        });
    }, [addChatAttachment]);

    const handleAddPromptAttachmentFromCanvas = useCallback((payload: { id: string; name?: string; href: string; mimeType: string }) => {
        addPromptAttachment({
            name: payload.name || `Canvas ${payload.id.slice(-4)}`,
            href: payload.href,
            mimeType: payload.mimeType,
            source: 'canvas',
        });
    }, [addPromptAttachment]);

    const readAttachmentFile = useCallback(async (file: File) => {
        if (file.type.startsWith('video/')) {
            const { dataUrl, mimeType } = await fileToDataUrl(file);
            return { dataUrl, mimeType: mimeType || 'video/mp4', resized: false };
        }
        return validateAndResizeImage(file);
    }, []);

    const offloadAttachmentDataUrl = useCallback(async (scope: string, index: number, dataUrl: string) => {
        const key = `${scope}:${Date.now()}:${index}:${Math.random().toString(36).slice(2, 8)}`;
        await writeColdMedia(key, dataUrl);
        return `cold-media:${key}`;
    }, []);

    const handleAddAttachmentFiles = useCallback(async (files: FileList | File[]) => {
        const list = Array.from(files).filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
        if (list.length === 0) return;
        try {
            const results = await Promise.all(list.map(f => readAttachmentFile(f)));
            let anyResized = false;
            await Promise.all(results.map(async (item, index) => {
                if (item.resized) anyResized = true;
                addChatAttachment({
                    name: list[index].name || `Upload ${index + 1}`,
                    href: await offloadAttachmentDataUrl('chat-attachment', index, item.dataUrl),
                    mimeType: item.mimeType,
                    source: 'upload',
                });
            }));
            if (anyResized) {
                toast.show('部分图片尺寸过大，已自动压缩。', 'warning');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Attachment upload failed.';
            setError(message);
        }
    }, [addChatAttachment, offloadAttachmentDataUrl, readAttachmentFile, toast]);

    const handleAddPromptAttachmentFiles = useCallback(async (files: FileList | File[]) => {
        const list = Array.from(files).filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
        if (list.length === 0) return;
        try {
            const results = await Promise.all(list.map(f => readAttachmentFile(f)));
            let anyResized = false;
            await Promise.all(results.map(async (item, index) => {
                if (item.resized) anyResized = true;
                addPromptAttachment({
                    name: list[index].name || `Upload ${index + 1}`,
                    href: await offloadAttachmentDataUrl('prompt-attachment', index, item.dataUrl),
                    mimeType: item.mimeType,
                    source: 'upload',
                });
            }));
            if (anyResized) {
                toast.show('部分图片尺寸过大，已自动压缩。', 'warning');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Attachment upload failed.';
            setError(message);
        }
    }, [addPromptAttachment, offloadAttachmentDataUrl, readAttachmentFile, toast]);

    const handleRemoveChatAttachment = useCallback((id: string) => {
        setChatAttachments(prev => prev.filter(item => item.id !== id));
    }, []);

    const handleRemovePromptAttachment = useCallback((id: string) => {
        setPromptAttachments(prev => prev.filter(item => item.id !== id));
    }, []);

    const handleAddNodePromptAttachmentFiles = useCallback(async (elementId: string, files: FileList | File[]) => {
        const list = Array.from(files).filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
        if (list.length === 0) return;
        try {
            const results = await Promise.all(list.map(f => readAttachmentFile(f)));
            let anyResized = false;
            const nextAttachments = await Promise.all(results.map(async (item, index) => {
                if (item.resized) anyResized = true;
                return {
                    id: generateId(),
                    name: list[index].name || `Upload ${index + 1}`,
                    href: await offloadAttachmentDataUrl(`node-prompt-${elementId}`, index, item.dataUrl),
                    mimeType: item.mimeType,
                    source: 'upload' as const,
                };
            }));
            setNodePromptAttachments(prev => ({
                ...prev,
                [elementId]: [...(prev[elementId] || []), ...nextAttachments],
            }));
            if (anyResized) {
                toast.show('部分图片尺寸过大，已自动压缩。', 'warning');
            }
        } catch (error) {
            console.error(error);
            toast.show('参考媒体读取失败，请换一个文件重试。', 'error');
        }
    }, [offloadAttachmentDataUrl, readAttachmentFile, toast]);

    const handleRemoveNodePromptAttachment = useCallback((elementId: string, id: string) => {
        setNodePromptAttachments(prev => ({
            ...prev,
            [elementId]: (prev[elementId] || []).filter(item => item.id !== id),
        }));
    }, []);

    const updateNodePromptPayload = useCallback((element: CanvasElement, rawText: string, richTextDocument?: Record<string, unknown>) => {
        const modelId = element.generationState?.modelId || (element.type === 'video' ? modelPreference.videoModel : modelPreference.imageModel);
        const aspectRatio = element.generationState?.aspectRatio || videoAspectRatio;
        updateElementGenerationState(element.id, buildElementPromptGenerationState({
            currentState: element.generationState,
            target: element,
            allElements: elements,
            modelId,
            aspectRatio,
            rawText,
            richTextDocument,
        }));
    }, [elements, modelPreference.imageModel, modelPreference.videoModel, updateElementGenerationState, videoAspectRatio]);

    const updateNodePromptStatePatch = useCallback((
        elementId: string,
        patch: Partial<Omit<ElementGenerationState, 'promptPayload'>>,
    ) => {
        const target = elementsRef.current.find(item => item.id === elementId);
        if (!target || !isPromptReferenceableElement(target)) return;
        const fallbackModel = target.type === 'video' ? modelPreference.videoModel : modelPreference.imageModel;
        const currentState = createDefaultElementGenerationState(target, fallbackModel, videoAspectRatio);
        updateElementGenerationState(elementId, {
            ...currentState,
            ...patch,
            promptPayload: currentState.promptPayload,
        });
    }, [modelPreference.imageModel, modelPreference.videoModel, updateElementGenerationState, videoAspectRatio]);

    const handleStopNodePromptGeneration = useCallback((elementId: string) => {
        const request = nodeGenerationRequestsRef.current.get(elementId);
        if (request) {
            nodeGenerationRequestsRef.current.delete(elementId);
            window.clearTimeout(request.timeoutId);
            request.controller.abort(new DOMException('生成已停止', 'AbortError'));
        }
        updateNodePromptStatePatch(elementId, { status: 'error', error: '生成已停止，可重新发起。', progress: undefined });
        setProgressMessage(null);
        toast.show('已停止当前节点生成。', 'info');
    }, [toast.show, updateNodePromptStatePatch]);

    const handleNodePromptGenerate = useCallback(async (elementId: string) => {
        const target = elementsRef.current.find(item => item.id === elementId);
        if (!target || !isPromptReferenceableElement(target)) return;

        const fallbackModel = target.type === 'video' ? modelPreference.videoModel : modelPreference.imageModel;
        const currentState = createDefaultElementGenerationState(target, fallbackModel, videoAspectRatio);
        if (currentState.status === 'running' && nodeGenerationRequestsRef.current.has(elementId)) return;

        const apiKeyPayload = getInlineApiKeyForElement(target);
        if (!apiKeyPayload) {
            updateElementGenerationState(target.id, {
                ...currentState,
                status: 'error',
                error: `Provider key is not configured: ${getElementGenerationMode(target)}`,
                progress: undefined,
            });
            return;
        }

        const previousRequest = nodeGenerationRequestsRef.current.get(elementId);
        if (previousRequest) {
            window.clearTimeout(previousRequest.timeoutId);
            previousRequest.controller.abort();
        }
        const controller = new AbortController();
        const timeoutMessage = target.type === 'video'
            ? '视频生成超时（已等待超过 11 分钟），请重试或检查 Provider 状态。'
            : '图片生成超时（已等待超过 3 分钟），请重试或检查 Provider 状态。';
        const timeoutId = window.setTimeout(() => controller.abort(new DOMException(timeoutMessage, 'TimeoutError')), target.type === 'video' ? VIDEO_GENERATION_TIMEOUT_MS : IMAGE_GENERATION_TIMEOUT_MS);
        nodeGenerationRequestsRef.current.set(elementId, { controller, timeoutId });

        updateElementGenerationState(target.id, {
            ...currentState,
            status: 'running',
            error: undefined,
            progress: 5,
        });

        try {
            const rawPromptReferences = buildElementIgnitionReferences(currentState.promptPayload, elementsRef.current);
            const promptReferences = await Promise.all(rawPromptReferences.map(async ref => {
                if ('href' in ref && ref.href) {
                    const resolvedHref = await resolveColdMediaRef(ref.href);
                    return { ...ref, href: resolvedHref };
                }
                return ref;
            }));
            const attachmentReferences = await buildAttachmentIgnitionReferences(nodePromptAttachments[elementId] || [], resolveColdMediaRef);
            const result = await executeUnifiedIgnition({
                elementId: target.id,
                prompt: currentState.promptPayload.rawText,
                modelId: currentState.modelId,
                apiKeyPayload,
                aspectRatio: currentState.aspectRatio || videoAspectRatio,
                durationSec: currentState.durationSec ?? videoDurationSec,
                resolution: currentState.resolution || videoResolution,
                generateAudio: currentState.generateAudio ?? videoGenerateAudio,
                watermark: currentState.watermark ?? videoWatermark,
                references: [...promptReferences, ...attachmentReferences],
                signal: controller.signal,
                onProgress: (nextProgress, message) => {
                    if (nodeGenerationRequestsRef.current.get(elementId)?.controller !== controller) return;
                    setProgressMessage(message);
                    updateNodePromptStatePatch(elementId, { status: 'running', error: undefined, progress: nextProgress });
                },
            });

            if (nodeGenerationRequestsRef.current.get(elementId)?.controller !== controller) return;
            if (result.ok) {
                updateElementMedia(elementId, { href: result.mediaUrl, mimeType: result.mimeType });
                updateNodePromptStatePatch(elementId, { status: 'success', error: undefined, progress: 100 });
                return;
            }
            updateNodePromptStatePatch(elementId, { status: 'error', error: result.errorMessage, progress: undefined });
            toast.show(result.errorMessage, 'error');
        } catch (generationError) {
            if (nodeGenerationRequestsRef.current.get(elementId)?.controller !== controller) return;
            const reason = controller.signal.aborted ? controller.signal.reason : generationError;
            const message = reason instanceof Error ? reason.message : '生成失败，请重试。';
            updateNodePromptStatePatch(elementId, { status: 'error', error: message, progress: undefined });
            toast.show(message, 'error');
        } finally {
            window.clearTimeout(timeoutId);
            if (nodeGenerationRequestsRef.current.get(elementId)?.controller === controller) {
                nodeGenerationRequestsRef.current.delete(elementId);
                setProgressMessage(null);
            }
        }
    }, [getInlineApiKeyForElement, modelPreference.imageModel, modelPreference.videoModel, nodePromptAttachments, resolveColdMediaRef, toast.show, updateElementGenerationState, updateElementMedia, updateNodePromptStatePatch, videoAspectRatio, videoDurationSec, videoGenerateAudio, videoResolution, videoWatermark]);

    const t = useCallback((key: string, ...args: any[]): any => {
        const keys = key.split('.');
        let result: any = translations[language];
        for (const k of keys) {
            result = result?.[k];
        }
        if (typeof result === 'function') {
            return result(...args);
        }
        return result || key;
    }, [language]);

    useEffect(() => {
        const root = document.documentElement;
        root.dataset.theme = resolvedTheme;
        root.dataset.lang = language === 'zho' ? 'zh' : 'en';
        root.style.setProperty('--ui-bg-color', themePalette.uiBgColor);
        root.style.setProperty('--button-bg-color', themePalette.buttonBgColor);
        document.body.style.backgroundColor = themePalette.appBackground;
    }, [language, resolvedTheme, themePalette]);

    // (updateActiveBoard, setElements, commitAction moved up before useCanvasInteraction)

    const handleUndo = useCallback(() => {
        updateActiveBoard(board => {
            if (board.historyIndex > 0) {
                return { ...board, historyIndex: board.historyIndex - 1, elements: board.history[board.historyIndex - 1] };
            }
            return board;
        });
    }, [activeBoardId]);

    const handleRedo = useCallback(() => {
        updateActiveBoard(board => {
            if (board.historyIndex < board.history.length - 1) {
                return { ...board, historyIndex: board.historyIndex + 1, elements: board.history[board.historyIndex + 1] };
            }
            return board;
        });
    }, [activeBoardId]);

    // Handle drop from AssetLibraryPanel (after commitAction and getCanvasCenter are defined)
    const handleAssetDropRef = useRef<((e: React.DragEvent) => void) | null>(null);
    handleAssetDropRef.current = (e: React.DragEvent) => {
        const payload = e.dataTransfer.getData('text/plain');
        try {
            const parsed = JSON.parse(payload);
            if (parsed?.__makingAsset && parsed.item) {
                const item: AssetItem = parsed.item as AssetItem;
                const canvasPoint = screenToCanvas(e.clientX, e.clientY);
                const img = new Image();
                img.onload = () => {
                    const newImage: ImageElement = {
                        id: generateId(),
                        type: 'image',
                        name: item.name || 'Asset',
                        x: canvasPoint.x - img.width / 2,
                        y: canvasPoint.y - img.height / 2,
                        width: img.width,
                        height: img.height,
                        href: item.dataUrl,
                        mimeType: item.mimeType,
                    };
                    commitAction(prev => [...prev, newImage]);
                    setSelectedElementIds([newImage.id]);
                    setActiveTool('select');
                };
                img.src = item.dataUrl;
            }
        } catch {}
    };

    const handleDeleteSelection = useCallback(() => {
        if (selectedElementIds.length === 0) return;
        commitAction(prev => {
            const idsToDelete = new Set<string>(selectedElementIds);
            selectedElementIds.forEach(id => {
                getDescendants(id, prev).forEach(desc => idsToDelete.add(desc.id));
            });
            return prev.filter(el => !idsToDelete.has(el.id));
        });
        setSelectedElementIds([]);
    }, [selectedElementIds, commitAction, getDescendants]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); handleUndo(); return; }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); handleRedo(); return; }
            
            if (!isTyping && (e.key === 'Delete' || e.key === 'Backspace') && selectedElementIds.length > 0) {
                e.preventDefault();
                commitAction(prev => {
                    const idsToDelete = new Set(selectedElementIds);
                    selectedElementIds.forEach(id => {
                        getDescendants(id, prev).forEach(desc => idsToDelete.add(desc.id));
                    });
                    return prev.filter(el => !idsToDelete.has(el.id));
                });
                setSelectedElementIds([]);
                return;
            }

            if (e.key === ' ' && !isTyping) {
                e.preventDefault();
                if (spacebarDownTime.current === null) {
                    spacebarDownTime.current = Date.now();
                    previousToolRef.current = activeTool;
                    setActiveTool('pan');
                }
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === ' ') {
                const target = e.target as HTMLElement;
                const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
                if (isTyping || spacebarDownTime.current === null) return;
                
                e.preventDefault();

                const duration = Date.now() - spacebarDownTime.current;
                spacebarDownTime.current = null;
                
                const toolBeforePan = previousToolRef.current;

                if (duration < 200) { // Tap
                    if (toolBeforePan === 'pan') {
                        setActiveTool('select');
                    } else if (toolBeforePan === 'select') {
                        setActiveTool('pan');
                    } else {
                        setActiveTool('select');
                    }
                } else { // Hold
                    setActiveTool(toolBeforePan);
                }
            }
        };


        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [handleUndo, handleRedo, selectedElementIds, activeTool, commitAction, getDescendants]);
    

    const handleAddImageElement = useCallback(async (file: File) => {
        if (detectMediaType(file) !== 'image') {
            setError('仅支持图片文件。');
            return;
        }
        setError(null);
        try {
            const { dataUrl, mimeType, width, height, resized } = await validateAndResizeImage(file);
            if (resized) {
                toast.show(`图片尺寸过大，已自动缩小到 ${width}x${height}。`, 'warning');
            }
            const canvasPoint = getCanvasCenter();

            const newImage: ImageElement = {
                id: generateId(),
                type: 'image',
                name: file.name,
                x: canvasPoint.x - (width / 2),
                y: canvasPoint.y - (height / 2),
                width,
                height,
                href: dataUrl,
                mimeType: mimeType,
            };
            setElements(prev => [...prev, newImage]);
            setSelectedElementIds([newImage.id]);
            setActiveTool('select');
        } catch (err) {
            const message = err instanceof Error ? err.message : '图片加载失败。';
            setError(message);
            console.error(err);
        }
    }, [getCanvasCenter, activeBoardId, setElements]);

    const readLocalVideoMetadata = useCallback((href: string): Promise<{ width: number; height: number; durationSec?: number }> => (
        new Promise((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.onloadedmetadata = () => {
                resolve({
                    width: video.videoWidth || 960,
                    height: video.videoHeight || 540,
                    durationSec: Number.isFinite(video.duration) ? video.duration : undefined,
                });
            };
            video.onerror = () => resolve({ width: 960, height: 540 });
            video.src = href;
        })
    ), []);

    const handleAddVideoElement = useCallback(async (file: File) => {
        if (detectMediaType(file) !== 'video') {
            setError('仅支持视频文件。');
            return;
        }
        setError(null);
        try {
            const href = URL.createObjectURL(file);
            const metadata = await readLocalVideoMetadata(href);
            const maxWidth = 960;
            const scale = metadata.width > maxWidth ? maxWidth / metadata.width : 1;
            const width = Math.max(160, Math.round(metadata.width * scale));
            const height = Math.max(90, Math.round(metadata.height * scale));
            const canvasPoint = getCanvasCenter();
            const newVideo: VideoElement = {
                id: generateId(),
                type: 'video',
                name: file.name,
                x: canvasPoint.x - width / 2,
                y: canvasPoint.y - height / 2,
                width,
                height,
                href,
                mimeType: resolveMimeType(file) || 'video/mp4',
                durationSec: metadata.durationSec,
            };
            setElements(prev => [...prev, newVideo]);
            setSelectedElementIds([newVideo.id]);
            setActiveTool('select');
        } catch (err) {
            const message = err instanceof Error ? err.message : '视频加载失败。';
            setError(message);
            console.error(err);
        }
    }, [getCanvasCenter, readLocalVideoMetadata, setElements]);

    const handleAddMediaElement = useCallback((file: File) => {
        const mediaType = detectMediaType(file);
        if (mediaType === 'video') {
            void handleAddVideoElement(file);
            return;
        }
        if (mediaType === 'audio') {
            setError('暂不支持在画布上添加音频文件，请在 PromptBar 中添加。');
            return;
        }
        void handleAddImageElement(file);
    }, [handleAddImageElement, handleAddVideoElement]);

    // Chrome Extension bridge: pick up pending images/prompts sent from context menu or popup
    useEffect(() => {
        if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
        chrome.storage.local.get(['flovart_pending_image', 'flovart_pending_prompt', 'flovart_collected_images'], (result) => {
            // Pending single image 鈫?add to canvas
            if (result.flovart_pending_image) {
                const { dataUrl, name } = result.flovart_pending_image;
                if (dataUrl) {
                    const img = new Image();
                    img.onload = () => {
                        const newImage: ImageElement = {
                            id: generateId(),
                            type: 'image',
                            name: name || 'Extension Image',
                            x: 100,
                            y: 100,
                            width: Math.min(img.width, 1440),
                            height: Math.min(img.height, 1080),
                            href: dataUrl,
                            mimeType: 'image/png',
                        };
                        setElements(prev => [...prev, newImage]);
                        setSelectedElementIds([newImage.id]);
                    };
                    img.src = dataUrl;
                }
                chrome.storage.local.remove('flovart_pending_image');
            }
            // Pending prompt 鈫?fill prompt bar
            if (result.flovart_pending_prompt) {
                const { prompt: pendingPrompt } = result.flovart_pending_prompt;
                if (pendingPrompt) setPrompt(pendingPrompt);
                chrome.storage.local.remove('flovart_pending_prompt');
            }
            // Collected images are available for the inspiration panel 鈥?stored for future use
            if (result.flovart_collected_images) {
                chrome.storage.local.remove('flovart_collected_images');
            }
        });
    }, []);

    

    


    const handleDeleteElement = (id: string) => {
        commitAction(prev => {
            const idsToDelete = new Set([id]);
            getDescendants(id, prev).forEach(desc => idsToDelete.add(desc.id));
            return prev.filter(el => !idsToDelete.has(el.id));
        });
        setSelectedElementIds(prev => prev.filter(selId => selId !== id));
    };

    const handleGroupSelection = () => {
        if (selectedElementIds.length < 2) return;
        commitAction(prev => {
            const groupId = generateId();
            const groupEl: GroupElement = {
                id: groupId,
                type: 'group',
                name: `Group ${prev.filter(e => e.type === 'group').length + 1}`,
                childIds: [...selectedElementIds],
            };
            return [...prev, groupEl];
        });
    };

    const handleExportSelection = () => {
        const selected = elements.filter(el => selectedElementIds.includes(el.id) && (el.type === 'image' || el.type === 'video'));
        selected.forEach(el => {
            const href = (el as { href?: string }).href;
            if (!href) return;
            const name = el.name || el.id;
            const a = document.createElement('a');
            a.href = href;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    };

    const handleCopyElement = (elementToCopy: Element) => {
        commitAction(prev => {
            const elementsToCopy = [elementToCopy, ...getDescendants(elementToCopy.id, prev)];
            const idMap = new Map<string, string>();
            
// FIX: Refactored element creation to use explicit switch cases for each element type.
// This helps TypeScript correctly infer the return type of the map function as Element[],
// preventing type errors caused by spreading a discriminated union.
            const newElements: Element[] = elementsToCopy.map((el): Element => {
                const newId = generateId();
                idMap.set(el.id, newId);
                const dx = 20 / zoom;
                const dy = 20 / zoom;

                switch (el.type) {
                    case 'path':
                        return { ...el, id: newId, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
                    case 'arrow':
                        return { ...el, id: newId, points: [{ x: el.points[0].x + dx, y: el.points[0].y + dy }, { x: el.points[1].x + dx, y: el.points[1].y + dy }] as [Point, Point] };
                    case 'line':
                         return { ...el, id: newId, points: [{ x: el.points[0].x + dx, y: el.points[0].y + dy }, { x: el.points[1].x + dx, y: el.points[1].y + dy }] as [Point, Point] };
                    case 'image':
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                    case 'shape':
                         return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                    case 'text':
                         return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                    case 'group':
                         return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                    case 'video':
                        return { ...el, id: newId, x: el.x + dx, y: el.y + dy };
                }
            });
            
// FIX: Refactored parentId assignment to use an explicit switch statement.
// This ensures TypeScript can correctly track the types within the Element union
// and avoids errors when returning the new array of elements.
            const finalNewElements: Element[] = newElements.map((el): Element => {
                const parentId = el.parentId ? idMap.get(el.parentId) : undefined;
                switch (el.type) {
                    case 'image': return { ...el, parentId };
                    case 'path': return { ...el, parentId };
                    case 'shape': return { ...el, parentId };
                    case 'text': return { ...el, parentId };
                    case 'arrow': return { ...el, parentId };
                    case 'line': return { ...el, parentId };
                    case 'group': return { ...el, parentId };
                    case 'video': return { ...el, parentId };
                }
            });
            
            setSelectedElementIds([idMap.get(elementToCopy.id)!]);
            return [...prev, ...finalNewElements];
        });
    };
    
     const handleDownloadImage = (element: ImageElement) => {
        const link = document.createElement('a');
        link.href = element.href;
        link.download = `canvas-image-${element.id}.${element.mimeType.split('/')[1] || 'png'}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
     };

    const handleExportSelectedMedia = async () => {
        const media = elementsRef.current.filter((element): element is ImageElement | VideoElement => (
            selectedElementIds.includes(element.id) && (element.type === 'image' || element.type === 'video')
        ));
        if (!media.length) {
            toast.show('所选内容中没有可导出的图片或视频。', 'warning');
            return;
        }
        try {
            const count = await exportMediaArchive(media.map(element => ({
                id: element.id,
                x: element.x,
                y: element.y,
                name: element.name || (element.type === 'video' ? '视频' : '图片'),
                mimeType: element.mimeType,
                loadBlob: async () => {
                    if (element.type === 'video' && isIdbVideoRef(element.href)) {
                        const blob = await getVideoBlob(fromIdbVideoRef(element.href));
                        if (!blob) throw new Error(`无法读取视频：${element.name || element.id}`);
                        return blob;
                    }
                    let href = element.href;
                    if (element.type === 'image' && isIdbRef(href)) {
                        const key = fromIdbRef(href);
                        href = (await getImages([key])).get(key) || '';
                    }
                    href = await resolveColdMediaRef(href);
                    if (!href) throw new Error(`无法读取媒体：${element.name || element.id}`);
                    const response = await fetch(href);
                    if (!response.ok) throw new Error(`导出媒体失败：${element.name || element.id}`);
                    return response.blob();
                },
            })), `Flovart-Canvas-${new Date().toISOString().slice(0, 10)}`);
            toast.show(`已按画布顺序导出 ${count} 个媒体文件。`, 'success');
        } catch (exportError) {
            toast.show(exportError instanceof Error ? exportError.message : '批量导出失败。', 'error');
        }
    };

    const [reversePromptLoading, setReversePromptLoading] = useState(false);
    const reversePromptAbortRef = useRef<AbortController | null>(null);

    const handleReversePrompt = async (imageHref: string, mimeType: string, imgWidth?: number, imgHeight?: number) => {
        const textProvider = inferProviderFromModel(modelPreference.textModel);
        const key = getPreferredApiKey('text', textProvider);
        if (!key) {
            setError('请先配置支持视觉能力的文本模型 API Key（如 Gemini、GPT-5.4、Claude）。');
            return;
        }
        // Cancel any in-progress request
        reversePromptAbortRef.current?.abort();
        const abortCtrl = new AbortController();
        reversePromptAbortRef.current = abortCtrl;

        setReversePromptLoading(true);
        setPrompt('');
        setProgressMessage(language === 'zho' ? '姝ｅ湪鍒嗘瀽鍥剧墖...' : 'Analyzing image...');

        // Stream buffer: after each chunk, flush at ~60ms interval to reduce React re-render frequency
        let chunkBuffer = '';
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        let firstChunkReceived = false;
        const flushBuffer = () => {
            if (chunkBuffer) {
                const text = chunkBuffer;
                chunkBuffer = '';
                setPrompt(prev => prev + text);
            }
            flushTimer = null;
        };
        const onChunk = (chunk: string) => {
            if (!firstChunkReceived) {
                firstChunkReceived = true;
                setProgressMessage(language === 'zho' ? '姝ｅ湪鐢熸垚...' : 'Generating...');
            }
            chunkBuffer += chunk;
            if (!flushTimer) {
                flushTimer = setTimeout(flushBuffer, 60);
            }
        };

        let partialReceived = false;
        try {
            const result = await reversePromptStreamWithProvider(
                imageHref,
                mimeType,
                modelPreference.textModel,
                key,
                (chunk) => { partialReceived = true; onChunk(chunk); },
                abortCtrl.signal,
                language,
                imgWidth && imgHeight ? { width: imgWidth, height: imgHeight } : undefined,
            );
            // flush 鍓╀綑缂撳啿
            if (flushTimer) { clearTimeout(flushTimer); flushBuffer(); }
            if (!result && !abortCtrl.signal.aborted) {
                setError(language === 'zho' ? '反推 Prompt 未返回结果，请重试。' : 'Reverse prompt returned no result. Please retry.');
            }
            setProgressMessage('');
        } catch (err) {
            if (flushTimer) { clearTimeout(flushTimer); flushBuffer(); }
            if ((err as Error).name === 'AbortError') return; // 鐢ㄦ埛鍙栨秷
            // Network interrupted with partial content - append visual warning
            if (partialReceived) {
                setPrompt(prev => prev + (language === 'zho' ? '⚠️ [传输中断，内容不完整]' : '\n鈿狅笍 [Stream interrupted, content incomplete]'));
            }
            setError(`${language === 'zho' ? '鍙嶆帹 Prompt 澶辫触' : 'Reverse prompt failed'}: ${(err as Error).message}`);
        } finally {
            if (reversePromptAbortRef.current === abortCtrl) {
                reversePromptAbortRef.current = null;
            }
            setReversePromptLoading(false);
            setProgressMessage('');
        }
    };

    const handleWorkflowReversePrompt = async (imageHref: string, mimeType: string, imgWidth?: number, imgHeight?: number): Promise<string> => {
        const textProvider = inferProviderFromModel(modelPreference.textModel);
        const key = getPreferredApiKey('text', textProvider);
        if (!key) throw new Error('请先配置支持视觉能力的文本模型 API Key。');
        let providerHref = imageHref;
        if (!providerHref.startsWith('data:')) {
            const blob = await loadWorkflowMediaBlob(undefined, providerHref);
            providerHref = (await fileToDataUrl(new File([blob], 'workflow-image', { type: blob.type || mimeType }))).dataUrl;
        }
        return reversePromptStreamWithProvider(
            providerHref,
            mimeType,
            modelPreference.textModel,
            key,
            () => {},
            undefined,
            language,
            imgWidth && imgHeight ? { width: imgWidth, height: imgHeight } : undefined,
        );
    };

    const cancelReversePrompt = () => {
        reversePromptAbortRef.current?.abort();
        reversePromptAbortRef.current = null;
        setReversePromptLoading(false);
        setProgressMessage('');
    };









    const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

    // Capture-phase handler: intercept media files and asset drops BEFORE Excalidraw sees them.
    // Excalidraw's internal drop handler rejects video files with "Couldn't load invalid file".
    const handleDragOverCapture = useCallback((e: React.DragEvent) => {
        const items = e.dataTransfer.items;
        if (items && Array.from(items).some(item => item.kind === 'file')) {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            return;
        }
        if (e.dataTransfer.types?.includes('text/plain')) {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        }
    }, []);

    const handleDropCapture = useCallback((e: React.DragEvent) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (detectMediaType(file)) {
                    handleAddMediaElement(file);
                }
            }
            return;
        }
        const text = e.dataTransfer.getData('text/plain');
        if (text && handleAssetDropRef.current) {
            e.preventDefault();
            e.stopPropagation();
            handleAssetDropRef.current(e);
        }
    }, [handleAddMediaElement]);

    const handleDrop = useCallback((e: React.DragEvent) => { 
        e.preventDefault(); 
        const text = e.dataTransfer.getData('text/plain');
        if (text && handleAssetDropRef.current) { handleAssetDropRef.current(e); return; }
        if (e.dataTransfer.files && e.dataTransfer.files[0]) { handleAddMediaElement(e.dataTransfer.files[0]); }
    }, [handleAddMediaElement]);

    const handlePropertyChange = (elementId: string, updates: Partial<Element>) => {
        commitAction(prev => prev.map(el => {
            if (el.id === elementId) {
                 return { ...el, ...updates } as Element;
            }
            return el;
        }));
    };

     const handleLayerAction = (elementId: string, action: 'front' | 'back' | 'forward' | 'backward') => {
        commitAction(prev => {
            const elementsCopy = [...prev];
            const index = elementsCopy.findIndex(el => el.id === elementId);
            if (index === -1) return elementsCopy;

            const [element] = elementsCopy.splice(index, 1);

            if (action === 'front') {
                elementsCopy.push(element);
            } else if (action === 'back') {
                elementsCopy.unshift(element);
            } else if (action === 'forward') {
                const newIndex = Math.min(elementsCopy.length, index + 1);
                elementsCopy.splice(newIndex, 0, element);
            } else if (action === 'backward') {
                const newIndex = Math.max(0, index - 1);
                elementsCopy.splice(newIndex, 0, element);
            }
            return elementsCopy;
        });
    };

    const handleRasterizeSelection = async () => {
        const elementsToRasterize = elements.filter(
            el => selectedElementIds.includes(el.id) && el.type !== 'image' && el.type !== 'video'
        ) as Exclude<Element, ImageElement | VideoElement>[];

        if (elementsToRasterize.length === 0) return;

        setIsLoading(true);
        setError(null);

        try {
            let minX = Infinity, minY = Infinity;
            elementsToRasterize.forEach(element => {
                const bounds = getElementBounds(element);
                minX = Math.min(minX, bounds.x);
                minY = Math.min(minY, bounds.y);
            });
            
            const { href, mimeType, width, height } = await rasterizeElements(elementsToRasterize);
            
            const newImage: ImageElement = {
                id: generateId(),
                type: 'image', name: 'Rasterized Image',
                x: minX - 10, // Account for padding used during rasterization
                y: minY - 10, // Account for padding
                width,
                height,
                href,
                mimeType
            };

            const idsToRemove = new Set(elementsToRasterize.map(el => el.id));

            commitAction(prev => {
                const remainingElements = prev.filter(el => !idsToRemove.has(el.id));
                return [...remainingElements, newImage];
            });

            setSelectedElementIds([newImage.id]);

        } catch (err) {
            const error = err as Error;
            setError(`Failed to rasterize selection: ${error.message}`);
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGroup = () => {
        const selectedElements = elements.filter(el => selectedElementIds.includes(el.id));
        if (selectedElements.length < 2) return;
        
        const bounds = getSelectionBounds(selectedElementIds);
        const newGroupId = generateId();

        const newGroup: GroupElement = {
            id: newGroupId,
            type: 'group',
            name: 'Group',
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        };

        commitAction(prev => {
            const updatedElements = prev.map(el => 
                selectedElementIds.includes(el.id) ? { ...el, parentId: newGroupId } : el
            );
            return [...updatedElements, newGroup];
        });

        setSelectedElementIds([newGroupId]);
    };

    const handleUngroup = () => {
        if (selectedElementIds.length !== 1) return;
        const groupId = selectedElementIds[0];
        const group = elements.find(el => el.id === groupId);
        if (!group || group.type !== 'group') return;

        const childrenIds: string[] = [];
        commitAction(prev => {
            return prev.map(el => {
                if (el.parentId === groupId) {
                    childrenIds.push(el.id);
                    return { ...el, parentId: undefined };
                }
                return el;
            }).filter(el => el.id !== groupId);
        });

        setSelectedElementIds(childrenIds);
    };


    // 鈹€鈹€ Phase 2: Expose runtime API for AI Agent control 鈹€鈹€
    useEffect(() => {
        const normalizeApiElement = (partial: Partial<Element>): Element => {
            const base = {
                id: partial.id || crypto.randomUUID(),
                x: typeof partial.x === 'number' ? partial.x : 0,
                y: typeof partial.y === 'number' ? partial.y : 0,
                name: partial.name,
                isVisible: partial.isVisible ?? true,
                isLocked: partial.isLocked ?? false,
                parentId: partial.parentId,
            };

            switch (partial.type) {
                case 'image':
                    return {
                        ...base,
                        type: 'image',
                        href: partial.href || '',
                        mimeType: partial.mimeType || 'image/png',
                        width: typeof partial.width === 'number' ? partial.width : 200,
                        height: typeof partial.height === 'number' ? partial.height : 200,
                        borderRadius: partial.borderRadius,
                        filters: partial.filters,
                        mask: partial.mask,
                    };
                case 'text':
                    return {
                        ...base,
                        type: 'text',
                        text: partial.text || '',
                        fontSize: typeof partial.fontSize === 'number' ? partial.fontSize : 28,
                        fontColor: partial.fontColor || '#111827',
                        width: typeof partial.width === 'number' ? partial.width : 260,
                        height: typeof partial.height === 'number' ? partial.height : 120,
                    };
                case 'shape':
                    return {
                        ...base,
                        type: 'shape',
                        shapeType: partial.shapeType || 'rectangle',
                        width: typeof partial.width === 'number' ? partial.width : 200,
                        height: typeof partial.height === 'number' ? partial.height : 200,
                        strokeColor: partial.strokeColor || '#111827',
                        strokeWidth: typeof partial.strokeWidth === 'number' ? partial.strokeWidth : 2,
                        fillColor: partial.fillColor || '#6366f1',
                        borderRadius: partial.borderRadius,
                        strokeDashArray: partial.strokeDashArray,
                    };
                case 'path':
                    return {
                        ...base,
                        type: 'path',
                        points: partial.points || [],
                        strokeColor: partial.strokeColor || '#111827',
                        strokeWidth: typeof partial.strokeWidth === 'number' ? partial.strokeWidth : 4,
                        strokeOpacity: partial.strokeOpacity,
                    };
                case 'arrow':
                    return {
                        ...base,
                        type: 'arrow',
                        points: partial.points || [{ x: base.x, y: base.y }, { x: base.x + 120, y: base.y }],
                        strokeColor: partial.strokeColor || '#111827',
                        strokeWidth: typeof partial.strokeWidth === 'number' ? partial.strokeWidth : 4,
                    };
                case 'line':
                    return {
                        ...base,
                        type: 'line',
                        points: partial.points || [{ x: base.x, y: base.y }, { x: base.x + 120, y: base.y }],
                        strokeColor: partial.strokeColor || '#111827',
                        strokeWidth: typeof partial.strokeWidth === 'number' ? partial.strokeWidth : 4,
                    };
                case 'group':
                    return {
                        ...base,
                        type: 'group',
                        width: typeof partial.width === 'number' ? partial.width : 1,
                        height: typeof partial.height === 'number' ? partial.height : 1,
                    };
                case 'video':
                    return {
                        ...base,
                        type: 'video',
                        href: partial.href || '',
                        mimeType: partial.mimeType || 'video/mp4',
                        width: typeof partial.width === 'number' ? partial.width : 320,
                        height: typeof partial.height === 'number' ? partial.height : 180,
                    };
                default:
                    return {
                        ...base,
                        type: 'shape',
                        shapeType: 'rectangle',
                        width: 200,
                        height: 200,
                        strokeColor: '#111827',
                        strokeWidth: 2,
                        fillColor: '#6366f1',
                    };
            }
        };

        const toRuntimeError = (err: unknown): RuntimeError => {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('TIMEOUT')) {
                return { code: 'TIMEOUT', message };
            }
            if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
                return { code: 'RATE_LIMITED', message };
            }
            if (message.includes('413') || message.toLowerCase().includes('payload too large')) {
                return { code: 'PAYLOAD_TOO_LARGE', message };
            }
            if (message.includes('401') || message.includes('403')) {
                return { code: 'UNAUTHORIZED', message };
            }
            return { code: 'INTERNAL_ERROR', message };
        };

        const withTimeout = async <T,>(job: Promise<T>, timeoutMs: number): Promise<T> => {
            return await new Promise<T>((resolve, reject) => {
                const timer = window.setTimeout(() => reject(new Error('TIMEOUT: command execution exceeded timeoutMs')), timeoutMs);
                job
                    .then((value) => {
                        window.clearTimeout(timer);
                        resolve(value);
                    })
                    .catch((error) => {
                        window.clearTimeout(timer);
                        reject(error);
                    });
            });
        };

        const getJobSnapshot = (job: RuntimeJob) => ({
            requestId: job.requestId,
            sessionId: job.sessionId,
            jobId: job.jobId,
            status: job.status,
            progress: job.progress,
            result: job.result,
            error: job.error,
            updatedAt: job.updatedAt,
            command: job.command,
        });

        const getRuntimeProviderStatus = () => ({
            ok: true,
            configured: {
                image: !!getPreferredApiKey('image'),
                video: !!getPreferredApiKey('video'),
                text: !!getPreferredApiKey('text'),
            },
            selectedModels: {
                image: modelPreference.imageModel,
                video: modelPreference.videoModel,
                text: modelPreference.textModel,
            },
            availableModels: dynamicModelOptions,
            providers: userApiKeys.map(key => ({
                id: key.id,
                name: key.name,
                provider: key.provider,
                capabilities: key.capabilities,
                isDefault: key.isDefault,
                hasKey: !!key.key,
            })),
        });

        const listMediaElements = () => api.canvas.getElements().filter((el: any) => el.type === 'image' || el.type === 'video');

        const addMediaElement = (partial: Partial<ImageElement | VideoElement>, type: 'image' | 'video') => {
            const center = getCanvasCenter();
            const width = Number(partial.width) || (type === 'image' ? 1024 : 960);
            const height = Number(partial.height) || (type === 'image' ? 576 : 540);
            const next = {
                ...partial,
                id: generateId(),
                type,
                name: partial.name || (type === 'image' ? 'Agent Image' : 'Agent Video'),
                x: typeof partial.x === 'number' ? partial.x : center.x - width / 2,
                y: typeof partial.y === 'number' ? partial.y : center.y - height / 2,
                width,
                height,
                mimeType: partial.mimeType || (type === 'image' ? 'image/png' : 'video/mp4'),
            } as ImageElement | VideoElement;
            commitAction(prev => [...prev, next]);
            setSelectedElementIds([next.id]);
            return { ok: true, id: next.id, element: next };
        };

        const inspectCanvasState = () => ({
            ok: true,
            selectedElementIds: [...selectedElementIds],
            zoom,
            panOffset: { ...panOffset },
            elements: api.canvas.getElements(),
            media: listMediaElements(),
        });

        const createAtomicElement = (input: {
            id?: string;
            type: 'image' | 'video' | 'text';
            name: string;
            x: number;
            y: number;
            width?: number;
            height?: number;
            href?: string;
            mimeType?: string;
        }) => {
            if (input.type === 'image' || input.type === 'video') {
                return addMediaElement({
                    id: input.id,
                    name: input.name,
                    x: input.x,
                    y: input.y,
                    width: input.width,
                    height: input.height,
                    href: input.href,
                    mimeType: input.mimeType,
                }, input.type);
            }

            const next: TextElement = {
                id: input.id || generateId(),
                type: 'text',
                name: input.name,
                text: '',
                x: input.x,
                y: input.y,
                width: input.width || 220,
                height: input.height || 96,
                fontSize: 24,
                fontColor: resolvedTheme === 'dark' ? '#F8FAFC' : '#111827',
            };
            commitAction(prev => [...prev, next]);
            setSelectedElementIds([next.id]);
            return { ok: true, id: next.id, element: next };
        };

        const updateAtomicPrompt = (input: { elementId: string; textPrompt: string; modelId?: string }) => {
            const target = elementsRef.current.find(item => item.id === input.elementId);
            if (!target || (target.type !== 'image' && target.type !== 'video')) {
                throw new Error(`BAD_REQUEST: media element not found (${input.elementId})`);
            }

            const canvasElements = elementsRef.current.filter((item): item is CanvasElement => (
                item.type === 'image' || item.type === 'video' || item.type === 'text' || item.type === 'shape'
            ));
            const hydrated = hydrateRawTextToTiptapJSON(input.textPrompt, canvasElements);
            const nextGenerationState: ElementGenerationState = {
                promptPayload: {
                    ...compilePromptReferences(input.textPrompt, canvasElements),
                    richTextDocument: hydrated.json,
                },
                provider: target.generationState?.provider || 'openrouter',
                modelId: input.modelId || target.generationState?.modelId || (target.type === 'video' ? modelPreference.videoModel : modelPreference.imageModel),
                status: target.generationState?.status || 'idle',
                error: undefined,
                progress: target.generationState?.progress,
            };

            updateElementGenerationState(input.elementId, nextGenerationState);
            return { ok: true, elementId: input.elementId, generationState: nextGenerationState };
        };

        const assignAtomicSlot = (input: { elementId: string; targetElementId: string; slotRole: 'first_frame' | 'style_ref' | 'control_net' | 'unassigned' }) => {
            const target = elementsRef.current.find(item => item.id === input.elementId);
            const source = elementsRef.current.find(item => item.id === input.targetElementId);
            if (!target || (target.type !== 'image' && target.type !== 'video')) {
                throw new Error(`BAD_REQUEST: target media element not found (${input.elementId})`);
            }
            if (!source || (source.type !== 'image' && source.type !== 'video' && source.type !== 'text' && source.type !== 'shape')) {
                throw new Error(`BAD_REQUEST: source element not found (${input.targetElementId})`);
            }

            const token = `@${source.name || source.id}`;
            const currentState = target.generationState || {
                promptPayload: { rawText: '', resolvedReferences: [] },
                provider: 'openrouter' as const,
                modelId: target.type === 'video' ? modelPreference.videoModel : modelPreference.imageModel,
                status: 'idle' as const,
            };
            const existing = currentState.promptPayload.resolvedReferences.filter(reference => reference.targetElementId !== source.id);
            const targetType = source.type === 'image' || source.type === 'video' ? source.type : 'text';
            const nextRawText = currentState.promptPayload.rawText.includes(token)
                ? currentState.promptPayload.rawText
                : `${currentState.promptPayload.rawText}${currentState.promptPayload.rawText ? '\n' : ''}${token}`;
            const canvasElements = elementsRef.current.filter((item): item is CanvasElement => (
                item.type === 'image' || item.type === 'video' || item.type === 'text' || item.type === 'shape'
            ));
            const hydrated = hydrateRawTextToTiptapJSON(nextRawText, canvasElements);
            const nextGenerationState: ElementGenerationState = {
                ...currentState,
                promptPayload: {
                    rawText: nextRawText,
                    resolvedReferences: [...existing, {
                        token,
                        targetElementId: source.id,
                        targetType,
                        slotRole: input.slotRole,
                    }],
                    richTextDocument: hydrated.json,
                },
            };

            updateElementGenerationState(input.elementId, nextGenerationState);
            return { ok: true, elementId: input.elementId, targetElementId: input.targetElementId, slotRole: input.slotRole };
        };

        const igniteAtomicElement = async (input: { elementId: string }) => {
            const target = elementsRef.current.find(item => item.id === input.elementId);
            if (!target || (target.type !== 'image' && target.type !== 'video')) {
                throw new Error(`BAD_REQUEST: media element not found (${input.elementId})`);
            }

            setSelectedElementIds([target.id]);

            const now = Date.now();
            const sessionId = `inline-${target.id}`;
            if (!runtimeSessionsRef.current[sessionId]) {
                runtimeSessionsRef.current[sessionId] = {
                    id: sessionId,
                    name: 'atomic-inline',
                    createdAt: now,
                    lastActiveAt: now,
                    idempotencyMap: {},
                    jobIds: [],
                };
            }
            const jobId = `ignite-${target.id}-${now}`;
            runtimeJobsRef.current[jobId] = {
                requestId: jobId,
                sessionId,
                jobId,
                command: 'element.ignite',
                args: input,
                status: 'accepted',
                progress: { pct: 8, stage: 'queued' },
                source: 'agent',
                timeoutMs: 120000,
                createdAt: now,
                updatedAt: now,
            };
            runtimeSessionsRef.current[sessionId].jobIds.push(jobId);

            const currentState = target.generationState || {
                promptPayload: { rawText: '', resolvedReferences: [] },
                provider: 'openrouter' as const,
                modelId: target.type === 'video' ? modelPreference.videoModel : modelPreference.imageModel,
                status: 'idle' as const,
            };
            updateElementGenerationState(target.id, {
                ...currentState,
                status: 'queued',
                progress: 8,
                error: undefined,
            });

            window.setTimeout(() => {
                const latestTarget = elementsRef.current.find(item => item.id === input.elementId);
                if (!latestTarget || (latestTarget.type !== 'image' && latestTarget.type !== 'video')) return;

                runtimeJobsRef.current[jobId].status = 'running';
                runtimeJobsRef.current[jobId].progress = { pct: 12, stage: 'running' };
                runtimeJobsRef.current[jobId].updatedAt = Date.now();

                const latestState = latestTarget.generationState || currentState;
                updateElementGenerationState(latestTarget.id, {
                    ...latestState,
                    status: 'running',
                    progress: Math.max(12, latestState.progress || 0),
                    error: undefined,
                });

                const run = latestTarget.type === 'video'
                    ? api.generate.video({
                        prompt: latestTarget.generationState?.promptPayload.rawText || '',
                        sourceImageIds: (latestTarget.generationState?.promptPayload.resolvedReferences || [])
                            .filter(reference => reference.slotRole === 'first_frame')
                            .map(reference => reference.targetElementId),
                        aspectRatio: videoAspectRatio,
                    })
                    : api.generate.image({
                        prompt: latestTarget.generationState?.promptPayload.rawText || '',
                        name: latestTarget.name,
                    });

                run.then((result) => {
                    runtimeJobsRef.current[jobId].status = 'succeeded';
                    runtimeJobsRef.current[jobId].progress = { pct: 100, stage: 'completed' };
                    runtimeJobsRef.current[jobId].result = result;
                    runtimeJobsRef.current[jobId].updatedAt = Date.now();
                }).catch((error) => {
                    runtimeJobsRef.current[jobId].status = 'failed';
                    runtimeJobsRef.current[jobId].progress = { pct: runtimeJobsRef.current[jobId].progress.pct, stage: 'failed' };
                    runtimeJobsRef.current[jobId].error = toRuntimeError(error);
                    runtimeJobsRef.current[jobId].updatedAt = Date.now();
                    const failedTarget = elementsRef.current.find(item => item.id === input.elementId);
                    if (failedTarget?.type === 'image' || failedTarget?.type === 'video') {
                        updateElementGenerationState(failedTarget.id, {
                            ...(failedTarget.generationState || currentState),
                            status: 'error',
                            error: error instanceof Error ? error.message : String(error),
                            progress: undefined,
                        });
                    }
                });
            }, 0);

            return { ok: true, id: target.id, jobId, status: 'queued', accepted: true };
        };

        const watchAtomicElement = async (input: { elementId: string; timeoutMs?: number }) => {
            const timeoutMs = Math.max(1000, Math.min(input.timeoutMs || 120000, 300000));
            const startedAt = Date.now();
            return await new Promise((resolve) => {
                const tick = () => {
                    const target = elementsRef.current.find(item => item.id === input.elementId);
                    if (!target || (target.type !== 'image' && target.type !== 'video')) {
                        resolve({ ok: false, error: { code: 'BAD_REQUEST', message: `media element not found (${input.elementId})` } });
                        return;
                    }

                    const state = target.generationState;
                    if (state?.status === 'success' || state?.status === 'error') {
                        resolve({ ok: state.status === 'success', elementId: target.id, status: state.status, progress: state.progress, error: state.error, element: target });
                        return;
                    }

                    if (Date.now() - startedAt >= timeoutMs) {
                        resolve({ ok: false, elementId: target.id, status: state?.status || 'idle', progress: state?.progress, error: { code: 'WATCH_TIMEOUT', message: `element.watch timed out after ${timeoutMs}ms` } });
                        return;
                    }

                    window.setTimeout(tick, 750);
                };
                tick();
            });
        };

        const resolveRuntimeModelKey = (capability: 'image' | 'video') => {
            const model = capability === 'image' ? modelPreference.imageModel : modelPreference.videoModel;
            const provider = inferProviderFromModel(model);
            const key = getPreferredApiKey(capability, provider);
            if (!key) {
                setIsSettingsPanelOpen(true);
                throw new Error(`UNCONFIGURED_PROVIDER: missing ${capability} API key/model`);
            }
            return { model, key };
        };

        const loadImageSize = (href: string, fallbackWidth = 1024, fallbackHeight = 576) => new Promise<{ width: number; height: number }>((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.naturalWidth || fallbackWidth, height: img.naturalHeight || fallbackHeight });
            img.onerror = () => resolve({ width: fallbackWidth, height: fallbackHeight });
            img.src = href;
        });

        const placeGeneratedImage = async (input: { prompt: string; name?: string; x?: number; y?: number }) => {
            const { model, key } = resolveRuntimeModelKey('image');
            setIsLoading(true);
            setError(null);
            setProgressMessage('Agent image generation...');
            try {
                const result = await generateImageWithProvider(input.prompt, model, key);
                if (!result.newImageBase64 || !result.newImageMimeType) {
                    throw new Error(result.textResponse || 'Image provider did not return an image.');
                }
                const href = `data:${result.newImageMimeType};base64,${result.newImageBase64}`;
                const size = await loadImageSize(href);
                const placed = addMediaElement({
                    type: 'image',
                    href,
                    mimeType: result.newImageMimeType,
                    width: size.width,
                    height: size.height,
                    name: input.name || 'Agent Image',
                    x: input.x,
                    y: input.y,
                }, 'image');
                saveGenerationToHistory({
                    name: input.name || 'Agent Image',
                    dataUrl: href,
                    mimeType: result.newImageMimeType,
                    width: size.width,
                    height: size.height,
                    prompt: input.prompt,
                });
                return { ...placed, prompt: input.prompt, model };
            } finally {
                setIsLoading(false);
                setTimeout(() => setProgressMessage(''), 1500);
            }
        };

        const loadVideoSize = (href: string, fallbackWidth = 960, fallbackHeight = 540) => new Promise<{ width: number; height: number; durationSec?: number }>((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => resolve({
                width: video.videoWidth || fallbackWidth,
                height: video.videoHeight || fallbackHeight,
                durationSec: Number.isFinite(video.duration) ? video.duration : undefined,
            });
            video.onerror = () => resolve({ width: fallbackWidth, height: fallbackHeight });
            video.src = href;
        });

        const placeGeneratedVideo = async (input: {
            prompt: string;
            sourceImageIds?: string[];
            sourceVideoIds?: string[];
            slots?: MultimodalSlot[];
            aspectRatio?: string;
            durationSec?: number;
            resolution?: string;
            seed?: number;
        }) => {
            const { model, key } = resolveRuntimeModelKey('video');
            const sourceImageSlots: MultimodalSlot[] = (input.sourceImageIds || [])
                .map((id, index) => {
                    const source = elementsRef.current.find(el => el.id === id && el.type === 'image') as ImageElement | undefined;
                    return source ? {
                        kind: 'image' as const,
                        href: source.href,
                        mimeType: source.mimeType,
                        role: index === 0 ? 'first_frame' : 'reference_image',
                        label: source.name,
                    } : null;
                })
                .filter((slot): slot is MultimodalSlot => slot !== null);
            const sourceVideoSlots: MultimodalSlot[] = (input.sourceVideoIds || [])
                .map((id) => {
                    const source = elementsRef.current.find(el => el.id === id && el.type === 'video') as VideoElement | undefined;
                    return source ? {
                        kind: 'video' as const,
                        href: source.href,
                        mimeType: source.mimeType,
                        role: 'reference_video',
                        label: source.name,
                    } : null;
                })
                .filter((slot): slot is MultimodalSlot => slot !== null);
            const slots = [
                ...sourceImageSlots,
                ...sourceVideoSlots,
                ...(input.slots || []),
            ];
            const legacyImageRefs = slots
                .filter(slot => slot.kind === 'image')
                .map(slot => ({ href: slot.href, mimeType: slot.mimeType, slotRole: String(slot.role || 'unassigned') }));
            setIsLoading(true);
            setError(null);
            setProgressMessage('Agent video generation...');
            try {
                const result = await generateVideoWithProvider(input.prompt, model, key, {
                    aspectRatio: (input.aspectRatio || videoAspectRatio) as typeof videoAspectRatio,
                    onProgress: message => setProgressMessage(message),
                    references: legacyImageRefs,
                    slots,
                    durationSec: input.durationSec,
                    resolution: input.resolution,
                    seed: input.seed,
                });
                const href = URL.createObjectURL(result.videoBlob);
                const size = await loadVideoSize(href);
                const placed = addMediaElement({
                    type: 'video',
                    href,
                    mimeType: result.mimeType,
                    width: size.width,
                    height: size.height,
                    durationSec: size.durationSec,
                    name: 'Agent Video',
                    sourceKind: 'generation',
                }, 'video');
                return { ...placed, prompt: input.prompt, model, sourceImageIds: input.sourceImageIds || [], sourceVideoIds: input.sourceVideoIds || [] };
            } finally {
                setIsLoading(false);
                setTimeout(() => setProgressMessage(''), 1500);
            }
        };

        const executeRuntimeCommand = async (command: string, args: any): Promise<unknown> => {
            switch (command) {
                case 'canvas.addElement':
                    return api.canvas.addElement(args as Partial<Element>);
                case 'canvas.getElements':
                    return api.canvas.getElements();
                case 'canvas.listMedia':
                    return api.canvas.listMedia();
                case 'canvas.addImage':
                    return api.canvas.addImage(args as Partial<ImageElement>);
                case 'canvas.addVideo':
                    return api.canvas.addVideo(args as Partial<VideoElement>);
                case 'canvas.clearMedia':
                    return api.canvas.clearMedia();
                case 'canvas.removeElement':
                    api.canvas.removeElement(args?.id as string);
                    return { ok: true };
                case 'canvas.remove-element':
                    return api.canvas.removeElement(args?.id as string);
                case 'canvas.updateElement':
                    api.canvas.updateElement(args?.id as string, (args?.updates || {}) as Record<string, unknown>);
                    return { ok: true };
                case 'canvas.update-element':
                    return api.canvas.updateElement(args?.id as string, (args?.updates || args?.updatesJson || {}) as Record<string, unknown>);
                case 'canvas.select':
                    return api.canvas.select(Array.isArray(args?.ids) ? args.ids as string[] : String(args?.ids || '').split(',').filter(Boolean));
                case 'canvas.clear':
                    api.canvas.clear();
                    return { ok: true };
                case 'canvas.inspect':
                    return api.canvas.inspect();
                case 'element.create':
                    return api.element.create(args as Parameters<typeof createAtomicElement>[0]);
                case 'element.update-prompt':
                    return api.element.updatePrompt(args as Parameters<typeof updateAtomicPrompt>[0]);
                case 'element.assign-slot':
                    return api.element.assignSlot(args as Parameters<typeof assignAtomicSlot>[0]);
                case 'element.ignite':
                    return await api.element.ignite(args as Parameters<typeof igniteAtomicElement>[0]);
                case 'element.watch':
                    return await api.element.watch(args as Parameters<typeof watchAtomicElement>[0]);
                case 'generate.image':
                    return api.generate.image(args);
                case 'generate.imagesBatch':
                    return api.generate.imagesBatch(args);
                case 'generate.video':
                    return api.generate.video(args);
                default:
                    throw new Error(`BAD_REQUEST: unknown command ${command}`);
            }
        };

        const sendCommand = async (payload: {
            requestId?: string;
            sessionId: string;
            idempotencyKey?: string;
            command: string;
            args?: unknown;
            meta?: { source?: 'agent' | 'ui' | 'script'; timeoutMs?: number };
        }) => {
            const session = runtimeSessionsRef.current[payload.sessionId];
            if (!session) {
                throw new Error(`BAD_REQUEST: session not found (${payload.sessionId})`);
            }

            const now = Date.now();
            session.lastActiveAt = now;

            if (payload.idempotencyKey && session.idempotencyMap[payload.idempotencyKey]) {
                const existingJob = runtimeJobsRef.current[session.idempotencyMap[payload.idempotencyKey]];
                if (existingJob) return getJobSnapshot(existingJob);
            }

            const requestId = payload.requestId || crypto.randomUUID();
            const jobId = crypto.randomUUID();
            const source = payload.meta?.source || 'agent';
            const timeoutMs = payload.meta?.timeoutMs ?? 60000;

            const job: RuntimeJob = {
                requestId,
                sessionId: session.id,
                jobId,
                command: payload.command,
                args: payload.args,
                status: 'accepted',
                progress: { pct: 0, stage: 'queued' },
                source,
                timeoutMs,
                createdAt: now,
                updatedAt: now,
            };

            runtimeJobsRef.current[jobId] = job;
            session.jobIds.push(jobId);
            if (payload.idempotencyKey) {
                session.idempotencyMap[payload.idempotencyKey] = jobId;
            }

            job.status = 'running';
            job.progress = { pct: 10, stage: 'running' };
            job.updatedAt = Date.now();

            try {
                const result = await withTimeout(executeRuntimeCommand(payload.command, payload.args), timeoutMs);
                job.status = 'succeeded';
                job.progress = { pct: 100, stage: 'completed' };
                job.result = result;
                job.updatedAt = Date.now();
                return getJobSnapshot(job);
            } catch (err) {
                job.status = 'failed';
                job.progress = { pct: job.progress.pct, stage: 'failed' };
                job.error = toRuntimeError(err);
                job.updatedAt = Date.now();
                return getJobSnapshot(job);
            }
        };

        const api = {
            workflow: {
                dispatch: dispatchWorkflowCommand,
            },
            status: () => ({
                ok: true,
                runtime: 'flovart-browser',
                version: '2.2.0',
                mediaElements: listMediaElements().length,
                jobs: Object.keys(runtimeJobsRef.current).length,
                provider: getRuntimeProviderStatus(),
            }),
            provider: {
                status: getRuntimeProviderStatus,
                beginSetup: (input?: { provider?: string; purpose?: 'image' | 'video' | 'both' }) => {
                    setIsSettingsPanelOpen(true);
                    return {
                        ok: true,
                        status: 'waiting_for_user',
                        provider: input?.provider || 'custom',
                        purpose: input?.purpose || 'both',
                        message: 'Provider setup opened in Flovart. API keys are entered only in the browser UI.',
                    };
                },
                selectModel: (input?: { imageModel?: string; videoModel?: string; textModel?: string }) => {
                    setModelPreference(prev => ({
                        ...prev,
                        imageModel: input?.imageModel || prev.imageModel,
                        videoModel: input?.videoModel || prev.videoModel,
                        textModel: input?.textModel || prev.textModel,
                    }));
                    return { ok: true, selectedModels: input || {} };
                },
                test: (input?: { purpose?: 'image' | 'video' | 'both' }) => {
                    const status = getRuntimeProviderStatus();
                    const purpose = input?.purpose || 'both';
                    const checks = {
                        image: status.configured.image,
                        video: status.configured.video,
                    };
                    return {
                        ok: purpose === 'both' ? checks.image && checks.video : checks[purpose],
                        purpose,
                        checks,
                    };
                },
            },
            session: {
                create: (name?: string) => {
                    const now = Date.now();
                    const id = crypto.randomUUID();
                    runtimeSessionsRef.current[id] = {
                        id,
                        name: (name || 'runtime-session').trim(),
                        createdAt: now,
                        lastActiveAt: now,
                        idempotencyMap: {},
                        jobIds: [],
                    };
                    return {
                        sessionId: id,
                        createdAt: now,
                        name: runtimeSessionsRef.current[id].name,
                    };
                },
                get: (sessionId: string) => {
                    const session = runtimeSessionsRef.current[sessionId];
                    if (!session) return null;
                    return {
                        sessionId: session.id,
                        name: session.name,
                        createdAt: session.createdAt,
                        lastActiveAt: session.lastActiveAt,
                        jobCount: session.jobIds.length,
                    };
                },
                list: () => Object.values(runtimeSessionsRef.current).map(session => ({
                    sessionId: session.id,
                    name: session.name,
                    createdAt: session.createdAt,
                    lastActiveAt: session.lastActiveAt,
                    jobCount: session.jobIds.length,
                })),
            },
            command: {
                send: sendCommand,
                get: (jobId: string) => {
                    const job = runtimeJobsRef.current[jobId];
                    return job ? getJobSnapshot(job) : null;
                },
                list: (sessionId?: string) => {
                    const jobs = Object.values(runtimeJobsRef.current);
                    return jobs
                        .filter(job => !sessionId || job.sessionId === sessionId)
                        .map(getJobSnapshot);
                },
            },
            progress: {
                query: (jobId: string) => {
                    const job = runtimeJobsRef.current[jobId];
                    if (!job) return null;
                    return {
                        jobId: job.jobId,
                        status: job.status,
                        progress: job.progress,
                        error: job.error,
                        updatedAt: job.updatedAt,
                    };
                },
            },
            canvas: {
                addElement: (partial: Partial<Element>) => {
                    const el = normalizeApiElement(partial);
                    commitAction(prev => [...prev, el]);
                    return el.id;
                },
                getElements: () => elementsRef.current.map(el => {
                    const bounds = getElementBounds(el, elementsRef.current);
                    return {
                        id: el.id,
                        type: el.type,
                        x: el.x,
                        y: el.y,
                        width: bounds.width,
                        height: bounds.height,
                        isVisible: el.isVisible ?? true,
                        isLocked: el.isLocked ?? false,
                        ...(el.type === 'text' ? { text: el.text } : {}),
                        ...(el.type === 'image' ? { name: el.name, href: el.href, mimeType: el.mimeType } : {}),
                        ...(el.type === 'video' ? { name: el.name, href: el.href, mimeType: el.mimeType, durationSec: el.durationSec } : {}),
                    };
                }),
                listMedia: listMediaElements,
                inspect: inspectCanvasState,
                addImage: (partial: Partial<ImageElement>) => addMediaElement(partial, 'image'),
                addVideo: (partial: Partial<VideoElement>) => addMediaElement(partial, 'video'),
                clearMedia: () => {
                    commitAction(prev => prev.filter(el => el.type !== 'image' && el.type !== 'video'));
                    return { ok: true };
                },
                removeElement: (id: string) => {
                    const exists = elementsRef.current.some(element => element.id === id);
                    commitAction(prev => prev.filter(e => e.id !== id && e.parentId !== id));
                    setSelectedElementIds(prev => prev.filter(item => item !== id));
                    return { ok: exists, id, removed: exists ? 1 : 0 };
                },
                updateElement: (id: string, updates: Record<string, unknown>) => {
                    const exists = elementsRef.current.some(element => element.id === id);
                    if (!exists) return { ok: false, error: { code: 'BAD_REQUEST', message: `element not found (${id})` } };
                    const safeUpdates = { ...updates };
                    delete safeUpdates.id;
                    delete safeUpdates.type;
                    commitAction(prev => prev.map(e => e.id === id ? ({ ...e, ...safeUpdates } as Element) : e));
                    return { ok: true, id, updates: safeUpdates };
                },
                clear: () => { commitAction(() => []); },
                getSelected: () => [...selectedElementIds],
                select: (ids?: string[] | string | null) => {
                    const available = new Set(elementsRef.current.map(element => element.id));
                    const requestedIds = Array.isArray(ids) ? ids : (ids ? [ids] : []);
                    const selected = requestedIds.filter(id => available.has(id));
                    setSelectedElementIds(selected);
                    return { ok: true, selectedElementIds: selected };
                },
            },
            element: {
                create: createAtomicElement,
                updatePrompt: updateAtomicPrompt,
                assignSlot: assignAtomicSlot,
                ignite: igniteAtomicElement,
                watch: watchAtomicElement,
            },
            generate: {
                image: async (input: string | { prompt: string }) => {
                    const prompt = typeof input === 'string' ? input : input.prompt;
                    return placeGeneratedImage({ prompt });
                },
                imagesBatch: async (input: { items?: Array<{ clientShotId?: string; prompt: string; negativePrompt?: string }> }) => {
                    const items = Array.isArray(input?.items) ? input.items : [];
                    const results: Array<{ clientShotId?: string; ok: boolean; prompt: string; canvasElementId?: string; error?: string }> = [];
                    for (const [index, item] of items.entries()) {
                        const prompt = [item.prompt, item.negativePrompt ? `Negative prompt: ${item.negativePrompt}` : ''].filter(Boolean).join('\n');
                        try {
                            const center = getCanvasCenter();
                            const placed = await placeGeneratedImage({
                                prompt,
                                name: item.clientShotId ? `Shot ${item.clientShotId}` : `Shot ${index + 1}`,
                                x: center.x + (index % 3) * 340,
                                y: center.y + Math.floor(index / 3) * 240,
                            });
                            results.push({ clientShotId: item.clientShotId, ok: true, prompt: item.prompt, canvasElementId: placed.id });
                        } catch (error) {
                            results.push({ clientShotId: item.clientShotId, ok: false, prompt: item.prompt, error: error instanceof Error ? error.message : String(error) });
                        }
                    }
                    return { ok: results.every(item => item.ok), items: results };
                },
                video: async (input: {
                    prompt: string;
                    sourceImageIds?: string[];
                    sourceVideoIds?: string[];
                    slots?: MultimodalSlot[];
                    aspectRatio?: string;
                    durationSec?: number;
                    resolution?: string;
                    seed?: number;
                }) => {
                    return placeGeneratedVideo(input);
                },
                videoStatus: (input: { jobId: string }) => api.command.get(input.jobId),
            },
            assets: {
                list: () => generationHistory.map(item => ({
                    id: item.id,
                    name: item.name,
                    mimeType: item.mimeType,
                    width: item.width,
                    height: item.height,
                    prompt: item.prompt,
                    mediaType: item.mediaType || 'image',
                    createdAt: item.createdAt,
                })),
            },
            export: {
                project: () => ({
                    ok: true,
                    mediaElements: listMediaElements(),
                    assets: generationHistory.map(item => ({ id: item.id, name: item.name, mediaType: item.mediaType || 'image', prompt: item.prompt })),
                }),
            },
            view: {
                getZoom: () => zoom,
                getPan: () => ({ ...panOffset }),
            },
            config: {
                getProviders: () => Object.keys(DEFAULT_PROVIDER_MODELS),
            },
            _version: '2.1.0',
        };
        (window as any).__flovartAPI = api;

        const runApiMethod = async (method: string, args: unknown) => {
            const parts = method.split('.');
            let fn: any = api;
            for (const p of parts) fn = fn?.[p];
            if (typeof fn !== 'function') throw new Error(`Unknown method: ${method}`);
            return fn(...(Array.isArray(args) ? args : [args]));
        };

        const runtimeFacade = api as any;
        const pollFileBridge = async () => {
            if (document.hidden) return;
            const response = await fetch('/__flovart/queue', { cache: 'no-store' });
            if (!response.ok) return;
            const entry = await response.json();
            if (!entry?.id || !entry.command) return;
            try {
                const result = await executeFlovartCommand(entry.command, entry.args || {}, runtimeFacade);
                await fetch('/__flovart/queue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: entry.id, result }),
                });
            } catch (err: any) {
                await fetch('/__flovart/queue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: entry.id, error: { code: 'BROWSER_EXECUTION_ERROR', message: err?.message || String(err) } }),
                });
            }
        };

        const bridgeInterval = window.setInterval(() => {
            pollFileBridge().catch(() => undefined);
        }, 500);
        pollFileBridge().catch(() => undefined);

        // Listen for postMessage commands from extension content script
        const handleApiMessage = (e: MessageEvent) => {
            if (e.data?.type !== '__flovart_command') return;
            const { id, method, args } = e.data;
            try {
                const result = runApiMethod(method, args);
                const reply = (r: any) => window.postMessage({ type: '__flovart_result', id, result: r }, '*');
                result instanceof Promise ? result.then(reply).catch((err: Error) => window.postMessage({ type: '__flovart_result', id, error: err.message }, '*')) : reply(result);
            } catch (err: any) {
                window.postMessage({ type: '__flovart_result', id, error: err.message }, '*');
            }
        };
        window.addEventListener('message', handleApiMessage);
        window.dispatchEvent(new CustomEvent('flovart:api-ready'));
        return () => { window.clearInterval(bridgeInterval); delete (window as any).__flovartAPI; window.removeEventListener('message', handleApiMessage); };
    }, [commitAction, selectedElementIds, zoom, panOffset, handleGenerate]);

    const getSelectionBounds = useCallback((selectionIds: string[]): Rect => {
        const selectedElements = elementsRef.current.filter(el => selectionIds.includes(el.id));
        if (selectedElements.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        selectedElements.forEach(el => {
            const bounds = getElementBounds(el, elementsRef.current);
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        });

        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }, []);

    const handleAlignSelection = (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
        const selectedElements = elementsRef.current.filter(el => selectedElementIds.includes(el.id));
        if (selectedElements.length < 2) return;
    
        const selectionBounds = getSelectionBounds(selectedElementIds);
        const { x: minX, y: minY, width, height } = selectionBounds;
        const maxX = minX + width;
        const maxY = minY + height;
    
        const selectionCenterX = minX + width / 2;
        const selectionCenterY = minY + height / 2;
    
        commitAction(prev => {
            const elementsToUpdate = new Map<string, { dx: number; dy: number }>();

            selectedElements.forEach(el => {
                const bounds = getElementBounds(el, prev);
                let dx = 0;
                let dy = 0;
        
                switch (alignment) {
                    case 'left':   dx = minX - bounds.x; break;
                    case 'center': dx = selectionCenterX - (bounds.x + bounds.width / 2); break;
                    case 'right':  dx = maxX - (bounds.x + bounds.width); break;
                    case 'top':    dy = minY - bounds.y; break;
                    case 'middle': dy = selectionCenterY - (bounds.y + bounds.height / 2); break;
                    case 'bottom': dy = maxY - (bounds.y + bounds.height); break;
                }
        
                if (dx !== 0 || dy !== 0) {
                    const elementsToMove = [el, ...getDescendants(el.id, prev)];
                    elementsToMove.forEach(elementToMove => {
                        if (!elementsToUpdate.has(elementToMove.id)) {
                            elementsToUpdate.set(elementToMove.id, { dx, dy });
                        }
                    });
                }
            });
            return prev.map((el): Element => {
                const delta = elementsToUpdate.get(el.id);
                if (!delta) {
                    return el;
                }

                const { dx, dy } = delta;
                
                switch (el.type) {
                    case 'image':
                    case 'shape':
                    case 'text':
                    case 'group':
                    case 'video':
                        return { ...el, x: el.x + dx, y: el.y + dy };
                    case 'arrow':
                    case 'line':
                        return { ...el, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) as [Point, Point] };
                    case 'path':
                        return { ...el, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
                }
            });
        });
    };

    const isElementVisible = useCallback((element: Element, allElements: Element[]): boolean => {
        if (element.isVisible === false) return false;
        if (element.parentId) {
            const parent = allElements.find(el => el.id === element.parentId);
            if (parent) {
                return isElementVisible(parent, allElements);
            }
        }
        return true;
    }, []);


    const isSelectionActive = selectedElementIds.length > 0;
    const singleSelectedElement = selectedElementIds.length === 1 ? elements.find(el => el.id === selectedElementIds[0]) : null;

    // Board Management
    const handleAddBoard = () => {
        const newBoard = createNewBoard(`Board ${boards.length + 1}`);
        setBoards(prev => [...prev, newBoard]);
        setActiveBoardId(newBoard.id);
    };

    const handleDuplicateBoard = (boardId: string) => {
        const boardToDuplicate = boards.find(b => b.id === boardId);
        if (!boardToDuplicate) return;
        const newBoard = {
            ...boardToDuplicate,
            id: generateId(),
            name: `${boardToDuplicate.name} Copy`,
            history: [boardToDuplicate.elements],
            historyIndex: 0,
        };
        setBoards(prev => [...prev, newBoard]);
        setActiveBoardId(newBoard.id);
    };
    
    const handleDeleteBoard = (boardId: string) => {
        if (boards.length <= 1) return; // Can't delete the last board
        const nextBoards = boards.filter(board => board.id !== boardId);
        setBoards(nextBoards);
        if (activeBoardId === boardId && nextBoards.length > 0) {
            setActiveBoardId(nextBoards[0].id);
        }
    };
    
    const handleRenameBoard = (boardId: string, name: string) => {
        setBoards(prev => prev.map(b => b.id === boardId ? { ...b, name } : b));
    };

    const generateBoardThumbnail = useCallback((elements: Element[], bgColor: string): string => {
         const THUMB_WIDTH = 120;
         const THUMB_HEIGHT = 80;

        if (elements.length === 0) {
            const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}"><rect width="100%" height="100%" fill="${bgColor}" /></svg>`;
            return `data:image/svg+xml;base64,${btoa(emptySvg)}`;
        }
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        elements.forEach(el => {
            const bounds = getElementBounds(el, elements);
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        });

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;

        if (contentWidth <= 0 || contentHeight <= 0) {
            const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}"><rect width="100%" height="100%" fill="${bgColor}" /></svg>`;
            return `data:image/svg+xml;base64,${btoa(emptySvg)}`;
        }

        const scale = Math.min(THUMB_WIDTH / contentWidth, THUMB_HEIGHT / contentHeight) * 0.9;
        const dx = (THUMB_WIDTH - contentWidth * scale) / 2 - minX * scale;
        const dy = (THUMB_HEIGHT - contentHeight * scale) / 2 - minY * scale;

        const svgContent = elements.map(el => {
             if (el.type === 'path') {
                const pathData = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                return `<path d="${pathData}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${el.strokeOpacity || 1}" />`;
             }
             if (el.type === 'image') {
                 return `<image href="${resolveHref(el.href)}" x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" />`;
             }
             // Add other element types for more accurate thumbnails if needed
             return '';
        }).join('');

        const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}"><rect width="100%" height="100%" fill="${bgColor}" /><g transform="translate(${dx} ${dy}) scale(${scale})">${svgContent}</g></svg>`;
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(fullSvg)))}`;
    }, []);

    const capabilityDiagnosis = diagnoseKeyCapabilities(userApiKeys);
    const studioMenuModel: StudioMenuModel = {
        mode: activeView,
        title: activeView === 'canvas' ? activeBoard.name : activeWorkflowTitle,
        theme: resolvedTheme,
        language,
        status: capabilityDiagnosis.missing.length === 0
            ? {
                tone: 'ready',
                label: language === 'zho' ? 'API 已就绪' : 'API ready',
                detail: language === 'zho' ? '文本、图片和视频能力均已配置' : 'Text, image, and video capabilities are configured',
            }
            : {
                tone: 'warning',
                label: `API ${capabilityDiagnosis.covered.length}/3`,
                detail: capabilityDiagnosis.warnings.join('\n'),
            },
        actions: {
            changeMode: setActiveView,
            toggleTheme: () => setThemeMode(resolvedTheme === 'dark' ? 'light' : 'dark'),
            toggleLanguage: () => setLanguage(language === 'zho' ? 'en' : 'zho'),
            openSettings: () => setIsSettingsPanelOpen(true),
        },
    };

    if (activeView === 'workflow') {
        return (
            <AppShell
                themeBackground={themePalette.appBackground}
                topBar={
                    <StudioTopMenu model={studioMenuModel} />
                }
                main={
                    <Suspense fallback={<div className="h-full w-full flex items-center justify-center opacity-40 text-sm">正在加载 Workflow...</div>}>
                        <WorkflowWorkspace
                            theme={resolvedTheme}
                            language={language}
                            resolveGenerationCapability={resolveWorkflowGenerationCapability}
                            sharedMedia={workflowSharedMedia}
                            onReversePrompt={handleWorkflowReversePrompt}
                            onRunNode={handleRunWorkflowNode}
                            onStopNode={(projectId, nodeId) => { cancelWorkflowGeneration(projectId, nodeId); }}
                            onSaveWorkflowMedia={handleSaveWorkflowMedia}
                            onRenameSharedMedia={(media, name) => {
                                if (media.source !== 'asset' || !media.category || !media.sourceId) return;
                                setAssetLibrary(prev => renameAsset(prev, media.category!, media.sourceId!, name));
                            }}
                            onRemoveSharedMedia={media => {
                                if (media.source !== 'asset' || !media.category || !media.sourceId) return;
                                setAssetLibrary(prev => removeAsset(prev, media.category!, media.sourceId!));
                            }}
                            onOnlineAgentTurn={handleWorkflowOnlineAgentTurn}
                            t={t}
                            userApiKeys={userApiKeys}
                            modelPreference={modelPreference}
                            dynamicModelOptions={dynamicModelOptions}
                            onOpenSettings={() => setIsSettingsPanelOpen(true)}
                        />
                    </Suspense>
                }
                overlays={
                    <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"><div className="rounded-xl bg-neutral-800 px-6 py-4 text-sm text-white/60">Loading Settings...</div></div>}>
                        <CanvasSettings
                            isOpen={isSettingsPanelOpen}
                            onClose={() => setIsSettingsPanelOpen(false)}
                            language={language}
                            setLanguage={setLanguage}
                            themeMode={themeMode}
                            resolvedTheme={resolvedTheme}
                            setThemeMode={setThemeMode}
                            wheelAction={wheelAction}
                            setWheelAction={setWheelAction}
                            userApiKeys={userApiKeys}
                            onAddApiKey={handleAddApiKey}
                            onDeleteApiKey={handleDeleteApiKey}
                            onUpdateApiKey={handleUpdateApiKey}
                            onSetDefaultApiKey={handleSetDefaultApiKey}
                            modelPreference={modelPreference}
                            setModelPreference={setModelPreference}
                            modelPreferenceSavedAt={modelPreferenceSavedAt}
                            modelPreferenceSaveError={modelPreferenceSaveError}
                            t={t}
                            clearKeysOnExit={clearKeysOnExit}
                            setClearKeysOnExit={setClearKeysOnExit}
                            usageSummary={usageSummaryMap}
                            dynamicModelOptions={dynamicModelOptions}
                        />
                    </Suspense>
                }
            />
        );
    }

    return (
        <AppShell
            themeBackground={themePalette.appBackground}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragOverCapture={handleDragOverCapture}
            onDropCapture={handleDropCapture}
            topBar={
                <StudioTopMenu model={studioMenuModel} />
            }
            leftSidebar={
                <WorkspaceSidebar
                isOpen={!isLayerMinimized}
                onToggle={() => setIsLayerMinimized(prev => !prev)}
                outerGap={chromeMetrics.outerGap}
                panelWidth={chromeMetrics.sidebarWidth}
                boards={boards}
                activeBoardId={activeBoardId}
                onSwitchBoard={setActiveBoardId}
                onAddBoard={handleAddBoard}
                onRenameBoard={handleRenameBoard}
                onDuplicateBoard={handleDuplicateBoard}
                onDeleteBoard={handleDeleteBoard}
                generateBoardThumbnail={(els) => generateBoardThumbnail(els, canvasBackgroundColor)}
                elements={elements}
                selectedElementIds={selectedElementIds}
                onSelectElement={(id, additive) => {
                    if (!id) {
                        setSelectedElementIds([]);
                        return;
                    }
                    setSelectedElementIds(prev => additive
                        ? (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
                        : [id]);
                }}
                onToggleVisibility={id => handlePropertyChange(id, { isVisible: !(elements.find(el => el.id === id)?.isVisible ?? true) })}
                onToggleLock={id => handlePropertyChange(id, { isLocked: !(elements.find(el => el.id === id)?.isLocked ?? false) })}
                onRenameElement={(id, name) => handlePropertyChange(id, { name })}
                onReorder={(draggedId, targetId, position) => {
                    commitAction(prev => {
                        const newElements = [...prev];
                        const draggedIndex = newElements.findIndex(el => el.id === draggedId);
                        if (draggedIndex === -1) return prev;

                        const [draggedItem] = newElements.splice(draggedIndex, 1);
                        const targetIndex = newElements.findIndex(el => el.id === targetId);
                        if (targetIndex === -1) {
                            newElements.push(draggedItem);
                            return newElements;
                        }

                        const finalIndex = position === 'before' ? targetIndex : targetIndex + 1;
                        newElements.splice(finalIndex, 0, draggedItem);
                        return newElements;
                    });
                }}
            />
            }
            rightSidebar={
                <Suspense fallback={<div className="h-full w-full flex items-center justify-center opacity-40 text-sm">Loading...</div>}>
                <RightPanel
                theme={resolvedTheme}
                isMinimized={isInspirationMinimized}
                onToggleMinimize={() => setIsInspirationMinimized(prev => !prev)}
                outerGap={chromeMetrics.outerGap}
                defaultWidth={chromeMetrics.rightPanelDefaultWidth}
                minWidth={chromeMetrics.rightPanelMinWidth}
                widthCap={chromeMetrics.rightPanelWidthCap}
                compactMode={chromeMetrics.isTablet}
                library={assetLibrary}
                generationHistory={generationHistory}
                onRemove={(cat, id) => setAssetLibrary(prev => removeAsset(prev, cat, id))}
                onRename={(cat, id, name) => setAssetLibrary(prev => renameAsset(prev, cat, id, name))}
                onWidthChange={setRightPanelWidth}
                onReversePrompt={handleReversePrompt}
                onCreateImage={async (prompt, name) => {
                    const runtimeApi = getFlovartRuntimeApi();
                    const result = await runtimeApi?.generate?.image?.({ prompt, name });
                    if (!result || !result.id) throw new Error(getRuntimeErrorMessage(result, 'Agent image generation failed'));
                }}
                onCreateVideo={async (prompt, sourceImageIds) => {
                    const runtimeApi = getFlovartRuntimeApi();
                    const result = await runtimeApi?.generate?.video?.({ prompt, sourceImageIds });
                    if (!result || !result.id) throw new Error(getRuntimeErrorMessage(result, 'Agent video generation failed'));
                }}
                runtimeStage={progressMessage}
                runtimeJobs={Object.values(runtimeJobsRef.current)
                    .map(job => ({
                        jobId: job.jobId,
                        command: job.command,
                        status: job.status,
                        progress: { pct: job.progress?.pct ?? 0, stage: job.progress?.stage ?? '' },
                        updatedAt: job.updatedAt,
                    }))}
                elements={elements}
                selectedElementIds={selectedElementIds}
                setSelectedElementIds={setSelectedElementIds}
                commitAction={commitAction}
                handleGenerate={handleGenerate}
                userApiKeys={userApiKeys}
                modelPreference={modelPreference}
                pendingChatAttachments={pendingChatAttachments}
                onConsumeChatAttachments={() => setPendingChatAttachments([])}
            />
            </Suspense>
            }
            bottomDock={
                <Toolbar
                    t={t}
                    theme={resolvedTheme}
                    compactScale={chromeMetrics.toolbarScale}
                    topOffset={chromeMetrics.outerGap}
                    leftClosed={chromeMetrics.toolbarLeftClosed}
                    leftOpen={chromeMetrics.toolbarLeftOpen}
                    activeTool={activeTool}
                    setActiveTool={setActiveTool}
                    drawingOptions={drawingOptions}
                    setDrawingOptions={setDrawingOptions}
                    onUpload={handleAddMediaElement}
                    onSettingsClick={() => setIsSettingsPanelOpen(true)}
                    onLayersClick={() => setIsLayerMinimized(prev => !prev)}
                    onBoardsClick={() => setIsLayerMinimized(prev => !prev)}
                    onAssetsClick={() => setIsInspirationMinimized(prev => !prev)}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    isLayerPanelExpanded={!isLayerMinimized}
                    canUndo={historyIndex > 0}
                    canRedo={historyIndex < history.length - 1}
                    orientation="horizontal"
                    embedded
                    wheelAction={wheelAction}
                    setWheelAction={setWheelAction}
                />
            }
            overlays={<>
                {isLoading && <Loader progressMessage={progressMessage} batchTotal={batchCount} batchDone={recentlyCompleted.size} />}
                <ToastStack toasts={toast.toasts} onDismiss={toast.dismiss} />
                {error && (
                    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md shadow-lg flex items-center max-w-lg">
                        <span className="flex-grow">{error}</span>
                        <button onClick={() => setError(null)} className="ml-4 p-1 rounded-full hover:bg-red-200" title={t('common.close')} aria-label={t('common.close')}>
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"></path></svg>
                        </button>
                    </div>
                )}
                {modelAutoSwitchNotice && (
                    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 p-3 bg-blue-100 border border-blue-400 text-blue-700 rounded-md shadow-lg flex items-center max-w-lg animate-fade-in">
                        <span className="mr-2">馃攧</span>
                        <span className="flex-grow text-sm">{modelAutoSwitchNotice}</span>
                    </div>
                )}
            </>}
            main={<>
            <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"><div className="rounded-xl bg-neutral-800 px-6 py-4 text-sm text-white/60">Loading Settings...</div></div>}>
                <CanvasSettings
                    isOpen={isSettingsPanelOpen}
                    onClose={() => setIsSettingsPanelOpen(false)}
                    language={language}
                    setLanguage={setLanguage}
                    themeMode={themeMode}
                    resolvedTheme={resolvedTheme}
                    setThemeMode={setThemeMode}
                    wheelAction={wheelAction}
                    setWheelAction={setWheelAction}
                    userApiKeys={userApiKeys}
                    onAddApiKey={handleAddApiKey}
                    onDeleteApiKey={handleDeleteApiKey}
                    onUpdateApiKey={handleUpdateApiKey}
                    onSetDefaultApiKey={handleSetDefaultApiKey}
                    modelPreference={modelPreference}
                    setModelPreference={setModelPreference}
                    modelPreferenceSavedAt={modelPreferenceSavedAt}
                    modelPreferenceSaveError={modelPreferenceSaveError}
                    t={t}
                    clearKeysOnExit={clearKeysOnExit}
                    setClearKeysOnExit={setClearKeysOnExit}
                    usageSummary={usageSummaryMap}
                    dynamicModelOptions={dynamicModelOptions}
                />
            </Suspense>
            {/* ============ 图层蒙版编辑 (Layer Mask) ============ */}

            {/* ============ A/B 对比弹窗 ============ */}
            {abCompare && (
                <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"><div className="rounded-xl bg-neutral-800 px-6 py-4 text-sm text-white/60">Loading...</div></div>}>
                <ABCompareOverlay
                    imageA={abCompare.imageA}
                    imageB={abCompare.imageB}
                    onClose={() => setAbCompare(null)}
                    theme={resolvedTheme}
                />
                </Suspense>
            )}

            {/* ============ 鎵归噺鐢熸垚缁撴灉对比弹窗 ============ */}
            {batchResults && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                     onClick={() => setBatchResults(null)}>
                    <div className={`relative rounded-2xl shadow-2xl p-6 max-w-[90vw] max-h-[90vh] overflow-auto ${resolvedTheme === 'dark' ? 'bg-[#1C2333] text-white' : 'bg-white text-gray-900'}`}
                         onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold">批量生成结果 - 选择最佳方案</h3>
                            <div className="flex gap-2">
                                <button onClick={handleSelectAllBatchResults}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${resolvedTheme === 'dark' ? 'bg-[#2A3142] hover:bg-[#3A4458] text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                                    鍏ㄩ儴鏀惧叆鐢诲竷
                                </button>
                                <button onClick={() => setBatchResults(null)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${resolvedTheme === 'dark' ? 'bg-[#2A3142] hover:bg-[#3A4458] text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                                    鍏抽棴
                                </button>
                            </div>
                        </div>
                        <p className={`text-sm mb-4 ${resolvedTheme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                            鎻愮ず璇? {batchResults.prompt}
                        </p>
                        <div className={`grid gap-4 ${batchResults.images.length <= 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
                            {batchResults.images.map((img, idx) => (
                                <div key={idx}
                                     className={`group relative rounded-xl overflow-hidden border-2 transition cursor-pointer hover:scale-[1.02] ${resolvedTheme === 'dark' ? 'border-[#2A3142] hover:border-blue-500' : 'border-gray-200 hover:border-blue-400'}`}
                                     onClick={() => handleSelectBatchResult(img)}>
                                    <img src={img.href} alt={`方案 ${idx + 1}`}
                                         className="w-full h-auto max-h-[40vh] object-contain"
                                         style={{ background: resolvedTheme === 'dark' ? '#0D1117' : '#F9FAFB' }} />
                                    <div className={`absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t ${resolvedTheme === 'dark' ? 'from-black/80' : 'from-black/50'} to-transparent opacity-0 group-hover:opacity-100 transition`}>
                                        <div className="flex items-center justify-between">
                                            <span className="text-white text-sm font-medium">方案 {idx + 1}</span>
                                            <span className="text-white/80 text-xs">{img.width}脳{img.height}</span>
                                        </div>
                                        <button className="mt-2 w-full py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-medium transition">
                                            閫夋嫨姝ゆ柟妗?
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* 鏂扮敤鎴峰紩瀵煎脊绐?鈥?鏃?API Key 鏃惰嚜鍔ㄥ嚭鐜?*/}
            {showOnboarding && (
                <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"><div className="rounded-xl bg-neutral-800 px-6 py-4 text-sm text-white/60">Loading...</div></div>}>
                <OnboardingWizard
                    isOpen={showOnboarding}
                    onClose={() => {
                        setShowOnboarding(false);
                        localStorage.setItem('onboarding.skipped', 'true');
                    }}
                    onAddApiKey={handleAddApiKey}
                    resolvedTheme={resolvedTheme}
                />
                </Suspense>
            )}
            
            {addAssetModal?.open && (
                <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"><div className="rounded-xl bg-neutral-800 px-6 py-4 text-sm text-white/60">Loading...</div></div>}>
                <AssetAddModal
                    isOpen={addAssetModal.open}
                    onClose={() => setAddAssetModal(null)}
                    previewDataUrl={addAssetModal.dataUrl}
                    onConfirm={(category, name) => {
                        const newItem: AssetItem = {
                            id: generateId(),
                            name,
                            category,
                            dataUrl: addAssetModal.dataUrl,
                            mimeType: addAssetModal.mimeType,
                            width: addAssetModal.width,
                            height: addAssetModal.height,
                            createdAt: Date.now(),
                        };
                        setAssetLibrary(prev => addAsset(prev, newItem));
                        setAddAssetModal(null);
                    }}
                />
                </Suspense>
            )}
            <ElementToolbar
                selectedElementIds={selectedElementIds}
                singleSelectedElement={singleSelectedElement}
                elements={elements}
                zoom={excalidrawViewport.zoom}
                resolvedTheme={resolvedTheme}
                isLoading={isLoading}
                language={language}
                filterPanelElementId={filterPanelElementId}
                outpaintMenuId={outpaintMenuId}
                reversePromptLoading={reversePromptLoading}
                t={t}
                getSelectionBounds={getSelectionBounds}
                getElementBounds={getElementBounds}
                handleAlignSelection={handleAlignSelection}
                handleGroupSelection={handleGroupSelection}
                handleExportSelection={handleExportSelection}
                handleCopyElement={handleCopyElement}
                handleDownloadImage={handleDownloadImage}
                handleDeleteElement={handleDeleteElement}
                handlePropertyChange={handlePropertyChange}
                setFilterPanelElementId={setFilterPanelElementId}
                setAddAssetModal={setAddAssetModal}
                handleSplitImageLayers={handleSplitImageLayers}
                handleUpscaleImage={handleUpscaleImage}
                handleRemoveImageBackground={handleRemoveImageBackground}
                handleOutpaint={handleOutpaint}
                handleReversePrompt={handleReversePrompt}
                cancelReversePrompt={cancelReversePrompt}
                setOutpaintMenuId={setOutpaintMenuId}
                viewport={canvasViewport}
                containerRect={canvasContainerRect}
                onMagicGenerate={triggerMagicGenerate}
                onAddToChat={triggerAddToChat}
            />
            <FlovartExcalidrawStage
                flovartElements={activeBoard?.elements ?? []}
                onFlovartCommit={(next) => setElements(() => next, true)}
                theme={resolvedTheme}
                resolveHref={resolveColdMediaRef}
                onSelectionChange={setSelectedElementIds}
                onApiReady={(api) => { excalidrawApiRef.current = api; }}
                onViewportChange={setExcalidrawViewport}
                containerRef={excalidrawContainerRef}
                activeTool={activeTool}
                bottomBar={(activeBoard?.elements ?? []).length > 0 ? (
                    <PromptBar
                        t={t}
                        theme={resolvedTheme}
                        variant="inline"
                        compactMode
                        shellClassName="inline-prompt-bar-shell"
                        popoverDirection="up"
                        prompt={prompt}
                        promptDocument={promptDocument}
                        setPrompt={v => { setPrompt(v); setPromptDocument(undefined); setMentionedElementIds([]); }}
                        onPromptInputChange={({ plainText, document, mentionedElementIds: mentions }) => {
                            setPrompt(plainText);
                            setPromptDocument(document);
                            setMentionedElementIds(mentions);
                        }}
                        onGenerate={() => handleGenerate()}
                        isLoading={isLoading}
                        isSelectionActive={selectedElementIds.length > 0}
                        selectedElementCount={selectedElementIds.length}
                        userEffects={userEffects}
                        onAddUserEffect={(effect) => setUserEffects(prev => [...prev, effect])}
                        onDeleteUserEffect={(id) => setUserEffects(prev => prev.filter(e => e.id !== id))}
                        generationMode={generationMode}
                        setGenerationMode={setGenerationMode}
                        videoAspectRatio={videoAspectRatio}
                        setVideoAspectRatio={setVideoAspectRatio}
                        videoDurationSec={videoDurationSec}
                        onVideoDurationSecChange={setVideoDurationSec}
                        videoResolution={videoResolution}
                        onVideoResolutionChange={setVideoResolution}
                        videoGenerateAudio={videoGenerateAudio}
                        onVideoGenerateAudioChange={setVideoGenerateAudio}
                        videoWatermark={videoWatermark}
                        onVideoWatermarkChange={setVideoWatermark}
                        canvasElements={activeBoard?.elements ?? []}
                        mentionItems={mentionItems}
                        isAutoEnhanceEnabled={isAutoEnhanceEnabled}
                        onAutoEnhanceToggle={() => setIsAutoEnhanceEnabled(v => !v)}
                        onLockCharacterFromSelection={handleLockCharacterFromSelection}
                        canLockCharacter={!!selectedSingleImage}
                        characterLocks={characterLocks}
                        activeCharacterLockId={activeCharacterLockId}
                        onSetActiveCharacterLock={setActiveCharacterLockId}
                        batchCount={batchCount}
                        onBatchCountChange={setBatchCount}
                        error={error}
                        progressStage={progressMessage}
                    />
                ) : undefined}
            />
        </>}
        />
    );
};

export default App;
