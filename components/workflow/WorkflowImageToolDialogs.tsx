import { Button, Input, Modal, Segmented, Slider } from 'antd';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ImageFilterPanel, buildCssFilter } from '../ImageFilterPanel';
import type { ImageFilters } from '../../types';
import type { WorkflowCropRect } from './media';
import type { WorkflowNode } from './types';

export type WorkflowImageToolKind = 'crop' | 'filter' | 'upscale' | 'remove-background' | 'outpaint' | 'mask' | 'split';
export interface WorkflowImageToolState { kind: WorkflowImageToolKind; nodeId: string }
export type WorkflowImageToolConfirmation =
  | { kind: 'crop'; crop: WorkflowCropRect }
  | { kind: 'filter'; filters: Partial<ImageFilters> }
  | { kind: 'upscale'; targetLongEdge: number; algorithm: 'high' | 'bilinear' | 'nearest' }
  | { kind: 'outpaint'; direction: 'left' | 'right' | 'top' | 'bottom' | 'all'; prompt: string }
  | { kind: 'mask'; prompt: string; maskDataUrl: string }
  | { kind: 'split' };

export function WorkflowImageToolDialogs({ tool, node, mediaUrl, busy, error, onClose, onConfirm }: {
  tool: WorkflowImageToolState | null;
  node: WorkflowNode | null;
  mediaUrl: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (payload: WorkflowImageToolConfirmation) => void;
}) {
  if (!tool || !node || !mediaUrl) return null;
  const common = { open: true, mediaUrl, busy, error, onClose };
  if (tool.kind === 'crop') return <CropDialog {...common} onConfirm={crop => onConfirm({ kind: 'crop', crop })} />;
  if (tool.kind === 'filter') return <FilterDialog {...common} filters={node.metadata.filters || {}} onConfirm={filters => onConfirm({ kind: 'filter', filters })} />;
  if (tool.kind === 'upscale') return <UpscaleDialog {...common} onConfirm={(targetLongEdge, algorithm) => onConfirm({ kind: 'upscale', targetLongEdge, algorithm })} />;
  if (tool.kind === 'outpaint') return <OutpaintDialog {...common} onConfirm={(direction, prompt) => onConfirm({ kind: 'outpaint', direction, prompt })} />;
  if (tool.kind === 'mask') return <MaskDialog {...common} onConfirm={(prompt, maskDataUrl) => onConfirm({ kind: 'mask', prompt, maskDataUrl })} />;
  if (tool.kind === 'split') return <SimpleConfirmDialog {...common} title="拆分图层" description="AI 会识别主体、背景和独立物体，并在右侧创建相连的图片节点。" action="拆分图层" onConfirm={() => onConfirm({ kind: 'split' })} />;
  return null;
}

type CommonProps = { open: boolean; mediaUrl: string; busy: boolean; error: string | null; onClose: () => void };
const modalProps = (props: CommonProps, width = 820) => ({ open: props.open, onCancel: props.busy ? undefined : props.onClose, footer: null, centered: true, width, destroyOnHidden: true, maskClosable: !props.busy });

function DialogError({ error }: { error: string | null }) {
  return error ? <div role="alert" className="workflow-image-tool__error">{error}</div> : null;
}

function CropDialog(props: CommonProps & { onConfirm: (crop: WorkflowCropRect) => void }) {
  const [crop, setCrop] = useState<WorkflowCropRect>({ x: .1, y: .1, width: .8, height: .8 });
  const update = (key: keyof WorkflowCropRect, value: number) => setCrop(current => {
    const next = { ...current, [key]: value / 100 };
    next.width = Math.min(next.width, 1 - next.x);
    next.height = Math.min(next.height, 1 - next.y);
    return next;
  });
  return <Modal {...modalProps(props)} title="裁剪图片">
    <div className="workflow-image-tool__grid" data-workflow-overlay>
      <div className="workflow-image-tool__preview">
        <img src={props.mediaUrl} alt="裁剪预览" draggable={false} />
        <div className="workflow-image-tool__crop" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }} />
      </div>
      <div className="workflow-image-tool__controls">
        {([['x', '左边界'], ['y', '上边界'], ['width', '宽度'], ['height', '高度']] as const).map(([key, label]) => <label key={key}>{label}<Slider min={key === 'width' || key === 'height' ? 5 : 0} max={100} value={Math.round(crop[key] * 100)} onChange={value => update(key, value)} /></label>)}
        <DialogError error={props.error} />
        <Button type="primary" loading={props.busy} onClick={() => props.onConfirm(crop)}>应用裁剪</Button>
      </div>
    </div>
  </Modal>;
}

function FilterDialog(props: CommonProps & { filters: Partial<ImageFilters>; onConfirm: (filters: Partial<ImageFilters>) => void }) {
  const [filters, setFilters] = useState(props.filters);
  useEffect(() => setFilters(props.filters), [props.filters]);
  return <Modal {...modalProps(props)} title="图片调色">
    <div className="workflow-image-tool__grid" data-workflow-overlay>
      <div className="workflow-image-tool__preview"><img src={props.mediaUrl} alt="滤镜预览" style={{ filter: buildCssFilter(filters) }} /></div>
      <div className="workflow-image-tool__controls"><ImageFilterPanel filters={filters} onChange={setFilters} onReset={() => setFilters({})} onClose={props.onClose} /><DialogError error={props.error} /><Button type="primary" loading={props.busy} onClick={() => props.onConfirm(filters)}>完成调色</Button></div>
    </div>
  </Modal>;
}

