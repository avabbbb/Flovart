import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { appendLassoPoint, drawLassoPreview, toLassoPoint, type LassoPoint } from './lasso';

// 节点内套索：覆盖在图片预览上的 canvas。data-workflow-overlay + pointer capture 让画布拖拽/框选不接管指针；Esc 取消。
// onDone：null 取消；[] 作用于整张图；否则为原图像素坐标的闭合路径。
export function WorkflowNodeLasso({ width, height, language = 'zho', onDone }: {
  width?: number;
  height?: number;
  language?: 'en' | 'zho';
  onDone: (points: LassoPoint[] | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [size, setSize] = useState(() => (width && height ? { width, height } : null));
  const [points, setPoints] = useState<LassoPoint[]>([]);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (size) return;
    const image = canvasRef.current?.parentElement?.parentElement?.querySelector<HTMLImageElement>('img[data-workflow-media-preview]');
    if (!image) return;
    const read = () => { if (image.naturalWidth && image.naturalHeight) setSize({ width: image.naturalWidth, height: image.naturalHeight }); };
    read();
    image.addEventListener('load', read);
    return () => image.removeEventListener('load', read);
  }, [size]);
  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (context) drawLassoPreview(context, points, closed);
  }, [points, closed, size]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onDoneRef.current(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
  const en = language === 'en';
  const hasLasso = closed && points.length >= 3;
  const toPoint = (event: ReactPointerEvent<HTMLCanvasElement>, area: { width: number; height: number }) =>
    toLassoPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), area.width, area.height, 'contain');
  const finishStroke = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setPoints(current => (current.length >= 3 ? current : []));
    setClosed(true);
  };
  return (
    <div className="workflow-node-lasso" data-workflow-overlay onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}>
      <canvas
        ref={canvasRef}
        width={size?.width || 1}
        height={size?.height || 1}
        data-testid="workflow-node-lasso"
        aria-label={en ? 'Lasso the overlay area on the image' : '在图上圈选叠加区域'}
        onPointerDown={event => {
          if (!size || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          setClosed(false);
          setPoints([toPoint(event, size)]);
        }}
        onPointerMove={event => {
          if (!drawing.current || !size) return;
          const next = toPoint(event, size);
          setPoints(current => appendLassoPoint(current, next));
        }}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
      />
      <div className="workflow-node-lasso__bar" role="toolbar" aria-label={en ? 'Overlay area' : '叠加区域'}>
        <span>{hasLasso ? (en ? 'Area selected' : '已圈选区域') : (en ? 'Drag to lasso; skip for whole image' : '拖动圈选；不圈则作用于整图')}</span>
        <button type="button" onClick={() => onDone(null)}>{en ? 'Cancel' : '取消'}</button>
        <button type="button" disabled={!points.length} onClick={() => { setPoints([]); setClosed(false); }}>{en ? 'Clear' : '清除'}</button>
        <button type="button" className="is-primary" onClick={() => onDone(hasLasso ? points : [])}>{hasLasso ? (en ? 'Next' : '下一步') : (en ? 'Whole image' : '整图')}</button>
      </div>
    </div>
  );
}
