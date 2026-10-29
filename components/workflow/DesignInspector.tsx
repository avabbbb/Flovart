import { ColorPicker, Input, InputNumber, Segmented, Select, Slider, Switch } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { DEFAULT_TEXT_STYLE, DESIGN_FRAME_PRESETS, type DesignAutoLayout, type DesignElement, type DesignStroke, type DesignTextAlign, type DesignTextStyle } from '../../services/design/designTypes';
import { DEFAULT_AUTO_LAYOUT, applyFramePreset, convertFill, fillPrimaryColor, plainTextToRuns, runsToPlainText, setGradientStopColor, DESIGN_FILL_KINDS, pickOption } from '../../services/design/inspector';
import type { WorkflowNode } from './types';

export interface DesignInspectorChange {
  design: DesignElement;
  size?: { width: number; height: number };
}

const FONT_FAMILIES = ['Inter', 'PingFang SC', 'Noto Sans SC', 'Source Han Serif SC', 'Roboto', 'Georgia', 'Courier New'];
const FONT_WEIGHTS = [300, 400, 500, 600, 700, 800];
const ALIGN_OPTIONS: readonly DesignAutoLayout['align'][] = ['start', 'center', 'end', 'stretch'];
const JUSTIFY_OPTIONS: readonly DesignAutoLayout['justify'][] = ['start', 'center', 'end', 'space-between'];
const DEFAULT_STROKE: DesignStroke = { color: '#111111', width: 2 };

const panelStyle: CSSProperties = {
  width: 280,
  maxHeight: '70vh',
  overflowY: 'auto',
  padding: 12,
  borderRadius: 12,
  background: 'var(--surface, #fff)',
  border: '1px solid var(--border, rgba(127,127,127,.25))',
  boxShadow: '0 8px 28px rgba(0,0,0,.14)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  fontSize: 12,
};
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' };
const sectionTitle: CSSProperties = { fontWeight: 600, opacity: 0.75, marginTop: 4 };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <label style={rowStyle}><span style={{ flexShrink: 0, opacity: 0.8 }}>{label}</span><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{children}</span></label>;
}

