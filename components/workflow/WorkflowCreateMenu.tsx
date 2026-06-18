import { Image, Music2, Settings2, Type, Video, X } from 'lucide-react';
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
    >
      <div style={{ display: 'flex', alignItems: 'center', padding: '3px 5px 6px 9px', color: 'var(--wf-muted)', fontSize: 12 }}>
        <span style={{ flex: 1 }}>{state.sourceId ? '引用该节点生成' : '新建节点'}</span>
        <button type="button" aria-label="关闭新建节点" onClick={onClose}><X size={14} /></button>
      </div>
      {OPTIONS.map(option => {
        const Icon = option.icon;
        return (
          <button key={option.type} type="button" role="menuitem" onClick={() => onCreate(option.type)}>
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
