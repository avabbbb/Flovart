import { Copy, Play, Trash2 } from 'lucide-react';

export type WorkflowContextMenuState =
  | { type: 'node'; id: string; x: number; y: number }
  | { type: 'connection'; id: string; x: number; y: number };

export function WorkflowContextMenu({ state, onCopy, onDelete, onRun }: {
  state: WorkflowContextMenuState;
  onCopy: () => void;
  onDelete: () => void;
  onRun: () => void;
}) {
  return (
    <div role="menu" aria-label={state.type === 'node' ? '节点菜单' : '连接菜单'} data-workflow-overlay className="workflow-context-menu" style={{ left: state.x, top: state.y }} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      {state.type === 'node' && <button type="button" role="menuitem" onClick={onCopy}><Copy size={14} />复制</button>}
      {state.type === 'node' && <button type="button" role="menuitem" onClick={onRun}><Play size={14} />运行节点</button>}
      <button type="button" role="menuitem" className="is-danger" onClick={onDelete}><Trash2 size={14} />删除</button>
    </div>
  );
}
