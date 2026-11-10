// 把 Agent 对话导出成 Markdown，供「复制对话」使用。
// 只保留用户能读到的内容：工具调用压成一行摘要，错误单独标注。
import type { WorkflowAgentDisplayMessage } from '../workflow/WorkflowAgentMessages';

const ROLE_LABEL: Record<WorkflowAgentDisplayMessage['role'], { zho: string; en: string }> = {
  user: { zho: '你', en: 'You' },
  assistant: { zho: 'Agent', en: 'Agent' },
  system: { zho: '系统', en: 'System' },
  tool: { zho: '工具调用', en: 'Tool call' },
  error: { zho: '错误', en: 'Error' },
};

export function transcriptMarkdown(
  messages: readonly WorkflowAgentDisplayMessage[],
  options: { language?: 'en' | 'zho'; title?: string } = {},
): string {
  const language = options.language || 'zho';
  const lines: string[] = [];
  if (options.title) lines.push(`# ${options.title}`, '');
  for (const message of messages) {
    const label = ROLE_LABEL[message.role]?.[language] || message.role;
    if (message.role === 'tool') {
      const status = message.status === 'error' || message.status === 'denied'
        ? (language === 'en' ? 'failed' : '失败')
        : message.status === 'pending' ? (language === 'en' ? 'pending' : '等待执行') : (language === 'en' ? 'done' : '完成');
      lines.push(`> ${label}: ${message.title || message.text.split('\n')[0] || ''} (${status})`);
      continue;
    }
    lines.push(`## ${label}`);
    lines.push(message.text.trim() || (language === 'en' ? '(no text)' : '(无内容)'));
    if (message.attachments?.length) lines.push(`_${language === 'en' ? 'Attachments' : '附件'}: ${message.attachments.map(item => item.name).join(', ')}_`);
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

/** 优先用剪贴板 API；非安全上下文（http 局域网）回退到 execCommand。 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒时走回退路径。
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
