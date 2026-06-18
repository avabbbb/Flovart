import { Image as ImageIcon, LoaderCircle, Music2, Settings2, Type, Video } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { WorkflowConfigPanel } from './WorkflowConfigPanel';
import type { WorkflowNode as WorkflowNodeData } from './types';

const iconByType = {
  image: ImageIcon,
  text: Type,
  video: Video,
  audio: Music2,
  config: Settings2,
};

export function WorkflowNode({
  node,
  selected,
  onPointerDown,
  onConnectStart,
  onResizeStart,
  onChangeText,
  onChangeMetadata,
  onRun,
  onContextMenu,
}: {
  node: WorkflowNodeData;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onConnectStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onChangeText: (value: string) => void;
  onChangeMetadata: (metadata: WorkflowNodeData['metadata']) => void;
  onRun: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const Icon = iconByType[node.type];
  const status = node.metadata.status || 'idle';
  return (
    <div
      data-workflow-node-id={node.id}
      className={`workflow-node workflow-node--${node.type}${selected ? ' is-selected' : ''}`}
      style={{ transform: `translate(${node.position.x}px, ${node.position.y}px)`, width: node.width, height: node.height }}
      onPointerDown={onPointerDown}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onContextMenu(event); }}
    >
      <button className="workflow-handle workflow-handle--target" aria-label="连接到此节点" data-workflow-target={node.id} />
      <button className="workflow-handle workflow-handle--source" aria-label="从此节点连接" onPointerDown={onConnectStart} />
      <header className="workflow-node__header">
        <Icon size={14} />
        <span>{node.title}</span>
        {status === 'loading' && <LoaderCircle size={13} className="workflow-spin" />}
        {status === 'error' && <span className="workflow-node__error-dot" title={node.metadata.error}>!</span>}
      </header>
      <div className="workflow-node__body">
        {node.type === 'image' && (node.metadata.href
          ? <img src={node.metadata.href} alt={node.title} draggable={false} />
          : <div className="workflow-node__empty"><ImageIcon size={26} /><span>图片节点</span></div>)}
        {node.type === 'video' && (node.metadata.href
          ? <video src={node.metadata.href} poster={node.metadata.poster} controls preload="metadata" />
          : <div className="workflow-node__empty"><Video size={26} /><span>视频节点</span></div>)}
        {node.type === 'audio' && (node.metadata.href
          ? <audio src={node.metadata.href} controls preload="metadata" style={{ width: '100%' }} />
          : <div className="workflow-node__empty"><Music2 size={26} /><span>音频节点</span></div>)}
        {node.type === 'text' && (
          <textarea
            value={node.metadata.content || ''}
            placeholder="输入文本或提示词"
            onPointerDown={event => event.stopPropagation()}
            onChange={event => onChangeText(event.target.value)}
          />
        )}
        {node.type === 'config' && (
          <WorkflowConfigPanel node={node} onChange={onChangeMetadata} onRun={onRun} />
        )}
      </div>
      <button className="workflow-resize" aria-label="调整节点大小" onPointerDown={onResizeStart} />
    </div>
  );
}
