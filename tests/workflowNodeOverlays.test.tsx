import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { WorkflowNodeToolbar } from '../components/workflow/WorkflowNodeToolbar';
import { WorkflowNodePromptBar } from '../components/workflow/WorkflowNodePromptBar';
import { PromptBar } from '../components/PromptBar';

const t = (key: string) => key;
const node = createWorkflowNode('image', 'image', { x: 100, y: 80 }, {
  prompt: '初始提示词',
  config: { mode: 'image', modelId: 'image-model' },
});

describe('workflow node overlays', () => {
  it('uses the shared toolbar shell and exposes only wired actions', () => {
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    render(<WorkflowNodeToolbar nodes={[node]} onCopy={onCopy} onDelete={onDelete} onRun={vi.fn()} onReplaceMedia={vi.fn()} onToggleFreeResize={vi.fn()} />);
    expect(screen.getByTestId('workflow-node-toolbar')).toHaveClass('isl-shell');
    fireEvent.click(screen.getByRole('button', { name: '复制节点' }));
    fireEvent.click(screen.getByRole('button', { name: '删除节点' }));
    expect(onCopy).toHaveBeenCalledWith(['image']);
    expect(onDelete).toHaveBeenCalledWith(['image']);
  });

  it('isolates pointer and wheel events at the overlay boundary', () => {
    const pointer = vi.fn();
    const wheel = vi.fn();
    render(<div onPointerDown={pointer} onWheel={wheel}><WorkflowNodeToolbar nodes={[node]} onCopy={vi.fn()} onDelete={vi.fn()} /></div>);
    const overlay = screen.getByTestId('workflow-node-toolbar');
    fireEvent.pointerDown(overlay);
    fireEvent.wheel(overlay);
    expect(pointer).not.toHaveBeenCalled();
    expect(wheel).not.toHaveBeenCalled();
  });

  it('binds prompt mode and model changes to canonical workflow metadata', () => {
    const onChange = vi.fn();
    render(<WorkflowNodePromptBar
      node={node}
      nodes={[node, createWorkflowNode('other', 'text', { x: 0, y: 0 }, { content: '参考文案' })]}
      t={t}
      theme="light"
      language="zho"
      userApiKeys={[]}
      modelPreference={{ textModel: '', imageModel: 'image-model', videoModel: 'video-model' }}
      dynamicModelOptions={{ text: [], image: ['image-model'], video: ['video-model'] }}
      onChange={onChange}
      onRun={vi.fn()}
    />);
    expect(screen.getByTestId('workflow-node-prompt-bar')).toBeInTheDocument();
    expect(screen.getByText('初始提示词')).toBeInTheDocument();
    fireEvent.click(screen.getByText(content => content.includes('image-model')).closest('button')!);
    fireEvent.click(screen.getAllByRole('button', { name: /image-model/ }).at(-1)!);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ modelId: 'image-model' }) }));
    fireEvent.click(screen.getAllByText('图片')[0].closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: '文本' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ mode: 'text' }) }));
  });

  it('replaces a rich prompt preset without retaining stale mention ids', () => {
    const onPromptInputChange = vi.fn();
    render(<PromptBar t={t} theme="light" prompt="@旧引用" promptDocument={{ type: 'doc', content: [] }} setPrompt={vi.fn()} onPromptInputChange={onPromptInputChange} onGenerate={vi.fn()} isLoading={false} isSelectionActive={false} selectedElementCount={0} userEffects={[{ id: 'effect', name: '干净预设', value: '新的提示词' }]} onAddUserEffect={vi.fn()} onDeleteUserEffect={vi.fn()} generationMode="image" setGenerationMode={vi.fn()} videoAspectRatio="16:9" setVideoAspectRatio={vi.fn()} />);
    fireEvent.click(screen.getByTitle('更多操作'));
    fireEvent.click(screen.getByRole('button', { name: /干净预设/ }));
    expect(onPromptInputChange).toHaveBeenCalledWith(expect.objectContaining({ plainText: '新的提示词', mentionedElementIds: [] }));
  });

  it('runs text nodes in text mode and exposes stop while loading', () => {
    const onStop = vi.fn();
    const textNode = createWorkflowNode('text', 'text', { x: 0, y: 0 }, { prompt: '写旁白', status: 'loading', config: { mode: 'text', modelId: 'text-model', count: 1 } });
    render(<WorkflowNodePromptBar node={textNode} nodes={[textNode]} t={t} theme="light" language="zho" userApiKeys={[]} modelPreference={{ textModel: 'text-model', imageModel: '', videoModel: '' }} dynamicModelOptions={{ text: ['text-model'], image: [], video: [] }} onChange={vi.fn()} onRun={vi.fn()} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
    expect(onStop).toHaveBeenCalled();
    expect(screen.getByText('文本')).toBeInTheDocument();
  });

  it('provides six-way multi alignment and only renders real optional actions', () => {
    const onAlign = vi.fn();
    render(<WorkflowNodeToolbar nodes={[node, { ...node, id: 'second' }]} onCopy={vi.fn()} onDelete={vi.fn()} onAlign={onAlign} />);
    ['左对齐节点', '水平居中节点', '右对齐节点', '顶部对齐节点', '垂直居中节点', '底部对齐节点'].forEach(name => fireEvent.click(screen.getByRole('button', { name })));
    expect(onAlign.mock.calls.map(call => call[0])).toEqual(['left', 'horizontal-center', 'right', 'top', 'vertical-center', 'bottom']);
    expect(screen.queryByRole('button', { name: '保存到素材库' })).not.toBeInTheDocument();
  });

  it('wires prompt focus, save, replace, free resize, download, run and stop actions', () => {
    const callbacks = { focus: vi.fn(), save: vi.fn(), replace: vi.fn(), resize: vi.fn(), run: vi.fn(), stop: vi.fn() };
    const media = { ...node, metadata: { ...node.metadata, href: 'data:image/png;base64,AA==', name: 'image.png' } };
    const { container, rerender } = render(<WorkflowNodeToolbar nodes={[media]} onCopy={vi.fn()} onDelete={vi.fn()} onRun={callbacks.run} onStop={callbacks.stop} onPromptFocus={callbacks.focus} onSaveMedia={callbacks.save} onReplaceMedia={callbacks.replace} onToggleFreeResize={callbacks.resize} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑提示词' }));
    fireEvent.click(screen.getByRole('button', { name: '保存到素材库' }));
    fireEvent.click(screen.getByRole('button', { name: '切换自由缩放' }));
    fireEvent.click(screen.getByRole('button', { name: '运行节点' }));
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'replacement.png', { type: 'image/png' })] } });
    expect(screen.getByRole('link', { name: '下载媒体' })).toHaveAttribute('download', 'image.png');
    expect([callbacks.focus, callbacks.save, callbacks.resize, callbacks.run, callbacks.replace].every(callback => callback.mock.calls.length === 1)).toBe(true);
    rerender(<WorkflowNodeToolbar nodes={[{ ...media, metadata: { ...media.metadata, status: 'loading' } }]} onCopy={vi.fn()} onDelete={vi.fn()} onRun={callbacks.run} onStop={callbacks.stop} />);
    fireEvent.click(screen.getByRole('button', { name: '停止节点' }));
    expect(callbacks.stop).toHaveBeenCalledWith(media.id);
  });

  it('shows image tools only when real handlers are supplied', () => {
    const imageTools = { crop: vi.fn(), filter: vi.fn(), upscale: vi.fn(), removeBackground: vi.fn(), outpaint: vi.fn(), mask: vi.fn(), splitLayers: vi.fn() };
    const mediaNode = { ...node, metadata: { ...node.metadata, href: 'data:image/png;base64,AA==' } };
    const { rerender } = render(<WorkflowNodeToolbar nodes={[mediaNode]} onCopy={vi.fn()} onDelete={vi.fn()} imageTools={imageTools} />);
    ['裁剪图片', '图片滤镜', '高清放大', '移除背景', '扩展画面', '编辑蒙版', '拆分图层'].forEach(name => fireEvent.click(screen.getByRole('button', { name })));
    expect(Object.values(imageTools).every(handler => handler.mock.calls[0][0] === mediaNode.id)).toBe(true);
    rerender(<WorkflowNodeToolbar nodes={[mediaNode]} onCopy={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '裁剪图片' })).not.toBeInTheDocument();
  });
});
