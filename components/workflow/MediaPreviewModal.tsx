import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useWorkflowMediaUrl } from './media';
import type { WorkflowNode } from './types';

export function MediaPreviewModal({ node, onClose, language = 'zho' }: { node: WorkflowNode | null; onClose: () => void; language?: 'en' | 'zho' }) {
  const storageKey = node?.metadata.storageKey;
  const fallbackHref = node?.metadata.href;
  const media = useWorkflowMediaUrl(storageKey, fallbackHref);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
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
  }, [node?.id]);
  const copy = language === 'en'
    ? { title: `Media preview: ${node?.title || 'Untitled media'}`, close: 'Close media preview', loading: 'Loading media…' }
    : { title: `素材预览：${node?.title || '未命名素材'}`, close: '关闭素材预览', loading: '正在加载' };
  return (
    <AnimatePresence>
      {node && (
        <motion.div
          ref={dialogRef}
          className="workflow-preview-modal"
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
            {node.type === 'image' && media.url && <img src={media.url} alt={node.title} />}
            {node.type === 'video' && media.url && <video src={media.url} controls autoPlay />}
            {node.type === 'audio' && media.url && <audio src={media.url} controls autoPlay />}
            {!media.url && <span className="workflow-preview-modal__empty">{media.error || copy.loading}</span>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