export function DesignInspector({ node, onChange }: { node: WorkflowNode; onChange: (change: DesignInspectorChange) => void }) {
  const design = node.metadata.design;
  if (!design) return null;
  const update = (patch: Partial<DesignElement>) => onChange({ design: { ...design, ...patch } });
  const fill = design.fill;
  const stroke = design.stroke;
  const updateStroke = (patch: Partial<DesignStroke>) => update({ stroke: { ...(stroke ?? DEFAULT_STROKE), ...patch } });
  const text = design.text;
  const textStyle: DesignTextStyle = text?.style ?? DEFAULT_TEXT_STYLE;
  const updateTextStyle = (patch: Partial<DesignTextStyle>) => update({ text: { runs: text?.runs ?? [], style: { ...textStyle, ...patch } } });
  const frame = design.frame;
  const layout = frame?.autoLayout;
  const updateLayout = (patch: Partial<DesignAutoLayout>) => {
    if (!frame) return;
    update({ frame: { ...frame, autoLayout: { ...(layout ?? DEFAULT_AUTO_LAYOUT), ...patch } } });
  };

  return (
    <div style={panelStyle} data-testid="design-inspector" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{node.title || '设计元素'}</div>

      {frame && <>
        <div style={sectionTitle}>画板</div>
        <Row label="尺寸预设">
          <Select size="small" style={{ width: 160 }} value={frame.preset} placeholder="自定义" options={DESIGN_FRAME_PRESETS.map(preset => ({ label: preset.label, value: preset.id }))} onChange={value => {
            const next = applyFramePreset(design, value);
            if (next) onChange({ design: next.design, size: { width: next.width, height: next.height } });
          }} />
        </Row>
        <Row label="裁剪内容"><Switch size="small" checked={frame.clip} onChange={clip => update({ frame: { ...frame, clip } })} /></Row>
        <Row label="自动布局"><Switch size="small" checked={Boolean(layout)} onChange={on => update({ frame: { ...frame, autoLayout: on ? { ...DEFAULT_AUTO_LAYOUT } : undefined } })} /></Row>
        {layout && <>
          <Row label="方向"><Segmented size="small" value={layout.direction} options={[{ label: '纵向', value: 'vertical' }, { label: '横向', value: 'horizontal' }]} onChange={value => updateLayout({ direction: value === 'horizontal' ? 'horizontal' : 'vertical' })} /></Row>
          <Row label="间距"><InputNumber size="small" min={0} max={400} value={layout.gap} onChange={value => updateLayout({ gap: value ?? 0 })} /></Row>
          <Row label="内边距"><InputNumber size="small" min={0} max={400} value={layout.padding.top} onChange={value => { const v = value ?? 0; updateLayout({ padding: { top: v, right: v, bottom: v, left: v } }); }} /></Row>
          <Row label="对齐"><Select size="small" style={{ width: 110 }} value={layout.align} options={[{ label: '起点', value: 'start' }, { label: '居中', value: 'center' }, { label: '终点', value: 'end' }, { label: '拉伸', value: 'stretch' }]} onChange={value => updateLayout({ align: pickOption(value, ALIGN_OPTIONS, 'start') })} /></Row>
          <Row label="分布"><Select size="small" style={{ width: 110 }} value={layout.justify} options={[{ label: '起点', value: 'start' }, { label: '居中', value: 'center' }, { label: '终点', value: 'end' }, { label: '两端', value: 'space-between' }]} onChange={value => updateLayout({ justify: pickOption(value, JUSTIFY_OPTIONS, 'start') })} /></Row>
          <Row label="尺寸"><Segmented size="small" value={layout.sizing} options={[{ label: '固定', value: 'fixed' }, { label: '包裹', value: 'hug' }]} onChange={value => updateLayout({ sizing: value === 'hug' ? 'hug' : 'fixed' })} /></Row>
        </>}
      </>}

      {text && <>
        <div style={sectionTitle}>文字</div>
        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} value={runsToPlainText(text.runs)} onChange={event => update({ text: { ...text, runs: plainTextToRuns(text.runs, event.target.value) } })} />
        <Row label="字体"><Select size="small" style={{ width: 160 }} value={textStyle.fontFamily} options={FONT_FAMILIES.map(font => ({ label: <span style={{ fontFamily: font }}>{font}</span>, value: font }))} onChange={value => updateTextStyle({ fontFamily: String(value) })} /></Row>
        <Row label="字号 / 字重">
          <InputNumber size="small" min={6} max={400} value={textStyle.fontSize} onChange={value => updateTextStyle({ fontSize: value ?? textStyle.fontSize })} />
          <Select size="small" style={{ width: 72 }} value={textStyle.fontWeight} options={FONT_WEIGHTS.map(weight => ({ label: String(weight), value: weight }))} onChange={value => updateTextStyle({ fontWeight: Number(value) })} />
        </Row>
        <Row label="行高 / 字距">
          <InputNumber size="small" min={0.8} max={3} step={0.1} value={textStyle.lineHeight} onChange={value => updateTextStyle({ lineHeight: value ?? textStyle.lineHeight })} />
          <InputNumber size="small" min={-10} max={40} step={0.5} value={textStyle.letterSpacing} onChange={value => updateTextStyle({ letterSpacing: value ?? 0 })} />
        </Row>
        <Row label="对齐"><Segmented size="small" value={textStyle.align} options={[{ label: '左', value: 'left' }, { label: '中', value: 'center' }, { label: '右', value: 'right' }]} onChange={value => { const align: DesignTextAlign = value === 'center' || value === 'right' ? value : 'left'; updateTextStyle({ align }); }} /></Row>
        <Row label="颜色 / 斜体">
          <ColorPicker size="small" value={textStyle.color} onChange={color => updateTextStyle({ color: color.toHexString() })} />
          <Switch size="small" checked={Boolean(textStyle.italic)} onChange={italic => updateTextStyle({ italic })} />
        </Row>
      </>}

      <div style={sectionTitle}>填充</div>
      <Segmented size="small" block value={fill.type} options={[{ label: '无', value: 'none' }, { label: '纯色', value: 'solid' }, { label: '线性', value: 'linear' }, { label: '径向', value: 'radial' }]} onChange={value => update({ fill: convertFill(fill, pickOption(value, DESIGN_FILL_KINDS, fill.type)) })} />
      {fill.type === 'solid' && <Row label="颜色"><ColorPicker size="small" showText value={fill.color} onChange={color => update({ fill: { ...fill, color: color.toHexString() } })} /></Row>}
      {(fill.type === 'linear' || fill.type === 'radial') && <>
        <Row label="起止色">
          <ColorPicker size="small" value={fillPrimaryColor(fill)} onChange={color => update({ fill: setGradientStopColor(fill, 'start', color.toHexString()) })} />
          <ColorPicker size="small" value={fill.stops[fill.stops.length - 1]?.color ?? '#FFFFFF'} onChange={color => update({ fill: setGradientStopColor(fill, 'end', color.toHexString()) })} />
        </Row>
        {fill.type === 'linear' && <Row label="角度"><Slider style={{ width: 140 }} min={0} max={360} value={fill.angle} onChange={angle => update({ fill: { ...fill, angle } })} /></Row>}
      </>}

      <div style={sectionTitle}>描边</div>
      <Row label="启用"><Switch size="small" checked={Boolean(stroke)} onChange={on => update({ stroke: on ? { ...DEFAULT_STROKE } : undefined })} /></Row>
      {stroke && <>
        <Row label="颜色 / 粗细">
          <ColorPicker size="small" value={stroke.color} onChange={color => updateStroke({ color: color.toHexString() })} />
          <InputNumber size="small" min={0} max={100} step={0.5} value={stroke.width} onChange={value => updateStroke({ width: value ?? 0 })} />
        </Row>
        <Row label="虚线"><Switch size="small" checked={Boolean(stroke.dash?.length)} onChange={on => updateStroke({ dash: on ? [stroke.width * 3, stroke.width * 2] : undefined })} /></Row>
      </>}

      <div style={sectionTitle}>外观</div>
      {(design.kind === 'rect' || design.kind === 'frame') && <Row label="圆角"><InputNumber size="small" min={0} max={1000} value={design.cornerRadius ?? 0} onChange={value => update({ cornerRadius: value ?? 0 })} /></Row>}
      <Row label="不透明度"><Slider style={{ width: 140 }} min={0} max={100} value={Math.round((design.opacity ?? 1) * 100)} onChange={value => update({ opacity: value / 100 })} /></Row>
      {design.path && <>
        <Row label="闭合路径"><Switch size="small" checked={design.path.closed} onChange={closed => { const path = design.path; if (path) update({ path: { ...path, closed } }); }} /></Row>
        <Row label="填充规则"><Segmented size="small" value={design.path.fillRule ?? 'nonzero'} options={[{ label: '非零', value: 'nonzero' }, { label: '奇偶', value: 'evenodd' }]} onChange={value => { const path = design.path; if (path) update({ path: { ...path, fillRule: value === 'evenodd' ? 'evenodd' : 'nonzero' } }); }} /></Row>
      </>}
    </div>
  );
}
