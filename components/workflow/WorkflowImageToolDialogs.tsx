import { VECTORIZE_PRESET_LABELS, type VectorizePreset } from '../../services/vectorizeImage';
import { clampMoveOffset, tracePolygon, type NormalizedPoint } from '../../services/moveObjectCanvas';
import { computeOutpaintLayout, type OutpaintDirection } from '../../services/outpaintCanvas';
import { Button, Input, Modal, Segmented, Slider, ColorPicker } from 'antd';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ImageFilterPanel, buildCssFilter } from '../ImageFilterPanel';
import type { ImageFilters } from '../../types';
import type { WorkflowCropRect } from './media';
import type { WorkflowNode } from './types';
import { LIGHTING_PRESETS, type LightingPreset } from './LightingPresets';
import type { WorkflowLayerStyle } from './operationRegistry';
import { WorkflowLayerDialog } from './WorkflowLayerDialog';
import type { LassoPoint } from './lasso';

export type WorkflowImageToolKind = 'crop' | 'filter' | 'upscale' | 'remove-background' | 'outpaint' | 'mask' | 'split' | 'rotate' | 'splitGrid' | 'annotate' | 'relight' | 'restyle' | 'vectorize' | 'move' | 'storyboard' | 'layer';
export interface WorkflowImageToolState { kind: WorkflowImageToolKind; nodeId: string }
export type WorkflowImageToolConfirmation =
  | { kind: 'crop'; crop: WorkflowCropRect }
  | { kind: 'filter'; filters: Partial<ImageFilters> }
  | { kind: 'upscale'; targetLongEdge: number; algorithm: 'high' | 'bilinear' | 'nearest' }
  | { kind: 'outpaint'; direction: OutpaintDirection; amount: number; prompt: string }
  | { kind: 'mask'; prompt: string; maskDataUrl: string }
  | { kind: 'restyle'; prompt: string }
  | { kind: 'vectorize'; preset: VectorizePreset }
  | { kind: 'move'; points: NormalizedPoint[]; dx: number; dy: number; prompt: string }
  | { kind: 'split' }
  | { kind: 'rotate'; action: 'rotate-90' | 'rotate-180' | 'rotate-270' | 'flip-h' | 'flip-v' }
  | { kind: 'splitGrid'; rows: number; cols: number }
  | { kind: 'annotate'; annotatedDataUrl: string }
  | { kind: 'relight'; preset: string; intensity: number; color: string; smart: boolean }
  | { kind: 'storyboard'; cols: number; showIndex: boolean }
  | { kind: 'layer'; prompt: string; style: WorkflowLayerStyle; count: number; maskDataUrl?: string };

