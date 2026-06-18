import { Image, Music2, Settings2, Type, Video, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { WorkflowNodeType, WorkflowPoint } from './types';

export interface WorkflowCreateMenuState {
  world: WorkflowPoint;
  anchor: WorkflowPoint;
  sourceId?: string;
}

const OPTIONS: Array<{ type: WorkflowNodeType; title: string; description: string; icon: typeof Type }> = [
  { type: 'text', title: '文本生成', description: '脚本、文案和提示词', icon: Type },
  { type: 'image', title: '图片生成', description: '创建图片生成节点', icon: Image },
  { type: 'video', title: '视频生成', description: '创建视频生成节点', icon: Video },
  { type: 'audio', title: '音频参考', description: '添加音频参考输入', icon: Music2 },
  { type: 'config', title: '配置节点', description: '模型、尺寸和生成参数', icon: Settings2 },
];

export function WorkflowCreateMenu({ state, onCreate, onClose }: {
  state: WorkflowCreateMenuState;
  onCreate: (type: WorkflowNodeType) => void;
  onClose: () => void;
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => optionRefs.current[0]?.focus(), []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const options = optionRefs.current.filter((option): option is HTMLButtonElement => Boolean(option));
    const activeIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % options.length;
    if (event.key === 'ArrowUp') nextIndex = activeIndex < 0 ? options.length - 1 : (activeIndex - 1 + options.length) % options.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = options.length - 1;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && activeIndex >= 0) {
      event.preventDefault();
      options[activeIndex].click();
      return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    options[nextIndex]?.focus();
  };

  return (
    <div
      role="menu"
      aria-label="新建节点"
      data-workflow-overlay
      data-workflow-create-menu
      className="workflow-context-menu"
      style={{ position: 'absolute', left: state.anchor.x, top: state.anchor.y, width: 280 }}
      onPointerDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <div style={{ display: 'flex', alignItems: 'center', padding: '3px 5px 6px 9px', color: 'var(--wf-muted)', fontSize: 12 }}>
        <span style={{ flex: 1 }}>{state.sourceId ? '引用该节点生成' : '新建节点'}</span>
        <button type="button" aria-label="关闭新建节点" onClick={onClose}><X size={14} /></button>
      </div>
      {OPTIONS.map((option, index) => {
        const Icon = option.icon;
        return (
          <button key={option.type} ref={element => { optionRefs.current[index] = element; }} type="button" role="menuitem" onClick={() => onCreate(option.type)}>
            <Icon size={16} />
            <span>
              <strong style={{ display: 'block', fontSize: 12 }}>{option.title}</strong>
              <small style={{ color: 'var(--wf-muted)' }}>{option.description}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
