import { describe, expect, it } from 'vitest';
import { transcriptMarkdown } from '../components/agent/agentTranscript';
import { entriesUpTo } from '../services/browserAgentKernel';
import type { WorkflowAgentDisplayMessage } from '../components/workflow/WorkflowAgentMessages';

describe('transcript markdown', () => {
  it('exports user/assistant turns with a title and skips empty tool detail', () => {
    const messages: WorkflowAgentDisplayMessage[] = [
      { id: '1', role: 'user', text: '把镜头 1 延长到 15 秒' },
      { id: '2', role: 'assistant', text: '好的，已修改时长。' },
      { id: '3', role: 'tool', text: '{"ok":true}', title: '批量修改画布', status: 'success' },
    ];
    const text = transcriptMarkdown(messages, { language: 'zho', title: '新对话' });

    expect(text).toContain('# 新对话');
    expect(text).toContain('## 你\n把镜头 1 延长到 15 秒');
    expect(text).toContain('## Agent\n好的，已修改时长。');
    expect(text).toContain('> 工具调用: 批量修改画布 (完成)');
    expect(text).not.toContain('{"ok":true}');
  });

  it('marks attachments and errors', () => {
    const messages: WorkflowAgentDisplayMessage[] = [
      { id: '1', role: 'user', text: '看这张图', attachments: [{ id: 'a', name: 'shot.png', previewUrl: 'blob:x' }] },
      { id: '2', role: 'error', text: 'No agent-text route is configured' },
    ];
    const text = transcriptMarkdown(messages, { language: 'en' });
    expect(text).toContain('_Attachments: shot.png_');
    expect(text).toContain('## Error\nNo agent-text route is configured');
  });
});

describe('branch slice', () => {
  it('keeps entries up to and including the branch point', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(entriesUpTo(entries, 'b')?.map(entry => entry.id)).toEqual(['a', 'b']);
  });

  it('returns null when the branch point is missing', () => {
    expect(entriesUpTo([{ id: 'a' }], 'missing')).toBeNull();
  });
});
