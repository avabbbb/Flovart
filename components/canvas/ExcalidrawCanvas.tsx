import { useCallback, useRef, useState, useEffect } from 'react';
import { nanoid } from 'nanoid';
import { Copy, Trash2 } from 'lucide-react';
import { ExcalidrawInner, type ExcalidrawElementInfo, type ExcalidrawViewport } from './ExcalidrawInner';
import { FlovartToolbar } from './FlovartToolbar';
import { ExcalidrawLayerPanel } from './ExcalidrawLayerPanel';
import { PromptBar } from '../PromptBar';
import { translations } from '../utils/translations';
import './excalidraw-canvas.css';

type Tool = 'selection' | 'rectangle' | 'diamond' | 'ellipse' | 'arrow' | 'line' | 'draw' | 'text' | 'image' | 'eraser' | 'hand';

interface ExcalidrawCanvasProps {
  theme: 'light' | 'dark';
  onToggleBack?: () => void;
}

export function ExcalidrawCanvas({ theme, onToggleBack }: ExcalidrawCanvasProps) {
  const apiRef = useRef<any>(null);
  const [activeTool, setActiveTool] = useState<Tool>('selection');
  const [elements, setElements] = useState<ExcalidrawElementInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewport, setViewport] = useState<ExcalidrawViewport>({ x: 0, y: 0, zoom: 1 });
  const [promptText, setPromptText] = useState('');
  const [promptDocument, setPromptDocument] = useState<Record<string, unknown> | undefined>(undefined);
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);

  const handleApiReady = useCallback((api: any) => { apiRef.current = api; }, []);

  const handleSceneChange = useCallback((els: ExcalidrawElementInfo[], selIds: string[], vp: ExcalidrawViewport) => {
    setElements(els);
    setSelectedIds(selIds);
    setViewport(vp);
  }, []);

  const handleToolChange = useCallback((tool: Tool) => {
    const api = apiRef.current;
    if (!api) return;
    setActiveTool(tool);
    const mapping: Record<string, string> = {
      selection: 'selection', hand: 'hand', rectangle: 'rectangle', ellipse: 'ellipse',
      diamond: 'diamond', arrow: 'arrow', line: 'line', draw: 'freedraw',
      text: 'text', image: 'image', eraser: 'eraser',
    };
    api.setActiveTool({ type: mapping[tool] || 'selection' });
  }, []);

  const handleAddImage = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const fileId = nanoid();
        api.addFiles([{ id: fileId, dataURL: dataUrl, mimeType: file.type }]);
        const els = api.getSceneElements();
        api.updateScene({
          elements: [...els, {
            type: 'image', id: nanoid(), x: 100, y: 100, width: 400, height: 300,
            fileId, strokeColor: 'transparent', backgroundColor: 'transparent',
            fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0,
            opacity: 100, angle: 0, seed: Math.floor(Math.random() * 1000000), version: 1,
            versionNonce: Math.floor(Math.random() * 1000000), isDeleted: false, groupIds: [],
            boundElements: [], updated: Date.now(), frameId: null, index: null,
            locked: false, scale: [1, 1] as [number, number],
          }],
        });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, []);

  const handleAddVideo = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const els = api.getSceneElements();
      api.updateScene({
        elements: [...els, {
          type: 'embeddable', id: nanoid(), x: 200, y: 200, width: 480, height: 270,
          link: url, strokeColor: 'transparent', backgroundColor: 'transparent',
          fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0,
          opacity: 100, angle: 0, seed: Math.floor(Math.random() * 1000000), version: 1,
          versionNonce: Math.floor(Math.random() * 1000000), isDeleted: false, groupIds: [],
          boundElements: [], updated: Date.now(), frameId: null, index: null, locked: false,
        }],
      });
    };
    input.click();
  }, []);

  const handleDelete = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const state = api.getAppState();
    const ids = Object.keys(state.selectedElementIds || {});
    if (!ids.length) return;
    api.updateScene({ elements: api.getSceneElements().map((e: any) => ids.includes(e.id) ? { ...e, isDeleted: true } : e) });
  }, []);

  const handleZoomIn = useCallback(() => {
    const api = apiRef.current; if (!api) return;
    api.updateScene({ appState: { zoom: { value: (api.getAppState().zoom?.value || 1) * 1.2 } } });
  }, []);
  const handleZoomOut = useCallback(() => {
    const api = apiRef.current; if (!api) return;
    api.updateScene({ appState: { zoom: { value: Math.max(0.1, (api.getAppState().zoom?.value || 1) / 1.2) } } });
  }, []);
  const handleZoomReset = useCallback(() => {
    apiRef.current?.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.8 });
  }, []);

  const handleContextMenu = useCallback((event: MouseEvent, ids: string[]) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, ids });
  }, []);

  // 图层面板操作
  const handleLayerSelect = useCallback((id: string, additive?: boolean) => {
    const api = apiRef.current; if (!api) return;
    if (additive) {
      const current = new Set(selectedIds);
      if (current.has(id)) current.delete(id); else current.add(id);
      api.selectElements([...current]);
    } else {
      api.selectElements([id]);
    }
  }, [selectedIds]);

  const handleLayerToggleVisible = useCallback((id: string) => {
    const api = apiRef.current; if (!api) return;
    const els = api.getSceneElements().map((e: any) => {
      if (e.id !== id) return e;
      const hidden = e.customData?.flovartHidden === true;
      return { ...e, customData: { ...e.customData, flovartHidden: !hidden }, opacity: hidden ? (e.customData?.flovartOpacity ?? 100) : 0 };
    });
    api.updateScene({ elements: els });
  }, []);

  const handleLayerToggleLock = useCallback((id: string) => {
    const api = apiRef.current; if (!api) return;
    const els = api.getSceneElements().map((e: any) => e.id === id ? { ...e, locked: !e.locked } : e);
    api.updateScene({ elements: els });
  }, []);

  const handleLayerDelete = useCallback((id: string) => {
    const api = apiRef.current; if (!api) return;
    api.updateScene({ elements: api.getSceneElements().map((e: any) => e.id === id ? { ...e, isDeleted: true } : e) });
  }, []);

  const handleLayerRename = useCallback((id: string, name: string) => {
    const api = apiRef.current; if (!api) return;
    const els = api.getSceneElements().map((e: any) => e.id === id ? { ...e, name } : e);
    api.updateScene({ elements: els });
  }, []);

  const handleLayerReorder = useCallback((draggedId: string, targetId: string, position: 'before' | 'after') => {
    const api = apiRef.current; if (!api) return;
    const els = [...api.getSceneElements()];
    const fromIdx = els.findIndex(e => e.id === draggedId);
    if (fromIdx === -1) return;
    const [moved] = els.splice(fromIdx, 1);
    let toIdx = els.findIndex(e => e.id === targetId);
    if (toIdx === -1) { els.push(moved); api.updateScene({ elements: els }); return; }
    if (position === 'after') toIdx += 1;
    els.splice(toIdx, 0, moved);
    api.updateScene({ elements: els });
  }, []);

  useEffect(() => {
    const close = () => setContextMenu(null);
    if (contextMenu) { window.addEventListener('click', close); return () => window.removeEventListener('click', close); }
  }, [contextMenu]);

  // 选中元素的 PromptBar mentionItems
  const mentionItems = elements
    .filter(el => !selectedIds.includes(el.id))
    .map(el => ({
      id: el.id,
      label: el.name || `${el.type} ${el.id.slice(-4)}`,
      thumbnail: '',
      elementType: el.type === 'embeddable' ? 'video' : el.type === 'image' ? 'image' : 'text',
      description: el.type,
    }));

  const hasSelection = selectedIds.length > 0;
  const selectedElement = elements.find(e => selectedIds.includes(e.id));
  const isMediaElement = selectedElement?.type === 'image' || selectedElement?.type === 'embeddable';

  // ElementToolbar 定位
  const elementToolbarPos = (() => {
    if (selectedIds.length === 0) return null;
    const el = elements.find(e => e.id === selectedIds[0]);
    if (!el) return null;
    return { x: el.x + viewport.x + el.width / 2, y: el.y + viewport.y - 44 };
  })();

  const t = useCallback((key: string) => key, []);

  return (
    <div className="excalidraw-wrapper">
      <div className="excalidraw-toolbar-dev">
        <button type="button" onClick={onToggleBack}>← 返回 Konva</button>
        <span className="excalidraw-toolbar-dev__label">Excalidraw 验证 · 阶段 2</span>
        <button type="button" onClick={handleAddImage}>+ 图片</button>
        <button type="button" onClick={handleAddVideo}>+ 视频</button>
        <span className="excalidraw-toolbar-dev__status">
          {hasSelection ? `已选 ${selectedIds.length} · zoom ${Math.round(viewport.zoom * 100)}%` : `zoom ${Math.round(viewport.zoom * 100)}%`}
        </span>
      </div>
      <div className="excalidraw-container">
        <ExcalidrawInner
          theme={theme}
          onApiReady={handleApiReady}
          onSceneChange={handleSceneChange}
          onContextMenu={handleContextMenu}
        />
      </div>

      {/* 图层面板 */}
      <ExcalidrawLayerPanel
        elements={elements}
        selectedIds={selectedIds}
        onSelect={handleLayerSelect}
        onToggleVisible={handleLayerToggleVisible}
        onToggleLock={handleLayerToggleLock}
        onDelete={handleLayerDelete}
        onRename={handleLayerRename}
        onReorder={handleLayerReorder}
      />

      {/* Flovart 自定义工具栏 */}
      <FlovartToolbar
        activeTool={activeTool}
        onToolChange={handleToolChange}
        onUndo={() => apiRef.current?.history?.back?.()}
        onRedo={() => apiRef.current?.history?.forward?.()}
        onDelete={handleDelete}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        canUndo={true}
        canRedo={true}
        hasSelection={hasSelection}
      />

      {/* ElementToolbar 覆盖层 */}
      {elementToolbarPos && hasSelection && (
        <div className="excalidraw-element-toolbar" style={{ left: elementToolbarPos.x, top: elementToolbarPos.y, transform: 'translateX(-50%)' }}>
          <button type="button" className="isl-icon-btn h-8 w-8" aria-label="复制" onClick={() => {
            const api = apiRef.current; if (!api) return;
            selectedIds.forEach(id => {
              const el = api.getSceneElements().find((e: any) => e.id === id);
              if (el) {
                api.updateScene({ elements: [...api.getSceneElements(), {
                  ...el, id: nanoid(), x: el.x + 20, y: el.y + 20,
                  version: 1, versionNonce: Math.floor(Math.random() * 1000000),
                }] });
              }
            });
          }}><Copy size={16} /></button>
          <button type="button" className="isl-icon-btn h-8 w-8" aria-label="删除" onClick={handleDelete}><Trash2 size={16} /></button>
        </div>
      )}

      {/* PromptBar 覆盖层（带 @ 引用） */}
      {hasSelection && selectedIds.length === 1 && isMediaElement && (
        <div className="excalidraw-prompt-overlay" onWheel={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
          <PromptBar
            t={t as any}
            theme={theme}
            compactMode
            prompt={promptText}
            promptDocument={promptDocument}
            setPrompt={v => { setPromptText(v); setPromptDocument(undefined); setMentionedIds([]); }}
            onPromptInputChange={({ plainText, document, mentionedElementIds }) => {
              setPromptText(plainText);
              setPromptDocument(document);
              setMentionedIds(mentionedElementIds);
            }}
            onGenerate={() => console.log('[ExcalidrawCanvas] generate', { prompt: promptText, mentionedIds })}
            isLoading={false}
            isSelectionActive={false}
            selectedElementCount={1}
            userEffects={[]}
            onAddUserEffect={() => undefined}
            onDeleteUserEffect={() => undefined}
            generationMode={selectedElement?.type === 'embeddable' ? 'video' : 'image'}
            setGenerationMode={() => undefined}
            modeOptions={selectedElement?.type === 'embeddable' ? ['video'] : ['image']}
            canvasElements={[]}
            mentionItems={mentionItems}
            variant="inline"
            shellClassName="inline-prompt-bar-shell"
            popoverDirection="up"
          />
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div className="excalidraw-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
          <button type="button" onClick={() => { handleDelete(); setContextMenu(null); }}><Trash2 size={14} />删除</button>
          <button type="button" onClick={() => {
            const api = apiRef.current; if (!api) return;
            contextMenu.ids.forEach(id => {
              const el = api.getSceneElements().find((e: any) => e.id === id);
              if (el) api.updateScene({ elements: [...api.getSceneElements(), { ...el, id: nanoid(), x: el.x + 20, y: el.y + 20, version: 1, versionNonce: Math.floor(Math.random() * 1000000) }] });
            });
            setContextMenu(null);
          }}><Copy size={14} />复制</button>
        </div>
      )}
    </div>
  );
}
