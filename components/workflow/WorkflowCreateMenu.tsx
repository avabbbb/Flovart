import { FileText, Image, Music2, Settings2, Type, Video, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { WorkflowNodeType, WorkflowPoint } from './types';

export interface WorkflowCreateMenuState {
  world: WorkflowPoint;
  anchor: WorkflowPoint;
  sourceId?: string;
  targetId?: string;
}

const OPTIONS: Array<{ type: WorkflowNodeType; title: string; description: string; icon: typeof Type }> = [
  { type: 'image', title: '图片生成', description: '创建图片生成节点', icon: Image },
  { type: 'video', title: '视频生成', description: '创建视频生成节点', icon: Video },
  { type: 'text', title: '文本生成', description: '脚本、文案和提示词', icon: Type },
  { type: 'script', title: '脚本节点', description: '剧本拆解、分镜编排和批量生成', icon: FileText },
  { type: 'audio', title: '音频参考', description: '添加音频参考输入', icon: Music2 },
  { type: 'config', title: '配置节点', description: '模型、尺寸和生成参数', icon: Settings2 },
];

export function WorkflowCreateMenu({ state, onCreate, onClose }: {
  state: WorkflowCreateMenuState;
  onCreate: (type: WorkflowNodeType) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first = listRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
    if (event.key === 'ArrowUp') nextIndex = activeIndex < 0 ? 0 : (activeIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && activeIndex >= 0) {
      event.preventDefault();
      items[activeIndex].click();
      return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  return (
    <motion.div
      role="menu"
      aria-label="新建节点"
      data-workflow-overlay
      data-workflow-create-menu
      className="workflow-create-menu"
      style={{ position: 'absolute', left: state.anchor.x, top: state.anchor.y }}
      initial={{ opacity: 0, scale: 0.92, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: -6 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28, mass: 0.7 }}
      onPointerDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <div className="workflow-create-menu__header">
        <span>{state.sourceId ? '引用该节点生成' : state.targetId ? '为此节点创建上游' : '新建节点'}</span>
        <button type="button" aria-label="关闭新建节点" onClick={onClose}><X size={15} /></button>
      </div>
      <div ref={listRef} className="workflow-create-menu__list">
        <AnimatePresence>
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <motion.button
                key={option.type}
                type="button"
                role="menuitem"
                className="workflow-create-menu__item"
                onClick={() => onCreate(option.type)}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.5 }}
              >
                <span className="workflow-create-menu__item-icon"><Icon size={18} /></span>
                <span className="workflow-create-menu__item-text">
                  <span className="workflow-create-menu__item-title">{option.title}</span>
                  <span className="workflow-create-menu__item-desc">{option.description}</span>
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}