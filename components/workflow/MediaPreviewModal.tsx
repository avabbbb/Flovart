import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWorkflowMediaUrl } from './media';
import type { WorkflowNode } from './types';

export function MediaPreviewModal({ node, onClose }: { node: WorkflowNode | null; onClose: () => void }) {
  const storageKey = node?.metadata.storageKey;
  const fallbackHref = node?.metadata.href;
  const media = useWorkflowMediaUrl(storageKey, fallbackHref);
  useEffect(() => {
    if (!node) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [node, onClose]);
  return (
    <AnimatePresence>
      {node && (
        <motion.div
          className="workflow-preview-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <div className="workflow-preview-modal__media" onClick={event => event.stopPropagation()}>
            {node.type === 'image' && media.url && <img src={media.url} alt={node.title} />}
            {node.type === 'video' && media.url && <video src={media.url} controls autoPlay />}
            {node.type === 'audio' && media.url && <audio src={media.url} controls autoPlay />}
            {!media.url && <span className="workflow-preview-modal__empty">{media.error || '加载中'}</span>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
