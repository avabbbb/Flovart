import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { createWorkflowNode } from '../components/workflow/constants';
import { InfiniteWorkflow } from '../components/workflow/InfiniteWorkflow';
import { WorkflowNode } from '../components/workflow/WorkflowNode';
import { WorkflowImageToolDialogs } from '../components/workflow/WorkflowImageToolDialogs';
import { WorkflowGenerationCapabilitiesProvider } from '../components/workflow/WorkflowConfigPanel';
import { workflowMediaStorage } from '../components/workflow/storage';
import type { WorkflowProject } from '../components/workflow/types';
import * as imageToolService from '../services/workflowImageTools';

const image = createWorkflowNode('image', 'image', { x: 0, y: 0 }, { href: 'data:image/png;base64,AA==', mimeType: 'image/png', filters: { brightness: 120 } });

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await workflowMediaStorage.clear();
});

function ImageHarness({ initial }: { initial: WorkflowProject }) {
  const [project, setProject] = useState(initial);
  return <WorkflowGenerationCapabilitiesProvider><InfiniteWorkflow project={project} updateProject={patch => setProject(current => ({ ...current, ...patch }))} onRunNode={vi.fn()} /></WorkflowGenerationCapabilitiesProvider>;
}

function imageProject(filters: WorkflowProject['nodes'][number]['metadata']['filters'] = {}) {
  return {
    id: 'image-project', title: '图片工具', nodes: [{ ...image, metadata: { ...image.metadata, filters } }], connections: [], selectedNodeIds: ['image'], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'dots' as const,
    agentSessions: [], activeAgentSessionId: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } satisfies WorkflowProject;
}

describe('workflow image tools UI', () => {
  it('renders persisted filters on image nodes', () => {
    render(<WorkflowNode node={image} selected onPointerDown={vi.fn()} onConnectStart={vi.fn()} onResizeStart={vi.fn()} onChangeText={vi.fn()} onChangeMetadata={vi.fn()} onRun={vi.fn()} onContextMenu={vi.fn()} onReplaceMedia={vi.fn()} onRemoveMedia={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveStyle({ filter: 'brightness(1.2)' });
  });

  it('opens crop, filter, upscale, outpaint, mask and split interfaces with real confirmations', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<WorkflowImageToolDialogs tool={{ kind: 'crop', nodeId: 'image' }} node={image} mediaUrl={image.metadata.href!} busy={false} error={null} onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: '应用裁剪' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ kind: 'crop', crop: expect.any(Object) }));
    for (const [kind, action] of [['filter', '完成调色'], ['upscale', '开始放大'], ['outpaint', '开始扩展'], ['mask', 'AI 修改'], ['split', '拆分图层']] as const) {
      rerender(<WorkflowImageToolDialogs tool={{ kind, nodeId: 'image' }} node={image} mediaUrl={image.metadata.href!} busy={false} error={null} onClose={vi.fn()} onConfirm={onConfirm} />);
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
    }
  });

  it('streams filter changes to the canonical node and keeps submit single-shot while busy', () => {
    const onPreview = vi.fn();
    const onConfirm = vi.fn();
    const view = render(<WorkflowImageToolDialogs tool={{ kind: 'filter', nodeId: 'image' }} node={image} mediaUrl={image.metadata.href!} busy={false} error={null} onClose={vi.fn()} onPreview={onPreview} onConfirm={onConfirm} />);
    fireEvent.change(view.container.querySelector('input[type="range"]')!, { target: { value: '130' } });
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ brightness: 130 }));
    const submit = screen.getByRole('button', { name: '完成调色' });
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    view.rerender(<WorkflowImageToolDialogs tool={{ kind: 'filter', nodeId: 'image' }} node={image} mediaUrl={image.metadata.href!} busy error={null} onClose={vi.fn()} onPreview={onPreview} onConfirm={onConfirm} />);
    expect(screen.getByRole('button', { name: '完成调色' })).toBeDisabled();
  });

  it('previews filters on the canvas, confirms one history entry, and restores them on cancel', async () => {
    render(<ImageHarness initial={imageProject()} />);
    fireEvent.click(screen.getByRole('button', { name: '图片滤镜' }));
    fireEvent.change(document.querySelector('.image-filter-panel input[type="range"]')!, { target: { value: '135' } });
    await waitFor(() => expect(screen.getByRole('img', { name: '图片' })).toHaveStyle({ filter: 'brightness(1.35)' }));
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '完成调色' }));
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByRole('img', { name: '图片' }).style.filter).toBe('');

    fireEvent.click(screen.getByRole('button', { name: '图片滤镜' }));
    fireEvent.change(document.querySelector('.image-filter-panel input[type="range"]')!, { target: { value: '145' } });
    fireEvent.click(screen.getByText('✕').closest('button')!);
    await waitFor(() => expect(screen.getByRole('img', { name: '图片' }).style.filter).toBe('');
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });

  it('crops into durable storage, preserves the node center and ratio, and is undoable', async () => {
    class TestImage {
      naturalWidth = 800; naturalHeight = 600; onload: null | (() => void) = null; onerror = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', TestImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['crop'], { type: 'image/png' })));
    render(<ImageHarness initial={imageProject()} />);
    fireEvent.click(screen.getByRole('button', { name: '裁剪图片' }));
    fireEvent.click(screen.getByRole('button', { name: '应用裁剪' }));
    await waitFor(() => expect(document.querySelector('[data-workflow-node-id="image"]')).toHaveStyle({ width: '420px', height: '315px', transform: 'translate(-40px, -37.5px)' }));
    const stored = (await workflowMediaStorage.keys()).find(key => key.startsWith('workflow-media-'));
    expect(stored && await workflowMediaStorage.get(stored)).toBeInstanceOf(Blob);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(document.querySelector('[data-workflow-node-id="image"]')).toHaveStyle({ width: '340px', height: '240px', transform: 'translate(0px, 0px)' });
  });

  it('does not report success or add history after a project switch makes the provider result stale', async () => {
    let finish!: (value: imageToolService.WorkflowImageToolOutcome) => void;
    vi.spyOn(imageToolService, 'runWorkflowImageAgent').mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const projectA = imageProject();
    const projectB = { ...imageProject(), id: 'other-project', nodes: [], selectedNodeIds: [] };
    const view = render(<WorkflowGenerationCapabilitiesProvider><InfiniteWorkflow project={projectA} updateProject={vi.fn()} onRunNode={vi.fn()} /></WorkflowGenerationCapabilitiesProvider>);
    fireEvent.click(screen.getByRole('button', { name: '移除背景' }));
    await waitFor(() => expect(imageToolService.runWorkflowImageAgent).toHaveBeenCalled());
    view.rerender(<WorkflowGenerationCapabilitiesProvider><InfiniteWorkflow project={projectB} updateProject={vi.fn()} onRunNode={vi.fn()} /></WorkflowGenerationCapabilitiesProvider>);
    finish({ status: 'stale', project: projectB });
    expect(screen.queryByText('背景移除完成')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });
});