function UpscaleDialog(props: CommonProps & { onConfirm: (target: number, algorithm: 'high' | 'bilinear' | 'nearest') => void }) {
  const [target, setTarget] = useState(2048);
  const [algorithm, setAlgorithm] = useState<'high' | 'bilinear' | 'nearest'>('high');
  return <Modal {...modalProps(props)} title="高清放大">
    <div className="workflow-image-tool__grid" data-workflow-overlay>
      <div className="workflow-image-tool__preview"><img src={props.mediaUrl} alt="放大预览" /></div>
      <div className="workflow-image-tool__controls">
        <label>目标长边<Segmented block value={target} options={[{ label: '1K', value: 1024 }, { label: '2K', value: 2048 }, { label: '4K', value: 4096 }]} onChange={value => setTarget(Number(value))} /></label>
        <label>处理算法<Segmented block value={algorithm} options={[{ label: '高清', value: 'high' }, { label: '平滑', value: 'bilinear' }, { label: '像素', value: 'nearest' }]} onChange={value => setAlgorithm(value as typeof algorithm)} /></label>
        <DialogError error={props.error} /><Button type="primary" loading={props.busy} onClick={() => props.onConfirm(target, algorithm)}>开始放大</Button>
      </div>
    </div>
  </Modal>;
}

function OutpaintDialog(props: CommonProps & { onConfirm: (direction: 'left' | 'right' | 'top' | 'bottom' | 'all', prompt: string) => void }) {
  const [direction, setDirection] = useState<'left' | 'right' | 'top' | 'bottom' | 'all'>('right');
  const [prompt, setPrompt] = useState('自然延展画面，保持原图风格、光影和透视一致');
  return <Modal {...modalProps(props)} title="扩展画面"><div className="workflow-image-tool__grid" data-workflow-overlay>
    <div className="workflow-image-tool__preview"><img src={props.mediaUrl} alt="扩图预览" /></div>
    <div className="workflow-image-tool__controls"><label>扩展方向<Segmented block value={direction} options={[['left', '左'], ['right', '右'], ['top', '上'], ['bottom', '下'], ['all', '四周']].map(([value, label]) => ({ value, label }))} onChange={value => setDirection(value as typeof direction)} /></label><label>扩图要求<Input.TextArea rows={6} value={prompt} onChange={event => setPrompt(event.target.value)} /></label><DialogError error={props.error} /><Button type="primary" loading={props.busy} disabled={!prompt.trim()} onClick={() => props.onConfirm(direction, prompt.trim())}>开始扩展</Button></div>
  </div></Modal>;
}

function MaskDialog(props: CommonProps & { onConfirm: (prompt: string, mask: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const [prompt, setPrompt] = useState('修改涂抹区域，保持未选区域不变');
  const [brush, setBrush] = useState(42);
  const [hasMask, setHasMask] = useState(false);
  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * event.currentTarget.width, y: (event.clientY - rect.top) / rect.height * event.currentTarget.height };
  };
  const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const next = point(event); const context = event.currentTarget.getContext('2d'); if (!context) return;
    context.strokeStyle = '#fff'; context.lineWidth = brush; context.lineCap = 'round'; context.beginPath(); context.moveTo(last.current.x, last.current.y); context.lineTo(next.x, next.y); context.stroke(); last.current = next; setHasMask(true);
  };
  const submit = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const mask = document.createElement('canvas'); mask.width = canvas.width; mask.height = canvas.height;
    const context = mask.getContext('2d'); if (!context) return;
    context.fillStyle = '#fff'; context.fillRect(0, 0, mask.width, mask.height); context.globalCompositeOperation = 'destination-out'; context.drawImage(canvas, 0, 0);
    props.onConfirm(prompt.trim(), mask.toDataURL('image/png'));
  };
  return <Modal {...modalProps(props, 900)} title="局部遮罩编辑"><div className="workflow-image-tool__grid" data-workflow-overlay>
    <div className="workflow-image-tool__mask"><img src={props.mediaUrl} alt="蒙版编辑" onLoad={event => { const canvas = canvasRef.current; if (!canvas) return; canvas.width = event.currentTarget.naturalWidth || 1024; canvas.height = event.currentTarget.naturalHeight || 768; }} /><canvas ref={canvasRef} width={1024} height={768} onPointerDown={event => { drawing.current = true; last.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={draw} onPointerUp={() => { drawing.current = false; }} /></div>
    <div className="workflow-image-tool__controls"><label>笔刷大小<Slider min={8} max={160} value={brush} onChange={setBrush} /></label><label>修改要求<Input.TextArea rows={6} value={prompt} onChange={event => setPrompt(event.target.value)} /></label><Button onClick={() => { const canvas = canvasRef.current; canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); setHasMask(false); }}>重置蒙版</Button><DialogError error={props.error} /><Button type="primary" loading={props.busy} disabled={!prompt.trim() || !hasMask} onClick={submit}>AI 修改</Button></div>
  </div></Modal>;
}

function SimpleConfirmDialog(props: CommonProps & { title: string; description: string; action: string; onConfirm: () => void }) {
  return <Modal {...modalProps(props, 620)} title={props.title}><div className="workflow-image-tool__simple" data-workflow-overlay><div className="workflow-image-tool__preview"><img src={props.mediaUrl} alt="工具预览" /></div><p>{props.description}</p><DialogError error={props.error} /><Button type="primary" loading={props.busy} onClick={props.onConfirm}>{props.action}</Button></div></Modal>;
}