export function WorkflowImageToolDialogs({ tool, node, mediaUrl, busy, error, onClose, onPreview, onConfirm, layerPoints }: {
  tool: WorkflowImageToolState | null;
  node: WorkflowNode | null;
  mediaUrl: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onPreview?: (filters: Partial<ImageFilters>) => void;
  onConfirm: (payload: WorkflowImageToolConfirmation) => void;
  layerPoints?: readonly LassoPoint[];
}) {
  if (!tool || !node || !mediaUrl) return null;
  const common = { open: true, mediaUrl, busy, error, onClose };
  if (tool.kind === 'crop') return <CropDialog {...common} onConfirm={crop => onConfirm({ kind: 'crop', crop })} />;
  if (tool.kind === 'filter') return <FilterDialog {...common} filters={node.metadata.filters || {}} onPreview={onPreview} onConfirm={filters => onConfirm({ kind: 'filter', filters })} />;
  if (tool.kind === 'upscale') return <UpscaleDialog {...common} onConfirm={(targetLongEdge, algorithm) => onConfirm({ kind: 'upscale', targetLongEdge, algorithm })} />;
  if (tool.kind === 'outpaint') return <OutpaintDialog {...common} onConfirm={(direction, amount, prompt) => onConfirm({ kind: 'outpaint', direction, amount, prompt })} />;
  if (tool.kind === 'mask') return <MaskDialog {...common} onConfirm={(prompt, maskDataUrl) => onConfirm({ kind: 'mask', prompt, maskDataUrl })} />;
  if (tool.kind === 'restyle') return <RestyleDialog {...common} onConfirm={prompt => onConfirm({ kind: 'restyle', prompt })} />;
  if (tool.kind === 'split') return <SimpleConfirmDialog {...common} title="拆分图层" description="AI 会识别主体、背景和独立物体，并在右侧创建相连的图片节点。" action="拆分图层" onConfirm={() => onConfirm({ kind: 'split' })} />;
  if (tool.kind === 'move') return <MoveObjectDialog {...common} onConfirm={(points, dx, dy, prompt) => onConfirm({ kind: 'move', points, dx, dy, prompt })} />;
  if (tool.kind === 'vectorize') return <VectorizeDialog {...common} onConfirm={preset => onConfirm({ kind: 'vectorize', preset })} />;
  if (tool.kind === 'rotate') return <RotateFlipDialog {...common} onConfirm={action => onConfirm({ kind: 'rotate', action })} />;
  if (tool.kind === 'splitGrid') return <SplitGridDialog {...common} onConfirm={(rows, cols) => onConfirm({ kind: 'splitGrid', rows, cols })} />;
  if (tool.kind === 'annotate') return <AnnotateDialog {...common} onConfirm={dataUrl => onConfirm({ kind: 'annotate', annotatedDataUrl: dataUrl })} />;
  if (tool.kind === 'relight') return <RelightDialog {...common} onConfirm={(preset, intensity, color, smart) => onConfirm({ kind: 'relight', preset, intensity, color, smart })} />;
  if (tool.kind === 'storyboard') return <StoryboardDialog {...common} onConfirm={(cols, showIndex) => onConfirm({ kind: 'storyboard', cols, showIndex })} />;
  if (tool.kind === 'layer') return <WorkflowLayerDialog {...common} initialPoints={layerPoints} onConfirm={(prompt, style, count, maskDataUrl) => onConfirm({ kind: 'layer', prompt, style, count, maskDataUrl })} />;
  return null;
}

type CommonProps = { open: boolean; mediaUrl: string; busy: boolean; error: string | null; onClose: () => void };
const modalProps = (props: CommonProps, width = 820) => ({ open: props.open, onCancel: props.busy ? undefined : props.onClose, footer: null, centered: true, width, destroyOnHidden: true, mask: { closable: !props.busy } });

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

