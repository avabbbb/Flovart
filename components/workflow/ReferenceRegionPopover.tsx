// 区域引用弹层（P1-2）：在参考图上拖拽框选一块区域，产物写回 Prompt Bar 对应 @chip 的 attrs.region。
// 只是弹层，不改 Prompt Bar 本体；画布上不产生裁剪节点。
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useWorkflowMediaUrl } from './media';
import { regionFromDrag } from './referenceRegion';
import type { WorkflowReferenceRegion } from './types';

export interface ReferenceRegionPopoverProps {
  label: string;
  storageKey?: string;
  href?: string;
  region?: WorkflowReferenceRegion;
  language?: 'zh' | 'en';
  onConfirm: (region: WorkflowReferenceRegion | null) => void;
  onClose: () => void;
}

export function ReferenceRegionPopover({ label, storageKey, href, region, language = 'zh', onConfirm, onClose }: ReferenceRegionPopoverProps) {
  const media = useWorkflowMediaUrl(storageKey, href);
  const frameRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<WorkflowReferenceRegion | undefined>(region);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const en = language === 'en';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      else if (event.key === 'Enter' && draft) { event.stopPropagation(); onConfirm(draft); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [draft, onClose, onConfirm]);

  const point = (event: ReactPointerEvent) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  const body = (
    <div className="workflow-region-popover" data-workflow-overlay data-testid="reference-region-popover" role="dialog" aria-label={en ? 'Select a region' : '框选参考区域'}
      onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}
      onWheel={event => event.stopPropagation()}>
      <div className="workflow-region-popover__panel">
        <div className="workflow-region-popover__head">
          <strong>{en ? `Focus on part of ${label}` : `只引用 ${label} 的一块区域`}</strong>
          <span>{en ? 'Drag on the image. The generation only receives this area.' : '在图上拖拽框选；生成时只提交这块区域，画布上不会多出裁剪节点。'}</span>
        </div>
        <div
          ref={frameRef}
          className="workflow-region-popover__frame"
          onPointerDown={event => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
            dragStart.current = point(event);
          }}
          onPointerMove={event => {
            if (!dragStart.current) return;
            const next = regionFromDrag(dragStart.current, point(event));
            if (next) setDraft(next);
          }}
          onPointerUp={event => {
            if (dragStart.current) {
              const next = regionFromDrag(dragStart.current, point(event));
              if (next) setDraft(next);
            }
            dragStart.current = null;
          }}
        >
          {media.url ? <img src={media.url} alt={label} draggable={false} /> : <div className="workflow-region-popover__empty">{en ? 'Loading…' : '加载中…'}</div>}
          {draft && (
            <div className="workflow-region-popover__box" data-testid="reference-region-box"
              style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />
          )}
        </div>
        <div className="workflow-region-popover__actions">
          {region && <button type="button" onClick={() => onConfirm(null)}>{en ? 'Use whole image' : '改回整张图'}</button>}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>{en ? 'Cancel' : '取消'}</button>
          <button type="button" className="is-primary" disabled={!draft} onClick={() => draft && onConfirm(draft)}>{en ? 'Use this region' : '引用这块区域'}</button>
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}
