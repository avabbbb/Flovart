import { memo, useCallback, useRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

export interface ExcalidrawElementInfo {
  id: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  locked?: boolean;
  customData?: Record<string, unknown>;
}

export interface ExcalidrawViewport {
  x: number;
  y: number;
  zoom: number;
}

interface ExcalidrawInnerProps {
  theme: 'light' | 'dark';
  onApiReady: (api: any) => void;
  onSceneChange: (elements: ExcalidrawElementInfo[], selectedIds: string[], viewport: ExcalidrawViewport) => void;
  onContextMenu: (event: MouseEvent, selectedIds: string[]) => void;
}

const ExcalidrawInner = memo<ExcalidrawInnerProps>(({ theme, onApiReady, onSceneChange, onContextMenu }) => {
  const onSceneRef = useRef(onSceneChange);
  const onContextRef = useRef(onContextMenu);
  onSceneRef.current = onSceneChange;
  onContextRef.current = onContextMenu;
  const apiRef = useRef<any>(null);

  const handleChange = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const appState = api.getAppState();
    const selectedIds = Object.keys(appState.selectedElementIds || {});
    const allElements = api.getSceneElements();
    const infos: ExcalidrawElementInfo[] = allElements
      .filter((e: any) => !e.isDeleted)
      .map((e: any) => ({
        id: e.id, type: e.type, name: e.name, x: e.x, y: e.y,
        width: e.width, height: e.height, locked: e.locked,
        isDeleted: e.isDeleted, customData: e.customData,
      }));
    onSceneRef.current(infos, selectedIds, {
      x: appState.scrollX || 0, y: appState.scrollY || 0, zoom: appState.zoom?.value || 1,
    });
  }, []);

  return (
    <Excalidraw
      theme={theme}
      excalidrawAPI={(api: any) => { apiRef.current = api; onApiReady(api); }}
      onChange={handleChange}
      onContextMenu={(event: any) => {
        const api = apiRef.current;
        if (!api) return;
        const selectedIds = Object.keys(api.getAppState().selectedElementIds || {});
        onContextRef.current(event.nativeEvent || event, selectedIds);
      }}
      initialData={{
        elements: [],
        appState: {
          zoom: 1, scrollX: 0, scrollY: 0,
          viewBackgroundColor: theme === 'dark' ? '#1a1917' : '#f1efe9',
        },
      }}
      UIOptions={{
        canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: true },
        tools: { image: true },
      }}
      viewModeEnabled={false}
      zenModeEnabled={false}
      gridModeEnabled={false}
      validateEmbeddable
      renderEmbeddable={(element: any) => {
        if (element.link && (element.link.includes('.mp4') || element.link.includes('.webm') || element.link.startsWith('blob:'))) {
          return <video src={element.link} controls style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
        }
        return null;
      }}
    />
  );
}, () => true);

ExcalidrawInner.displayName = 'ExcalidrawInner';

export { ExcalidrawInner };