function FilterDialog(props: CommonProps & { filters: Partial<ImageFilters>; onPreview?: (filters: Partial<ImageFilters>) => void; onConfirm: (filters: Partial<ImageFilters>) => void }) {
  const [filters, setFilters] = useState(props.filters);
  useEffect(() => setFilters(props.filters), [props.filters]);
  return <Modal {...modalProps(props)} title="图片调色">
    <div className="workflow-image-tool__grid" data-workflow-overlay>
      <div className="workflow-image-tool__preview"><img src={props.mediaUrl} alt="滤镜预览" style={{ filter: buildCssFilter(filters) }} /></div>
      <div className="workflow-image-tool__controls"><ImageFilterPanel filters={filters} onChange={next => { setFilters(next); props.onPreview?.(next); }} onReset={() => { setFilters({}); props.onPreview?.({}); }} onClose={props.onClose} /><DialogError error={props.error} /><Button type="primary" loading={props.busy} disabled={props.busy} onClick={() => props.onConfirm(filters)}>完成调色</Button></div>
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

function OutpaintDialog(props: CommonProps & { onConfirm: (direction: OutpaintDirection, amount: number, prompt: string) => void }) {
  const [direction, setDirection] = useState<OutpaintDirection>('right');
  const [amount, setAmount] = useState(0.5);
  const [natural, setNatural] = useState({ width: 1024, height: 768 });
  const [prompt, setPrompt] = useState('');
  const layout = computeOutpaintLayout(natural.width, natural.height, direction, amount);
  return <Modal {...modalProps(props)} title="扩展画面"><div className="workflow-image-tool__grid" data-workflow-overlay>
    <div className="workflow-image-tool__preview"><div className="workflow-outpaint-frame" style={{ aspectRatio: layout.width + ' / ' + layout.height }}><img src={props.mediaUrl} alt="扩图预览" draggable={false} onLoad={event => setNatural({ width: event.currentTarget.naturalWidth || 1024, height: event.currentTarget.naturalHeight || 768 })} style={{ left: (layout.offsetX / layout.width * 100) + '%', top: (layout.offsetY / layout.height * 100) + '%', width: (layout.sourceWidth / layout.width * 100) + '%', height: (layout.sourceHeight / layout.height * 100) + '%' }} /></div></div>
    <div className="workflow-image-tool__controls">
      <label>扩展方向<Segmented block value={direction} options={[['left', '左'], ['right', '右'], ['top', '上'], ['bottom', '下'], ['all', '四周']].map(([value, label]) => ({ value, label }))} onChange={value => setDirection(value as OutpaintDirection)} /></label>
      <label>扩展幅度<Segmented block value={amount} options={[{ label: '25%', value: 0.25 }, { label: '50%', value: 0.5 }, { label: '100%', value: 1 }]} onChange={value => setAmount(Number(value))} /></label>
      <span className="workflow-outpaint-size">输出 {layout.width} x {layout.height}</span>
      <label>补充要求（可选）<Input.TextArea rows={4} value={prompt} placeholder="例如：右侧加一片海滩" onChange={event => setPrompt(event.target.value)} /></label>
      <DialogError error={props.error} />
      <Button type="primary" loading={props.busy} onClick={() => props.onConfirm(direction, amount, prompt.trim())}>开始扩展</Button>
    </div>
  </div></Modal>;
}

const ERASE_PROMPT = '移除涂抹区域内的物体或文字，用周围背景自然补全，不留痕迹；未涂抹区域保持不变。';

function MaskDialog(props: CommonProps & { onConfirm: (prompt: string, mask: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const [prompt, setPrompt] = useState('修改涂抹区域，保持未选区域不变');
  const [mode, setMode] = useState<'repaint' | 'erase'>('repaint');
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
    props.onConfirm(mode === 'erase' ? ERASE_PROMPT : prompt.trim(), mask.toDataURL('image/png'));
  };
  return <Modal {...modalProps(props, 900)} title="局部遮罩编辑"><div className="workflow-image-tool__grid" data-workflow-overlay>
    <div className="workflow-image-tool__mask"><img src={props.mediaUrl} alt="蒙版编辑" onLoad={event => { const canvas = canvasRef.current; if (!canvas) return; canvas.width = event.currentTarget.naturalWidth || 1024; canvas.height = event.currentTarget.naturalHeight || 768; }} /><canvas ref={canvasRef} width={1024} height={768} onPointerDown={event => { drawing.current = true; last.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={draw} onPointerUp={() => { drawing.current = false; }} /></div>
    <div className="workflow-image-tool__controls"><label>笔刷大小<Slider min={8} max={160} value={brush} onChange={setBrush} /></label><label>模式<Segmented block value={mode} options={[{ label: '局部重绘', value: 'repaint' }, { label: '擦除', value: 'erase' }]} onChange={value => setMode(value as 'repaint' | 'erase')} /></label>{mode === 'repaint' ? <label>修改要求<Input.TextArea rows={6} value={prompt} onChange={event => setPrompt(event.target.value)} /></label> : <p>涂抹要去掉的物体、文字或路人，AI 会用周围背景补全。</p>}<Button onClick={() => { const canvas = canvasRef.current; canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); setHasMask(false); }}>重置蒙版</Button><DialogError error={props.error} /><Button type="primary" loading={props.busy} disabled={(mode === 'repaint' && !prompt.trim()) || !hasMask} onClick={submit}>AI 修改</Button></div>
  </div></Modal>;
}

const RESTYLE_VIEWS = [['keep', '保持原视角', ''], ['front', '正面', '换成正面视角'], ['threeQuarter', '3/4 侧面', '换成四分之三侧面视角'], ['side', '侧面', '换成正侧面视角'], ['back', '背面', '换成背面视角'], ['top', '俯视', '换成俯视视角'], ['low', '仰视', '换成仰视视角'], ['closeup', '特写', '换成主体特写'], ['wide', '远景', '换成远景全身构图']] as const;
const RESTYLE_STYLES = [['keep', '保持原风格', ''], ['photo', '写实摄影', '转为写实摄影风格'], ['anime', '日系动画', '转为日系动画风格'], ['render', '3D 渲染', '转为 3D 渲染风格'], ['watercolor', '水彩', '转为水彩插画风格'], ['oil', '油画', '转为古典油画风格'], ['ink', '水墨', '转为中国水墨画风格'], ['line', '线稿', '转为黑白线稿'], ['pixel', '像素', '转为像素艺术风格']] as const;

function RestyleDialog(props: CommonProps & { onConfirm: (prompt: string) => void }) {
  const [view, setView] = useState<string>('keep');
  const [style, setStyle] = useState<string>('keep');
  const [extra, setExtra] = useState('');
  const prompt = [RESTYLE_VIEWS.find(item => item[0] === view)?.[2], RESTYLE_STYLES.find(item => item[0] === style)?.[2], extra.trim()].filter(Boolean).join('；');
  return <Modal {...modalProps(props)} title={'视角与风格'}><div className={'workflow-image-tool__grid'} data-workflow-overlay>
    <div className={'workflow-image-tool__preview'}><img src={props.mediaUrl} alt={'视角与风格预览'} /></div>
    <div className={'workflow-image-tool__controls'}>
      <div className={'workflow-restyle-group'}><span>视角</span><div className={'workflow-restyle-options'}>{RESTYLE_VIEWS.map(([value, label]) => <Button key={value} size={'small'} type={view === value ? 'primary' : 'default'} onClick={() => setView(value)}>{label}</Button>)}</div></div>
      <div className={'workflow-restyle-group'}><span>风格</span><div className={'workflow-restyle-options'}>{RESTYLE_STYLES.map(([value, label]) => <Button key={value} size={'small'} type={style === value ? 'primary' : 'default'} onClick={() => setStyle(value)}>{label}</Button>)}</div></div>
      <label>补充要求（可选）<Input.TextArea rows={3} value={extra} placeholder={'例如：换成夜景、加上雪'} onChange={event => setExtra(event.target.value)} /></label>
      <DialogError error={props.error} />
      <Button type={'primary'} loading={props.busy} disabled={!prompt} onClick={() => props.onConfirm('保持主体身份、外观细节和关键特征不变。' + prompt)}>生成新版本</Button>
    </div>
  </div></Modal>;
}

function SimpleConfirmDialog(props: CommonProps & { title: string; description: string; action: string; onConfirm: () => void }) {
  return <Modal {...modalProps(props, 620)} title={props.title}><div className="workflow-image-tool__simple" data-workflow-overlay><div className="workflow-image-tool__preview"><img src={props.mediaUrl} alt="工具预览" /></div><p>{props.description}</p><DialogError error={props.error} /><Button type="primary" loading={props.busy} onClick={props.onConfirm}>{props.action}</Button></div></Modal>;
}

function RotateFlipDialog(props: CommonProps & { onConfirm: (action: 'rotate-90' | 'rotate-180' | 'rotate-270' | 'flip-h' | 'flip-v') => void }) {
  return <Modal {...modalProps(props, 620)} title="旋转镜像">
    <div className="workflow-image-tool__simple" data-workflow-overlay>
      <div className="workflow-image-tool__preview"><img src={props.mediaUrl} alt="旋转预览" /></div>
      <div className="workflow-rotate-grid">
        <Button size="large" onClick={() => props.onConfirm('rotate-90')} loading={props.busy}>↻ 顺时针 90°</Button>
        <Button size="large" onClick={() => props.onConfirm('rotate-180')} loading={props.busy}>↻ 旋转 180°</Button>
        <Button size="large" onClick={() => props.onConfirm('rotate-270')} loading={props.busy}>↺ 逆时针 90°</Button>
        <Button size="large" onClick={() => props.onConfirm('flip-h')} loading={props.busy}>⇄ 水平翻转</Button>
        <Button size="large" onClick={() => props.onConfirm('flip-v')} loading={props.busy}>⇅ 垂直翻转</Button>
      </div>
      <DialogError error={props.error} />
    </div>
  </Modal>;
}

function SplitGridDialog(props: CommonProps & { onConfirm: (rows: number, cols: number) => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  return <Modal {...modalProps(props, 620)} title="宫格切分">
    <div className="workflow-image-tool__simple" data-workflow-overlay>
      <div className="workflow-image-tool__preview">
        <div className="workflow-grid-preview" style={{ gridTemplateRows: `repeat(${rows}, 1fr)`, gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: rows * cols }, (_, i) => <div key={i} className="workflow-grid-cell" style={{ backgroundImage: `url(${props.mediaUrl})`, backgroundSize: `${cols * 100}% ${rows * 100}%`, backgroundPosition: `${(i % cols) / (cols - 1) * 100}% ${Math.floor(i / cols) / (rows - 1) * 100}%` }} />)}
        </div>
      </div>
      <div className="workflow-image-tool__controls">
        <label>行数<Segmented block value={rows} options={[2, 3, 4, 5].map(n => ({ label: `${n} 行`, value: n }))} onChange={v => setRows(Number(v))} /></label>
        <label>列数<Segmented block value={cols} options={[2, 3, 4, 5].map(n => ({ label: `${n} 列`, value: n }))} onChange={v => setCols(Number(v))} /></label>
        <p className="workflow-image-tool__hint">将切分为 {rows * cols} 张独立图片，每张在右侧创建相连的图片节点。</p>
        <DialogError error={props.error} />
        <Button type="primary" loading={props.busy} onClick={() => props.onConfirm(rows, cols)}>切分为 {rows * cols} 张</Button>
      </div>
    </div>
  </Modal>;
}

function AnnotateDialog(props: CommonProps & { onConfirm: (annotatedDataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const [tool, setTool] = useState<'brush' | 'rect'>('brush');
  const [color, setColor] = useState('#ff4d4f');
  const [size, setSize] = useState(6);
  const startRect = useRef({ x: 0, y: 0 });
  const [hasAnnotation, setHasAnnotation] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * event.currentTarget.width, y: (event.clientY - rect.top) / rect.height * event.currentTarget.height };
  };
  const begin = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    last.current = point(event);
    startRect.current = last.current;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'rect') {
      const ctx = event.currentTarget.getContext('2d');
      if (ctx) setSnapshot(event.currentTarget.toDataURL());
    }
  };
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = event.currentTarget.getContext('2d');
    if (!ctx) return;
    const next = point(event);
    if (tool === 'brush') {
      ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(next.x, next.y); ctx.stroke(); last.current = next;
    } else {
      if (snapshot) { const img = new Image(); img.onload = () => { ctx.clearRect(0, 0, event.currentTarget.width, event.currentTarget.height); ctx.drawImage(img, 0, 0); ctx.strokeStyle = color; ctx.lineWidth = size; ctx.strokeRect(startRect.current.x, startRect.current.y, next.x - startRect.current.x, next.y - startRect.current.y); }; img.src = snapshot; }
    }
    setHasAnnotation(true);
  };
  const end = () => { drawing.current = false; };
  const submit = () => { const canvas = canvasRef.current; if (!canvas) return; props.onConfirm(canvas.toDataURL('image/png')); };
  const clear = () => { const canvas = canvasRef.current; canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); setHasAnnotation(false); };

  return <Modal {...modalProps(props, 900)} title="标注涂鸦">
    <div className="workflow-image-tool__grid" data-workflow-overlay>
      <div className="workflow-image-tool__mask">
        <img src={props.mediaUrl} alt="标注" onLoad={event => { const canvas = canvasRef.current; if (!canvas) return; canvas.width = event.currentTarget.naturalWidth || 1024; canvas.height = event.currentTarget.naturalHeight || 768; }} />
        <canvas ref={canvasRef} width={1024} height={768} onPointerDown={begin} onPointerMove={move} onPointerUp={end} />
      </div>
      <div className="workflow-image-tool__controls">
        <label>工具<Segmented block value={tool} options={[{ label: '画笔', value: 'brush' }, { label: '框选', value: 'rect' }]} onChange={v => setTool(v as typeof tool)} /></label>
        <label>颜色<ColorPicker value={color} onChange={c => setColor(c.toHexString())} /></label>
        <label>粗细<Slider min={2} max={40} value={size} onChange={setSize} /></label>
        <Button onClick={clear}>清空标注</Button>
        <DialogError error={props.error} />
        <Button type="primary" loading={props.busy} disabled={!hasAnnotation} onClick={submit}>发送给 AI</Button>
      </div>
    </div>
  </Modal>;
}

