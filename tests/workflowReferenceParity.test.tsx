import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { WorkflowConfigPanel, WorkflowGenerationCapabilitiesProvider } from '../components/workflow/WorkflowConfigPanel';
import { WorkflowProjectList } from '../components/workflow/WorkflowProjectList';
import { WorkflowToolbar } from '../components/workflow/WorkflowToolbar';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';

describe('workflow reference parity', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ hydrated: true, projects: [], activeProjectId: null });
  });

  it('requires explicit confirmation before deleting a project', () => {
    const project = createWorkflowProject('重要工作流');
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
    render(<WorkflowProjectList />);

    fireEvent.click(screen.getByRole('button', { name: '删除 重要工作流' }));
    expect(useWorkflowStore.getState().projects).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: '删除工作流确认' })).toHaveTextContent('不能撤销');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(useWorkflowStore.getState().projects).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '删除 重要工作流' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(useWorkflowStore.getState().projects).toHaveLength(0);
  });

  it('keeps full video settings wired to generation metadata', () => {
    const node = createWorkflowNode('config', 'config', { x: 0, y: 0 }, { config: { mode: 'video' } });
    const onChange = vi.fn();
    render(<WorkflowGenerationCapabilitiesProvider resolve={() => ({ mode: 'video', models: ['video-model'], aspectRatios: ['16:9'], resolutions: ['720p', '1080p'], durations: [5, 10], supportsReferences: ['image'] })}>
      <WorkflowConfigPanel node={node} onChange={onChange} onRun={vi.fn()} />
    </WorkflowGenerationCapabilitiesProvider>);

    fireEvent.change(screen.getByLabelText('清晰度'), { target: { value: '1080p' } });
    fireEvent.change(screen.getByLabelText('时长'), { target: { value: '10' } });
    fireEvent.click(screen.getByLabelText('生成音频'));
    fireEvent.click(screen.getByLabelText('添加水印'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ resolution: '1080p' }) }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ durationSec: 10 }) }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ generateAudio: true }) }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ watermark: true }) }));
  });

  it('keeps audio metadata editable while generation stays explicitly unsupported', () => {
    const node = createWorkflowNode('audio-config', 'config', { x: 0, y: 0 }, { config: { mode: 'audio' } });
    const onChange = vi.fn();
    render(<WorkflowConfigPanel node={node} onChange={onChange} onRun={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('例如 alloy'), { target: { value: 'nova' } });
    fireEvent.change(screen.getByLabelText('格式'), { target: { value: 'wav' } });
    fireEvent.change(screen.getByLabelText('语速'), { target: { value: '1.25' } });
    fireEvent.change(screen.getByPlaceholderText('音频风格、情绪和发音说明'), { target: { value: '轻声旁白' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ audioVoice: 'nova' }) }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ audioFormat: 'wav' }) }));
    expect(screen.getByRole('button', { name: '暂不支持' })).toBeDisabled();
  });

  it('searches and filters shared image and video resources', () => {
    const onAddSharedMedia = vi.fn();
    render(<WorkflowGenerationCapabilitiesProvider sharedMedia={[
      { id: 'image', name: '产品主图', href: 'data:image/png;base64,AA==', mimeType: 'image/png', type: 'image' },
      { id: 'video', name: '运动参考', href: 'https://example.com/motion.mp4', mimeType: 'video/mp4', type: 'video' },
    ]}>
      <WorkflowToolbar tool="select" canUndo={false} canRedo={false} onToolChange={vi.fn()} onAddNode={vi.fn()} onAddSharedMedia={onAddSharedMedia} onUndo={vi.fn()} onRedo={vi.fn()} onFit={vi.fn()} onToggleGrid={vi.fn()} />
    </WorkflowGenerationCapabilitiesProvider>);

    fireEvent.click(screen.getByRole('button', { name: '打开共享素材' }));
    fireEvent.click(screen.getByRole('button', { name: '视频' }));
    expect(screen.queryByRole('button', { name: '产品主图' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索共享素材' }), { target: { value: '运动' } });
    fireEvent.click(screen.getByRole('button', { name: '运动参考' }));
    expect(onAddSharedMedia).toHaveBeenCalledWith(expect.objectContaining({ id: 'video', type: 'video' }));
  });
});
