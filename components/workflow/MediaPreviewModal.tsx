import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Play, Star, X } from 'lucide-react';
import { useWorkflowMediaUrl } from './media';
import type { WorkflowNode } from './types';

/**
 * 画廊模式（多结果对比，DESIGN 01 §13.3）：大图 + 底部缩略条，←/→ 切换，显示 n / N，视频带原生控件。
 * 不传 gallery 时就是原来的单节点预览，行为不变。
 */
export interface MediaPreviewGallery {
  items: WorkflowNode[];
  index: number;
  onIndexChange: (index: number) => void;
  /** 当前首图（节点本身那份媒体）的 ID；它不显示“设为首图”。 */
  primaryId?: string;
  onPromote?: (item: WorkflowNode) => void;
}

function GalleryThumb({ item, active, label, onSelect }: { item: WorkflowNode; active: boolean; label: string; onSelect: () => void }) {
  const video = item.type === 'video';
  const source = useWorkflowMediaUrl(
    video ? item.metadata.posterStorageKey : item.metadata.storageKey,
    video ? item.metadata.poster : item.metadata.href,
  );
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (active) ref.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [active]);
  return (
    <button ref={ref} type="button" className={'workflow-preview-modal__thumb' + (active ? ' is-active' : '')} aria-label={label} aria-current={active ? 'true' : undefined} onClick={onSelect}>
      {source.url ? <img src={source.url} alt="" draggable={false} /> : <span className="workflow-preview-modal__thumb-empty" aria-hidden="true">{video ? <Play size={12} /> : null}</span>}
      {video && <span className="workflow-preview-modal__thumb-video" aria-hidden="true"><Play size={8} fill="currentColor" /></span>}
    </button>
  );
}

export function MediaPreviewModal({ node: singleNode, onClose, language = 'zho', gallery }: { node: WorkflowNode | null; onClose: () => void; language?: 'en' | 'zho'; gallery?: MediaPreviewGallery | null }) {
  const galleryItems = gallery && gallery.items.length ? gallery.items : null;
  const galleryIndex = galleryItems ? Math.max(0, Math.min(galleryItems.length - 1, gallery!.index)) : 0;
  const node = galleryItems ? galleryItems[galleryIndex] : singleNode;
  const storageKey = node?.metadata.storageKey;
  const fallbackHref = node?.metadata.href;
  const media = useWorkflowMediaUrl(storageKey, fallbackHref);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const galleryRef = useRef<{ count: number; index: number; onIndexChange: (index: number) => void } | null>(null);
  galleryRef.current = galleryItems ? { count: galleryItems.length, index: galleryIndex, onIndexChange: gallery!.onIndexChange } : null;
  // 画廊里切换条目不重置焦点；单节点预览仍按节点 ID（原行为）。
  const sessionKey = galleryItems ? 'gallery' : node?.id;
  useEffect(() => {
    if (!node) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      const nav = galleryRef.current;
      if (nav && nav.count > 1 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        // 焦点在视频 / 音频控件上时，方向键留给它们拖进度。
        if (event.target instanceof Element && event.target.closest('video,audio,input')) return;
        event.preventDefault();
        const step = event.key === 'ArrowLeft' ? -1 : 1;
        nav.onIndexChange((nav.index + step + nav.count) % nav.count);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),video[controls],audio[controls],[tabindex]:not([tabindex="-1"])') || []);
      if (!items.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (restoreFocusRef.current?.isConnected) restoreFocusRef.current.focus();
      restoreFocusRef.current = null;
    };
  }, [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const en = language === 'en';
  const copy = en
    ? { title: `Media preview: ${node?.title || 'Untitled media'}`, close: 'Close media preview', loading: 'Loading media…', prev: 'Previous result', next: 'Next result', promote: 'Make primary', primary: 'Primary', strip: 'Results' }
    : { title: `素材预览：${node?.title || '未命名素材'}`, close: '关闭素材预览', loading: '正在加载', prev: '上一个结果', next: '下一个结果', promote: '设为首图', primary: '首图', strip: '全部结果' };
  const isPrimary = Boolean(galleryItems && node && gallery!.primaryId === node.id);
  const go = (index: number) => gallery?.onIndexChange(index);
  return (
    <AnimatePresence>
      {node && (
        <motion.div
          ref={dialogRef}
          className={'workflow-preview-modal' + (galleryItems ? ' workflow-preview-modal--gallery' : '')}
          role="dialog"
          aria-modal="true"
          aria-label={copy.title}
          tabIndex={-1}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <div className="workflow-preview-modal__media" onClick={event => event.stopPropagation()}>
            <button ref={closeRef} type="button" className="workflow-preview-modal__close" aria-label={copy.close} onClick={onClose}><X size={18} /></button>
            {node.type === 'image' && media.url && <img key={node.id} src={media.url} alt={node.title} />}
            {node.type === 'video' && media.url && <video key={node.id} src={media.url} controls autoPlay />}
            {node.type === 'audio' && media.url && <audio key={node.id} src={media.url} controls autoPlay />}
            {!media.url && <span className="workflow-preview-modal__empty">{media.error || copy.loading}</span>}
          </div>
          {galleryItems && (
            <div className="workflow-preview-modal__gallery" onClick={event => event.stopPropagation()}>
              <div className="workflow-preview-modal__bar">
                <button type="button" className="workflow-preview-modal__nav" aria-label={copy.prev} title={`${copy.prev}（←）`} disabled={galleryItems.length < 2} onClick={() => go((galleryIndex - 1 + galleryItems.length) % galleryItems.length)}><ChevronLeft size={16} /></button>
                <span className="workflow-preview-modal__counter" aria-live="polite">{galleryIndex + 1} / {galleryItems.length}</span>
                <button type="button" className="workflow-preview-modal__nav" aria-label={copy.next} title={`${copy.next}（→）`} disabled={galleryItems.length < 2} onClick={() => go((galleryIndex + 1) % galleryItems.length)}><ChevronRight size={16} /></button>
                <span className="workflow-preview-modal__name" title={node.title}>{node.title}</span>
                {isPrimary
                  ? <span className="workflow-preview-modal__primary"><Star size={12} />{copy.primary}</span>
                  : gallery!.onPromote && <button type="button" className="workflow-preview-modal__promote" onClick={() => gallery!.onPromote!(node)}><Star size={12} />{copy.promote}</button>}
              </div>
              <div className="workflow-preview-modal__strip isl-scrollbar" role="group" aria-label={copy.strip}>
                {galleryItems.map((item, index) => (
                  <GalleryThumb key={item.id} item={item} active={index === galleryIndex} label={`${index + 1} / ${galleryItems.length} ${item.title}`} onSelect={() => go(index)} />
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
