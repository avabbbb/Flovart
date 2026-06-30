import { useCallback, useEffect, useRef, useState } from 'react';
import { exportToCanvas } from '@excalidraw/excalidraw';
import { motion, AnimatePresence } from 'motion/react';
import { Wand2, MessageCircle } from 'lucide-react';
import { ExcalidrawInner, type ExcalidrawElementInfo, type ExcalidrawViewport } from './ExcalidrawInner';
import {
  flovartToExcalidraw,
  registerImageFiles,
  excalidrawToFlovartPatch,
  diffExcalidrawElements,
  allocateFlovartIdFromExcalidraw,
  type ExcalidrawElementLike,
} from '../../utils/excalidrawAdapter';
import type { Element as FlovartElement, ImageElement } from '../../types';
import './excalidraw-canvas.css';

interface FlovartExcalidrawStageProps {
  theme: 'light' | 'dark';
  /** Flovart source-of-truth elements from active board */
  flovartElements: FlovartElement[];
  /** Called when Excalidraw emits committed changes that should be written back to Flovart state. */
  onFlovartCommit: (next: FlovartElement[]) => void;
  /** Resolve a Flovart href (data/blob/cold-media) to a data URL Excalidraw can register. */
  resolveHref?: (href: string) => Promise<string | null>;
  /** Called when Excalidraw selection changes, so host can sync sidebar/layer highlight. */
  onSelectionChange?: (selectedIds: string[]) => void;
  /** Optional React node rendered as a docked bar at the bottom of the stage. */
  bottomBar?: React.ReactNode;
  /** Called when user triggers Magic Generate; Stage exports selected elements to a screenshot. */
  onMagicGenerate?: (dataUrl: string, width: number, height: number, bounds: { x: number; y: number; width: number; height: number }) => void;
  /** Called when user clicks "加入对话" on a single selected image element; receives resolved dataUrl + mimeType. */
  onAddToChat?: (dataUrl: string, mimeType: string) => void;
  /** Called whenever Excalidraw viewport (scroll/zoom) changes, so host can position fixed overlays. */
  onViewportChange?: (vp: ExcalidrawViewport) => void;
  /** Ref attached to the .excalidraw-container div so host can track its bounding rect for overlay positioning. */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  /** Active tool from host Toolbar; bridged to Excalidraw setActiveTool API. */
  activeTool?: string;
}

/**
 * Phase A hosted renderer: Excalidraw as a view/input layer over Flovart Element[].
 *
 * - On mount: convert Flovart elements -> Excalidraw scene via adapter; register image files async.
 * - On Excalidraw onChange: diff against last snapshot, emit patches to onFlovartCommit.
 * - On flovartElements prop change (e.g., async generation completes): re-sync via adapter.
 *
 * Flovart remains the source of truth; Excalidraw is the visual input. Re-entrancy guards use
 * a ref-tracked isSyncing flag to avoid echo loops when our own updateScene fires onChange.
 */
