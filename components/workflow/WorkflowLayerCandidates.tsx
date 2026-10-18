import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useWorkflowMediaUrl } from './media';
import type { WorkflowNode } from './types';
import type { WorkflowLayerPreview } from './layerPreview';

const COPY = {
  en: {
    grid: 'Layer candidates', pick: (n: number) => 'Compare candidate ' + n,
    before: 'Original', after: 'With layer', slider: 'Comparison position', back: 'Back to candidates',
  },
  zho: {
    grid: '叠加层候选', pick: (n: number) => '对比候选 ' + n,
    before: '原图', after: '叠加后', slider: '对比位置', back: '返回候选',
  },
} as const;

const stopCanvas = (event: ReactPointerEvent) => event.stopPropagation();

function CandidateCell({ node, index, label, onPick }: { node: WorkflowNode; index: number; label: string; onPick: (nodeId: string) => void }) {
  const media = useWorkflowMediaUrl(node.metadata.storageKey, node.metadata.href);
  return (
    <button
      type="button"
      className="workflow-layer-candidates__cell"
      data-testid="workflow-layer-candidate"
      aria-label={label}
      title={label}
      onPointerDown={stopCanvas}
      onClick={event => { event.stopPropagation(); onPick(node.id); }}
    >
      {media.url ? <img src={media.url} alt="" draggable={false} loading="lazy" /> : null}
      <em>{index + 1}</em>
    </button>
  );
}

function LayerCompare({ source, candidate, index, language, onBack }: { source?: WorkflowNode; candidate: WorkflowNode; index: number; language: 'en' | 'zho'; onBack: () => void }) {
  const copy = COPY[language];
  const sourceMedia = useWorkflowMediaUrl(source?.metadata.storageKey, source?.metadata.href);
  const layerMedia = useWorkflowMediaUrl(candidate.metadata.storageKey, candidate.metadata.href);
  const [split, setSplit] = useState(50);
  return (
    <div className="workflow-layer-compare" data-testid="workflow-layer-compare" data-workflow-overlay>
      <div className="workflow-layer-compare__stage">
        {sourceMedia.url ? <img src={sourceMedia.url} alt={copy.before} draggable={false} /> : null}
        {layerMedia.url ? (
          <img
            className="workflow-layer-compare__overlay"
            src={layerMedia.url}
            alt={copy.after + ' ' + (index + 1)}
            draggable={false}
            style={{ clipPath: 'inset(0 0 0 ' + split + '%)' }}
          />
        ) : null}
        <span className="workflow-layer-compare__divider" style={{ left: split + '%' }} aria-hidden="true" />
        <span className="workflow-layer-compare__tag workflow-layer-compare__tag--before">{copy.before}</span>
        <span className="workflow-layer-compare__tag workflow-layer-compare__tag--after">{copy.after} {index + 1}</span>
      </div>
      <div className="workflow-layer-compare__controls">
        <input
          type="range" min={0} max={100} step={1} value={split}
          aria-label={copy.slider}
          data-testid="workflow-layer-compare-slider"
          onPointerDown={stopCanvas}
          onChange={event => setSplit(Number(event.target.value))}
        />
        <button type="button" onPointerDown={stopCanvas} onClick={event => { event.stopPropagation(); onBack(); }}>{copy.back}</button>
      </div>
    </div>
  );
}

/** 叠加层候选：2×2 网格（透明区域显示棋盘格），点击候选进入原图/叠加后分屏对比。只读显示，不改节点。 */
export function WorkflowLayerCandidates({ preview, language = 'zho' }: { preview: WorkflowLayerPreview; language?: 'en' | 'zho' }) {
  const [comparingId, setComparingId] = useState<string | null>(null);
  const copy = COPY[language];
  if (!preview.candidates.length) return null;
  const comparingIndex = comparingId ? preview.candidates.findIndex(node => node.id === comparingId) : -1;
  if (comparingIndex >= 0) {
    return <LayerCompare source={preview.source} candidate={preview.candidates[comparingIndex]} index={comparingIndex} language={language} onBack={() => setComparingId(null)} />;
  }
  return (
    <div className="workflow-layer-candidates" data-testid="workflow-layer-candidates" data-workflow-overlay role="group" aria-label={copy.grid}>
      {preview.candidates.map((node, index) => (
        <CandidateCell key={node.id} node={node} index={index} label={copy.pick(index + 1)} onPick={setComparingId} />
      ))}
    </div>
  );
}
