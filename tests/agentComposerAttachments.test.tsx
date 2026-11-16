import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FlovartAgentPanel } from '../components/agent/FlovartAgentPanel';
import { createWorkflowProject } from '../components/workflow/store';
import { getManagedAgentConnection } from '../services/managedAgentConnection';
import { attachmentKind, mergeComposerAttachments, type AgentComposerAttachment } from '../services/agentComposerAttachments';

vi.mock('../services/managedAgentConnection', () => ({
  getManagedAgentConnection: vi.fn(),
}));

const insertLocalImagesIntoProject = vi.hoisted(() => vi.fn());
vi.mock('../components/workflow/WorkflowWorkspace', () => ({ insertLocalImagesIntoProject }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const attachment = (id: string): AgentComposerAttachment => ({
  id, name: id + '.png', kind: 'image', mimeType: 'image/png', bytes: 3, previewUrl: 'blob:' + id, file: new File(['abc'], id + '.png', { type: 'image/png' }),
});

describe('agent composer attachments', () => {
  it('classifies only image and video files', () => {
    expect(attachmentKind('image/png')).toBe('image');
    expect(attachmentKind('video/mp4')).toBe('video');
    expect(attachmentKind('text/plain')).toBeNull();
  });

  it('keeps at most the cap and reports overflow', () => {
    const { kept, rejected } = mergeComposerAttachments([attachment('a'), attachment('b')], [attachment('c'), attachment('d')], 3);
    expect(kept.map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(rejected.map(item => item.id)).toEqual(['d']);
  });

  describe('panel', () => {
    afterEach(() => vi.unstubAllGlobals());

    beforeEach(() => {
      vi.mocked(getManagedAgentConnection).mockResolvedValue({ state: 'ready', url: '', token: 'desktop-token', managed: true });
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
        String(input).includes('/agent/flovart/turn') ? json({ ok: true }) : json({ sessionId: 'session-attach', projectId: 'project-attach', running: false, messages: [] })
      )));
      vi.stubGlobal('URL', Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:local-preview'),
        revokeObjectURL: vi.fn(),
      }));
    });

    const renderPanel = () => render(<FlovartAgentPanel project={{ ...createWorkflowProject('附件项目'), id: 'project-attach' }} onActivityChange={vi.fn()} onOpenSettings={vi.fn()} />);

    it('attaches a pasted screenshot and enables sending without text', async () => {
      renderPanel();
      const input = await screen.findByPlaceholderText('告诉 Flovart Agent 你想制作什么');
      fireEvent.paste(input, { clipboardData: { files: [new File(['abc'], 'paste.png', { type: 'image/png' })] } });

      expect(await screen.findByLabelText('本轮附件')).toBeInTheDocument();
      const send = screen.getByRole('button', { name: '发送' });
      await waitFor(() => expect(send).toBeEnabled());
      expect(screen.getByLabelText('移除附件 paste.png')).toBeInTheDocument();
    });

    it('drops a video onto the composer and removes it again', async () => {
      renderPanel();
      await screen.findByPlaceholderText('告诉 Flovart Agent 你想制作什么');
      const composer = screen.getByTestId('agent-composer');
      fireEvent.drop(composer, { dataTransfer: { files: [new File(['abc'], 'clip.mp4', { type: 'video/mp4' })], items: [] } });

      const remove = await screen.findByLabelText('移除附件 clip.mp4');
      fireEvent.click(remove);
      await waitFor(() => expect(screen.queryByLabelText('本轮附件')).not.toBeInTheDocument());
      expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    });

    // 2026-11-16 内置 Agent 实测 P1-2：拖进输入框的图只成了附件，直接发给纯文本模型报错，也没上画布。
    it('drops an image onto the composer: it lands on the canvas and is referenced as a node, not attached', async () => {
      insertLocalImagesIntoProject.mockResolvedValueOnce({ ok: true, nodes: [{ id: 'node-dropped', title: '图片 3' }] });
      renderPanel();
      await screen.findByPlaceholderText('告诉 Flovart Agent 你想制作什么');
      const file = new File(['abc'], 'meeting.webp', { type: 'image/webp' });
      fireEvent.drop(screen.getByTestId('agent-composer'), { dataTransfer: { files: [file], items: [] } });

      await waitFor(() => expect(insertLocalImagesIntoProject).toHaveBeenCalledWith('project-attach', [file]));
      expect(await screen.findByLabelText('已引用内容')).toHaveTextContent('图片 3');
      expect(screen.queryByLabelText('本轮附件')).not.toBeInTheDocument();
    });

    it('falls back to an attachment when the image cannot be placed on the canvas', async () => {
      insertLocalImagesIntoProject.mockResolvedValueOnce({ ok: false, error: 'x' });
      renderPanel();
      await screen.findByPlaceholderText('告诉 Flovart Agent 你想制作什么');
      fireEvent.drop(screen.getByTestId('agent-composer'), { dataTransfer: { files: [new File(['abc'], 'a.png', { type: 'image/png' })], items: [] } });
      expect(await screen.findByLabelText('移除附件 a.png')).toBeInTheDocument();
    });
  });
});