function RelightDialog(props: CommonProps & { onConfirm: (preset: string, intensity: number, color: string, smart: boolean) => void }) {
  const [presetId, setPresetId] = useState('rembrandt');
  const [intensity, setIntensity] = useState(5);
  const [color, setColor] = useState('#ffffff');
  const [smart, setSmart] = useState(true);
  const preset = LIGHTING_PRESETS.find(p => p.id === presetId)!;
  return <Modal {...modalProps(props, 720)} title="打光面板">
    <div className="workflow-image-tool__grid" data-workflow-overlay>
      <div className="workflow-image-tool__preview"><img src={props.mediaUrl} alt="打光预览" style={{ filter: `brightness(${1 + intensity * 0.05}) sepia(${color !== '#ffffff' ? 0.1 : 0})` }} /></div>
      <div className="workflow-image-tool__controls workflow-relight-controls">
        <div className="workflow-relight-presets">
          {(['main', 'rim'] as const).map(group => (
            <div key={group} className="workflow-relight-group">
              <span className="workflow-relight-group-label">{group === 'main' ? '主光' : '轮廓光'}</span>
              <div className="workflow-relight-buttons">
                {LIGHTING_PRESETS.filter(p => p.type === group).map(p => (
                  <button key={p.id} className={`workflow-relight-btn ${presetId === p.id ? 'active' : ''}`} onClick={() => setPresetId(p.id)} title={p.description}>{p.name}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <label>强度<Slider min={1} max={10} value={intensity} onChange={setIntensity} /></label>
        <label>色温<ColorPicker value={color} onChange={c => setColor(c.toHexString())} /></label>
        <label className="workflow-relight-smart"><input type="checkbox" checked={smart} onChange={e => setSmart(e.target.checked)} />智能分析场景后再打光</label>
        <p className="workflow-image-tool__hint">当前: {preset.name} · {preset.description}</p>
        <DialogError error={props.error} />
        <Button type="primary" loading={props.busy} onClick={() => props.onConfirm(presetId, intensity, color, smart)}>开始打光</Button>
      </div>
    </div>
  </Modal>;
}

function StoryboardDialog(props: CommonProps & { onConfirm: (cols: number, showIndex: boolean) => void }) {
  const [cols, setCols] = useState(3);
  const [showIndex, setShowIndex] = useState(true);
  return <Modal {...modalProps(props, 620)} title="分镜组拼接">
    <div className="workflow-image-tool__simple" data-workflow-overlay>
      <div className="workflow-image-tool__preview"><img src={props.mediaUrl} alt="分镜预览" /></div>
      <div className="workflow-image-tool__controls">
        <label>每行列数<Segmented block value={cols} options={[2, 3, 4, 5].map(n => ({ label: `${n} 列`, value: n }))} onChange={v => setCols(Number(v))} /></label>
        <label className="workflow-relight-smart"><input type="checkbox" checked={showIndex} onChange={e => setShowIndex(e.target.checked)} />显示镜头编号</label>
        <p className="workflow-image-tool__hint">将选中节点按时间线拼接为分镜组图片节点。</p>
        <DialogError error={props.error} />
        <Button type="primary" loading={props.busy} onClick={() => props.onConfirm(cols, showIndex)}>生成分镜组</Button>
      </div>
    </div>
  </Modal>;
}

const VECTORIZE_PRESET_HINTS: Record<VectorizePreset, string> = {
  detailed: '16 色，保留细节，适合插画和照片转矢量',
  poster: '6 色并预先模糊，色块干净，适合海报和图标',
  line: '黑白两色，适合线稿、Logo 和文字',
};

function VectorizeDialog(props: CommonProps & { onConfirm: (preset: VectorizePreset) => void }) {
  const [preset, setPreset] = useState<VectorizePreset>('detailed');
  return <Modal {...modalProps(props)} title="矢量化"><div data-workflow-overlay style={{ display: 'grid', gap: 12 }}>
    <Segmented block value={preset} options={(Object.keys(VECTORIZE_PRESET_LABELS) as VectorizePreset[]).map(value => ({ label: VECTORIZE_PRESET_LABELS[value], value }))} onChange={value => setPreset(value as VectorizePreset)} />
    <p style={{ margin: 0, opacity: 0.75 }}>{VECTORIZE_PRESET_HINTS[preset]}。在本地浏览器内描摹，长边超过 1024px 会先等比缩小，结果以 SVG 节点出现在右侧。</p>
    <Button type="primary" loading={props.busy} onClick={() => props.onConfirm(preset)}>开始矢量化</Button>
  </div></Modal>;
}

function MoveObjectDialog(props: CommonProps & { onConfirm: (points: NormalizedPoint[], dx: number, dy: number, prompt: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [points, setPoints] = useState<NormalizedPoint[]>([]);
  const [phase, setPhase] = useState<'select' | 'move'>('select');
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });
  const [extra, setExtra] = useState('');
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const selecting = useRef(false);
  const point = (event: ReactPointerEvent<HTMLCanvasElement>): NormalizedPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
  };
  useEffect(() => {
    const canvas = canvasRef.current; const image = imageRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    if (points.length < 2) return;
    context.lineWidth = Math.max(2, Math.round(width / 300));
    if (phase === 'select') {
      context.strokeStyle = '#1677ff';
      tracePolygon(context, points, width, height);
      context.stroke();
      return;
    }
    context.save();
    context.setLineDash([10, 8]);
    context.strokeStyle = 'rgba(255,255,255,0.9)';
    tracePolygon(context, points, width, height);
    context.stroke();
    context.restore();
    if (image && image.complete) {
      context.save();
      tracePolygon(context, points, width, height, offset.dx, offset.dy);
      context.clip();
      context.drawImage(image, offset.dx * width, offset.dy * height, width, height);
      context.restore();
    }
    context.strokeStyle = '#1677ff';
    tracePolygon(context, points, width, height, offset.dx, offset.dy);
    context.stroke();
  }, [points, phase, offset]);
  const reset = () => { setPoints([]); setPhase('select'); setOffset({ dx: 0, dy: 0 }); };
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = point(event);
    if (phase === 'select') { selecting.current = true; setPoints([next]); return; }
    drag.current = { x: next.x, y: next.y, dx: offset.dx, dy: offset.dy };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const next = point(event);
    if (phase === 'select') {
      if (!selecting.current) return;
      setPoints(current => {
        const last = current[current.length - 1];
        return last && Math.hypot(next.x - last.x, next.y - last.y) < 0.004 ? current : [...current, next];
      });
      return;
    }
    const start = drag.current;
    if (start) setOffset(clampMoveOffset(points, start.dx + next.x - start.x, start.dy + next.y - start.y));
  };
  const onPointerUp = () => {
    if (phase === 'select') {
      selecting.current = false;
      if (points.length >= 3) setPhase('move'); else setPoints([]);
      return;
    }
    drag.current = null;
  };
  const moved = phase === 'move' && Math.hypot(offset.dx, offset.dy) > 0.005;
  return <Modal {...modalProps(props, 900)} title="移动物体"><div className="workflow-image-tool__grid" data-workflow-overlay>
    <div className="workflow-image-tool__mask"><img ref={imageRef} src={props.mediaUrl} alt="移动物体" onLoad={event => { const canvas = canvasRef.current; if (!canvas) return; canvas.width = event.currentTarget.naturalWidth || 1024; canvas.height = event.currentTarget.naturalHeight || 768; }} /><canvas ref={canvasRef} width={1024} height={768} style={{ cursor: phase === 'select' ? 'crosshair' : 'move', touchAction: 'none' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} /></div>
    <div className="workflow-image-tool__controls">
      <p>{phase === 'select' ? '第一步：按住鼠标沿物体轮廓圈一圈，松开后自动闭合。' : '第二步：在画面上拖动，把物体放到新位置。原位置会用背景补全，新位置会补光影和接缝。'}</p>
      <label>补充要求（可选）<Input.TextArea rows={4} value={extra} placeholder="例如：保持物体大小不变，地面加上投影" onChange={event => setExtra(event.target.value)} /></label>
      <Button onClick={reset} disabled={props.busy}>重新圈选</Button>
      <DialogError error={props.error} />
      <Button type="primary" loading={props.busy} disabled={!moved} onClick={() => props.onConfirm(points, offset.dx, offset.dy, extra.trim())}>开始移动</Button>
    </div>
  </div></Modal>;
}
