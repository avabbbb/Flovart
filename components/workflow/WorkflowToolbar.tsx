import { Bot, Focus, Grid2X2, Hand, ImagePlus, Library, Music2, Redo2, Settings2, Type, Undo2, Video } from 'lucide-react';
import { useRef, useState } from 'react';
import { useWorkflowSharedMedia, type WorkflowSharedMedia } from './WorkflowConfigPanel';
import type { WorkflowNodeType } from './types';

export type WorkflowTool = 'select' | 'pan';

export function WorkflowToolbar({
  tool,
  canUndo,
  canRedo,
  onToolChange,
  onAddNode,
  onImport,
  onAddSharedMedia,
  onUndo,
  onRedo,
  onFit,
  onToggleGrid,
  onOpenAgent,
}: {
  tool: WorkflowTool;
  canUndo: boolean;
  canRedo: boolean;
  onToolChange: (tool: WorkflowTool) => void;
  onAddNode: (type: WorkflowNodeType) => void;
  onImport: (file: File) => Promise<void>;
  onAddSharedMedia: (media: WorkflowSharedMedia) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onToggleGrid: () => void;
  onOpenAgent?: () => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const sharedMedia = useWorkflowSharedMedia();
  const [libraryOpen, setLibraryOpen] = useState(false);
  return (
    <div className="workflow-toolbar" role="toolbar" aria-label="工作流工具栏">
      <button type="button" className={tool === 'select' ? 'is-active' : ''} aria-label="选择工具" onClick={() => onToolChange('select')}><Focus size={16} /></button>
      <button type="button" className={tool === 'pan' ? 'is-active' : ''} aria-label="平移工具" onClick={() => onToolChange('pan')}><Hand size={16} /></button>
      <span className="workflow-toolbar__divider" />
      <button type="button" aria-label="添加文本节点" onClick={() => onAddNode('text')}><Type size={16} /></button>
      <button type="button" aria-label="添加图片节点" onClick={() => imageInput.current?.click()}><ImagePlus size={16} /></button>
      <button type="button" aria-label="添加视频节点" onClick={() => videoInput.current?.click()}><Video size={16} /></button>
      <button type="button" aria-label="添加音频节点" onClick={() => audioInput.current?.click()}><Music2 size={16} /></button>
      <button type="button" aria-label="打开共享素材" onClick={() => setLibraryOpen(open => !open)}><Library size={16} /></button>
      <button type="button" aria-label="添加配置节点" onClick={() => onAddNode('config')}><Settings2 size={16} /></button>
      <input ref={imageInput} hidden type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void onImport(file); event.currentTarget.value = ''; }} />
      <input ref={videoInput} hidden type="file" accept="video/*" onChange={event => { const file = event.target.files?.[0]; if (file) void onImport(file); event.currentTarget.value = ''; }} />
      <input ref={audioInput} hidden type="file" accept="audio/*" onChange={event => { const file = event.target.files?.[0]; if (file) void onImport(file); event.currentTarget.value = ''; }} />
      <span className="workflow-toolbar__divider" />
      <button type="button" aria-label="撤销" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></button>
      <button type="button" aria-label="重做" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></button>
      <button type="button" aria-label="适应视图" onClick={onFit}><Focus size={16} /></button>
      <button type="button" aria-label="切换网格" onClick={onToggleGrid}><Grid2X2 size={16} /></button>
      {onOpenAgent && <><span className="workflow-toolbar__divider" /><button type="button" aria-label="打开 Agent" onClick={onOpenAgent}><Bot size={16} /></button></>}
      {libraryOpen && <div className="workflow-toolbar__library">{sharedMedia.length ? sharedMedia.map(media => <button type="button" key={media.id} onClick={() => { onAddSharedMedia(media); setLibraryOpen(false); }}><img src={media.href} alt="" /><span>{media.name}</span></button>) : <p>素材库和生成历史为空。</p>}</div>}
    </div>
  );
}
