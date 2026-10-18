import { Button, Input, Modal, Segmented } from 'antd';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { appendLassoPoint, buildLassoMaskDataUrl, drawLassoPreview, toLassoPoint, type LassoPoint } from './lasso';
import { WORKFLOW_LAYER_STYLES, WORKFLOW_LAYER_STYLE_LABELS, type WorkflowLayerStyle } from './operationRegistry';

// 叠加层：自然语言 + 套索圈选。圈选区域导出为与 MaskDialog 同约定的蒙版（不透明白底，可编辑区透明）；不圈选则作用于整张图。
// initialPoints 来自节点内套索，坐标为原图像素，与本弹窗 canvas 尺寸一致。
export function WorkflowLayerDialog(props: {
  open: boolean; mediaUrl: string; busy: boolean; error: string | null; onClose: () => void;
  initialPoints?: readonly LassoPoint[];
  onConfirm: (prompt: string, style: WorkflowLayerStyle, count: number, maskDataUrl?: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const presetPoints = () => (props.initialPoints && props.initialPoints.length >= 3 ? [...props.initialPoints] : []);
  const [points, setPoints] = useState<LassoPoint[]>(presetPoints);
  const [closed, setClosed] = useState(() => presetPoints().length >= 3);
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<WorkflowLayerStyle>('doodle');
  const [count, setCount] = useState(4);
  const point = (event: ReactPointerEvent<HTMLCanvasElement>): LassoPoint => {
    const canvas = event.currentTarget;
    return toLassoPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height, 'contain');
  };
  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (context) drawLassoPreview(context, points, closed);
  }, [points, closed]);
  const hasLasso = closed && points.length >= 3;
  const submit = () => {
    const canvas = canvasRef.current;
    const maskDataUrl = hasLasso && canvas ? buildLassoMaskDataUrl(points, canvas.width, canvas.height) : undefined;
    props.onConfirm(prompt.trim(), style, count, maskDataUrl);
  };
  return <Modal open={props.open} onCancel={props.busy ? undefined : props.onClose} footer={null} centered width={900} destroyOnHidden mask={{ closable: !props.busy }} title="叠加层">
    <div className="workflow-image-tool__grid" data-workflow-overlay>
      <div className="workflow-image-tool__mask">
        <img src={props.mediaUrl} alt="叠加层圈选" draggable={false} onLoad={event => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.width = event.currentTarget.naturalWidth || 1024;
          canvas.height = event.currentTarget.naturalHeight || 768;
          const preset = presetPoints();
          setPoints(preset);
          setClosed(preset.length >= 3);
        }} />
        <canvas
          ref={canvasRef} width={1024} height={768} data-testid="workflow-layer-lasso" aria-label="在图上圈选叠加区域"
          onPointerDown={event => { drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); setClosed(false); setPoints([point(event)]); }}
          onPointerMove={event => {
            if (!drawing.current) return;
            const next = point(event);
            setPoints(current => appendLassoPoint(current, next));
          }}
          onPointerUp={() => { drawing.current = false; setPoints(current => (current.length >= 3 ? current : [])); setClosed(true); }}
        />
      </div>
      <div className="workflow-image-tool__controls">
        <p>{hasLasso ? '已圈选区域：叠加层只生成在圈内。' : '在图上拖动圈选位置；不圈选则作用于整张图。'}输出透明 PNG 叠加层，不修改原图。</p>
        <label>要加什么<Input.TextArea rows={4} value={prompt} placeholder="例如：在天空写上发光的标题" onChange={event => setPrompt(event.target.value)} /></label>
        <label>风格<Segmented block value={style} options={WORKFLOW_LAYER_STYLES.map(value => ({ value, label: WORKFLOW_LAYER_STYLE_LABELS[value] }))} onChange={value => setStyle(value as WorkflowLayerStyle)} /></label>
        <label>候选数量<Segmented block value={count} options={[1, 2, 3, 4].map(value => ({ value, label: String(value) }))} onChange={value => setCount(Number(value))} /></label>
        <Button disabled={!points.length} onClick={() => { setPoints([]); setClosed(false); }}>清除圈选</Button>
        {props.error ? <div role="alert" className="workflow-image-tool__error">{props.error}</div> : null}
        <Button type="primary" loading={props.busy} disabled={!prompt.trim()} onClick={submit}>生成 {count} 个候选</Button>
      </div>
    </div>
  </Modal>;
}