export function FlovartExcalidrawStage({
  theme,
  flovartElements,
  onFlovartCommit,
  resolveHref,
  onSelectionChange,
  bottomBar,
  onMagicGenerate,
  onAddToChat,
  onViewportChange,
  containerRef,
  activeTool,
}: FlovartExcalidrawStageProps) {
  const apiRef = useRef<any>(null);
  const lastFlovartRef = useRef<FlovartElement[]>(flovartElements);
  const lastExSnapshotRef = useRef<ExcalidrawElementLike[]>([]);
  const isSyncingRef = useRef(false);
  const imageFileCacheRef = useRef<Map<string, string>>(new Map());
  const bootedRef = useRef(false);
  const onCommitRef = useRef(onFlovartCommit);
  onCommitRef.current = onFlovartCommit;
  const onSelectionRef = useRef(onSelectionChange);
  onSelectionRef.current = onSelectionChange;
  const onMagicGenerateRef = useRef(onMagicGenerate);
  onMagicGenerateRef.current = onMagicGenerate;
  const onAddToChatRef = useRef(onAddToChat);
  onAddToChatRef.current = onAddToChat;
  const onViewportRef = useRef(onViewportChange);
  onViewportRef.current = onViewportChange;
  const [popbar, setPopbar] = useState<{ pos: { x: number; y: number }; mode: 'addToChat' | 'magicGenerate' } | null>(null);
  const [promptBarPos, setPromptBarPos] = useState<{ left: number; top: number } | null>(null);
  const selectedIdsRef = useRef<string[]>([]);

  const pushFlovartToExcalidraw = useCallback(async (els: FlovartElement[]) => {
    const api = apiRef.current;
    if (!api) return;
    isSyncingRef.current = true;
    try {
      const { elements: exElements } = flovartToExcalidraw(els);
      const imageEls = els.filter((e): e is ImageElement => e.type === 'image');

      // Pre-compute fileIds synchronously so we can set them on elements
      // BEFORE updateScene. registerImageFiles uses the same fl_${id} scheme.
      const preFileIdMap = new Map<string, string>();
      for (const el of imageEls) preFileIdMap.set(el.id, `fl_${el.id}`);

      const hydrated = exElements.map(exEl => {
        const cd = exEl.customData as { flovartType?: string } | undefined;
        if (exEl.type === 'image' && cd?.flovartType === 'image') {
          const fid = preFileIdMap.get(exEl.id) ?? null;
          return { ...exEl, fileId: fid, status: fid ? 'saved' : 'pending' };
        }
        return exEl;
      });

      // 1. updateScene FIRST — image elements must be in scene before addFiles
      //    so that addNewImagesToImageCache (called inside addFiles) can find them.
      //    updateScene alone does NOT trigger addNewImagesToImageCache.
      api.updateScene({ elements: hydrated });
      lastExSnapshotRef.current = hydrated;

      // 2. addFiles AFTER updateScene — addNewImagesToImageCache scans the scene,
      //    finds the now-present image elements, loads their dataURLs into imageCache.
      if (imageEls.length) {
        await registerImageFiles(imageEls, api, {
          resolveColdMediaRef: resolveHref,
          cache: imageFileCacheRef.current,
        });
        // 3. refresh — force canvas repaint after async image cache population.
        setTimeout(() => { try { api.refresh(); } catch { /* ignore */ } }, 120);
      }

      // NOTE: isSyncingRef stays true here. It is cleared in handleSceneChange
      // once getSceneElements() confirms updateScene has taken effect.
    } catch (e) {
      isSyncingRef.current = false;
      throw e;
    }
  }, [resolveHref]);

  const handleApiReady = useCallback((api: any) => {
    apiRef.current = api;
    if (!bootedRef.current) {
      bootedRef.current = true;
      // Delay push to next tick — Excalidraw's initialData processing may
      // overwrite updateScene if we push synchronously during the API callback.
      setTimeout(() => {
        if (apiRef.current) pushFlovartToExcalidraw(lastFlovartRef.current);
      }, 0);
    }
  }, [pushFlovartToExcalidraw]);

  // Bridge host Toolbar activeTool -> Excalidraw setActiveTool API.
  const TOOL_MAP: Record<string, string> = {
    select: 'selection', pan: 'hand', draw: 'freedraw', erase: 'eraser',
    rectangle: 'rectangle', circle: 'ellipse', triangle: 'diamond',
    text: 'text', arrow: 'arrow', line: 'line', highlighter: 'freedraw', lasso: 'selection',
  };
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !activeTool) return;
    const exType = TOOL_MAP[activeTool] || 'selection';
    try { api.setActiveTool({ type: exType }); } catch { /* ignore */ }
  }, [activeTool]);

  const handleSceneChange = useCallback(
    (_els: ExcalidrawElementInfo[], selIds: string[], vp: ExcalidrawViewport) => {
      const api = apiRef.current;
      if (!api) return;
      onSelectionRef.current?.(selIds);
      onViewportRef.current?.(vp);
      selectedIdsRef.current = selIds;

      // Pop-bar logic:
      //   - 1 selected image element → "加入对话"
      //   - ≥2 selected elements     → "Magic Generate"
      if (selIds.length >= 1) {
        const allScene = api.getSceneElements() as ExcalidrawElementLike[];
        const selected = allScene.filter(e => selIds.includes(e.id) && !e.isDeleted);
        if (selected.length > 0) {
          const minX = Math.min(...selected.map(e => e.x));
          const minY = Math.min(...selected.map(e => e.y));
          const maxX = Math.max(...selected.map(e => e.x + (e.width || 0)));
          const maxY = Math.max(...selected.map(e => e.y + (e.height || 0)));
          const centerX = (minX + maxX) / 2;
          const topY = minY;

          let mode: 'addToChat' | 'magicGenerate' | null = null;
          if (selIds.length === 1) {
            const cd = selected[0].customData as { flovartType?: string } | undefined;
            if (cd?.flovartType === 'image' || selected[0].type === 'image') {
              mode = 'addToChat';
            }
          } else if (selIds.length >= 2) {
            mode = 'magicGenerate';
          }

          if (mode) {
            setPopbar({
              pos: { x: (vp.x + centerX) * vp.zoom, y: (vp.y + topY) * vp.zoom - 44 },
              mode,
            });
          } else {
            setPopbar(null);
          }
        } else {
          setPopbar(null);
        }
      } else {
        setPopbar(null);
      }

      // PromptBar follows selection: position below selected elements' bounding box.
      if (selIds.length >= 1) {
        const allScene2 = api.getSceneElements() as ExcalidrawElementLike[];
        const selected2 = allScene2.filter(e => selIds.includes(e.id) && !e.isDeleted);
        if (selected2.length > 0) {
          const minX = Math.min(...selected2.map(e => e.x));
          const maxX = Math.max(...selected2.map(e => e.x + (e.width || 0)));
          const maxY = Math.max(...selected2.map(e => e.y + (e.height || 0)));
          const centerX = (minX + maxX) / 2;
          setPromptBarPos({ left: (vp.x + centerX) * vp.zoom, top: (vp.y + maxY) * vp.zoom + 16 });
        } else {
          setPromptBarPos(null);
        }
      } else {
        setPromptBarPos(null);
      }

      if (isSyncingRef.current) {
        // updateScene is async (Excalidraw uses React state internally).
        // Wait until getSceneElements() reflects what we pushed, then clear flag.
        const probe = api.getSceneElements() as ExcalidrawElementLike[];
        const sceneIds = new Set(probe.map(e => e.id));
        if (lastExSnapshotRef.current.every(e => sceneIds.has(e.id))) {
          isSyncingRef.current = false;
          // Fall through to normal diff processing — this onChange may include
          // user edits that happened between updateScene and the flag clearing.
        } else {
          return; // updateScene hasn't taken effect yet, skip this cycle
        }
      }
      const allScene = api.getSceneElements() as ExcalidrawElementLike[];
      const snapshot: ExcalidrawElementLike[] = allScene
        .filter(e => !e.isDeleted)
        .map(e => ({
          ...e,
          customData: e.customData ?? undefined,
          points: e.points ? e.points.map((p: any) => ({ x: p.x, y: p.y })) : undefined,
        }));
      const diff = diffExcalidrawElements(lastExSnapshotRef.current, snapshot);
      if (!diff.added.length && !diff.removed.length && !diff.updated.length) return;
      lastExSnapshotRef.current = snapshot;
      let nextFlovart = [...lastFlovartRef.current];
      if (diff.removed.length) {
        const remove = new Set(diff.removed);
        nextFlovart = nextFlovart.filter(el => !remove.has(el.id));
      }
      for (const id of diff.updated) {
        const exEl = snapshot.find(e => e.id === id);
        if (!exEl) continue;
        const patch = excalidrawToFlovartPatch(exEl);
        if (!patch) continue;
        nextFlovart = nextFlovart.map(el => {
          if (el.id !== id) return el;
          return { ...el, ...clipToUpdate(patch), id: el.id } as FlovartElement;
        });
      }
      for (const id of diff.added) {
        const exEl = snapshot.find(e => e.id === id);
        if (!exEl) continue;
        const newEl = instantiateFromExcalidraw(exEl);
        if (newEl) nextFlovart.push(newEl);
      }
      lastFlovartRef.current = nextFlovart;
      onCommitRef.current(nextFlovart);
    },
    [],
  );

  const handleMagicGenerate = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    const selectedIds = selectedIdsRef.current;
    if (selectedIds.length < 2) return;

    const appState = api.getAppState();
    const files = api.getFiles();
    const allElements = api.getSceneElements();
    const selectedElements = allElements.filter((e: any) => selectedIds.includes(e.id) && !e.isDeleted);
    if (selectedElements.length === 0) return;

    const minX = Math.min(...selectedElements.map((e: any) => e.x));
    const minY = Math.min(...selectedElements.map((e: any) => e.y));
    const maxX = Math.max(...selectedElements.map((e: any) => e.x + (e.width || 0)));
    const maxY = Math.max(...selectedElements.map((e: any) => e.y + (e.height || 0)));
    const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

    const canvas = await exportToCanvas({
      elements: selectedElements,
      appState: { ...appState, selectedElementIds: Object.fromEntries(selectedIds.map(id => [id, true])) },
      files,
      mimeType: 'image/png',
      maxWidthOrHeight: 2048,
      quality: 1,
    } as any);

    const dataUrl = canvas.toDataURL('image/png', 0.8);
    onMagicGenerateRef.current?.(dataUrl, canvas.width, canvas.height, bounds);

    api.updateScene({ appState: { selectedElementIds: {} } });
  }, []);

  const handleAddToChat = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    const selectedIds = selectedIdsRef.current;
    if (selectedIds.length !== 1) return;

    const id = selectedIds[0];
    const flovartEl = lastFlovartRef.current.find(e => e.id === id);
    if (!flovartEl || flovartEl.type !== 'image') return;
    const imgEl = flovartEl as ImageElement;
    const href = (imgEl as { href?: string }).href;
    if (!href) return;

    const resolved = resolveHref ? await resolveHref(href) : href;
    if (!resolved) return;
    onAddToChatRef.current?.(resolved, (imgEl as { mimeType?: string }).mimeType || 'image/png');

    api.updateScene({ appState: { selectedElementIds: {} } });
  }, [resolveHref]);

  useEffect(() => {
    const prev = lastFlovartRef.current;
    lastFlovartRef.current = flovartElements;
    if (!bootedRef.current) return;
    if (flovartElements === prev) return;
    pushFlovartToExcalidraw(flovartElements);
  }, [flovartElements, pushFlovartToExcalidraw]);

  return (
    <div className="excalidraw-wrapper">
      <div className="excalidraw-container" ref={containerRef}>
        <ExcalidrawInner
          theme={theme}
          onApiReady={handleApiReady}
          onSceneChange={handleSceneChange}
          onContextMenu={() => undefined}
        />

        {/* Pop-bar: floating action button above selection (absolute, follows selection) */}
        <div className="excalidraw-popbar-layer">
          <AnimatePresence>
            {popbar?.pos && (
              <motion.div
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="excalidraw-popbar"
                style={{ left: `${popbar.pos.x}px`, top: `${popbar.pos.y}px` }}
              >
                <div
                  className="excalidraw-popbar__inner"
                  style={{
                    background: theme === 'dark' ? 'rgba(30,30,30,0.75)' : 'rgba(255,255,255,0.75)',
                    border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
                  }}
                >
                  {popbar.mode === 'magicGenerate' ? (
                    <button
                      type="button"
                      onClick={handleMagicGenerate}
                      className="excalidraw-popbar__btn"
                      style={{ color: theme === 'dark' ? '#e5e5e5' : '#1a1a1a' }}
                      title="Magic Generate (选中≥2元素 → 截图生成)"
                    >
                      <Wand2 size={14} />
                      Magic Generate
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleAddToChat}
                      className="excalidraw-popbar__btn"
                      style={{ color: theme === 'dark' ? '#e5e5e5' : '#1a1a1a' }}
                      title="加入对话 (选中图片 → 发送到画布助手)"
                    >
                      <MessageCircle size={14} />
                      加入对话
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* PromptBar: only shows when elements are selected, follows selection */}
        {bottomBar && promptBarPos && (
          <div
            className="excalidraw-stage-bottombar"
            style={{ left: promptBarPos.left, top: promptBarPos.top, right: 'auto', bottom: 'auto', transform: 'translateX(-50%)' }}
          >
            {bottomBar}
          </div>
        )}
      </div>
    </div>
  );
}

function clipToUpdate(patch: { x?: number; y?: number; width?: number; height?: number; partial: Record<string, unknown> }) {
  const out: Record<string, unknown> = {};
  if (typeof patch.x === 'number') out.x = patch.x;
  if (typeof patch.y === 'number') out.y = patch.y;
  if (typeof patch.width === 'number') out.width = patch.width;
  if (typeof patch.height === 'number') out.height = patch.height;
  Object.assign(out, patch.partial);
  return out;
}

/**
 * Minimal instantiation of a brand-new Flovart Element created by user drawing inside Excalidraw.
 * For phase A we accept the most common shapes; unrecognized elements are ignored.
 */
function instantiateFromExcalidraw(exEl: ExcalidrawElementLike): FlovartElement | null {
  const id = allocateFlovartIdFromExcalidraw(exEl);
  const cd = exEl.customData as { flovartType?: string } | undefined;
  if (cd?.flovartType) return null; // already a managed Flovart element
  switch (exEl.type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
      return {
        id,
        type: 'shape',
        name: exEl.type === 'rectangle' ? 'Rectangle' : exEl.type === 'ellipse' ? 'Circle' : 'Triangle',
        shapeType: exEl.type === 'rectangle' ? 'rectangle' : exEl.type === 'ellipse' ? 'circle' : 'triangle',
        x: exEl.x,
        y: exEl.y,
        width: exEl.width,
        height: exEl.height,
        strokeColor: exEl.strokeColor,
        strokeWidth: exEl.strokeWidth ?? 2,
        fillColor: exEl.backgroundColor ?? 'transparent',
      } as unknown as FlovartElement;
    case 'text':
      return {
        id,
        type: 'text',
        name: 'Text',
        x: exEl.x,
        y: exEl.y,
        width: exEl.width,
        height: exEl.height,
        text: exEl.text ?? '',
        fontSize: exEl.fontSize ?? 20,
        fontColor: exEl.strokeColor ?? '#1b1b1f',
      } as unknown as FlovartElement;
    case 'line':
    case 'arrow': {
      const pts = exEl.points ?? [{ x: 0, y: 0 }, { x: 0, y: 0 }];
      return {
        id,
        type: exEl.type === 'arrow' ? 'arrow' : 'line',
        name: exEl.type === 'arrow' ? 'Arrow' : 'Line',
        x: exEl.x + pts[0].x,
        y: exEl.y + pts[0].y,
        points: pts.map(p => ({ x: exEl.x + p.x, y: exEl.y + p.y })),
        strokeColor: exEl.strokeColor,
        strokeWidth: exEl.strokeWidth ?? 2,
      } as unknown as FlovartElement;
    }
    case 'freedraw':
      return {
        id,
        type: 'path',
        name: 'Path',
        x: 0,
        y: 0,
        points: (exEl.points ?? []).map(p => ({ x: p.x + exEl.x, y: p.y + exEl.y })),
        strokeColor: exEl.strokeColor,
        strokeWidth: exEl.strokeWidth ?? 2,
        strokeOpacity: (exEl.opacity ?? 100) / 100,
      } as unknown as FlovartElement;
    default:
      return null;
  }
}