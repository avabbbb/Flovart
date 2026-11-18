// 发给模型的用户消息会带上引用节点 ID、附带画面说明等上下文；
// 这些是写给模型的，不该原样出现在用户自己的气泡里。

const PREAMBLE = /^(\[(创作模式|首选(视频|图片)模型): [^\]]+\]\s*)+\n?/;

/** 把内核里存的用户消息还原成用户当时看到的样子：正文 + 「引用：@…」「附件：…」。 */
export function displayUserTurnText(text: string): string {
  if (!text) return text;
  const blocks = text.replace(PREAMBLE, '').split(/\n{2,}/);
  const out: string[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed.startsWith('引用上下文：')) {
      const labels = [...trimmed.matchAll(/^- @(.+?)（/gm)].map(match => '@' + match[1]);
      if (labels.length) out.push('引用：' + labels.join('、'));
      continue;
    }
    if (trimmed.startsWith('本轮附带的本地媒体')) {
      const names = [...trimmed.matchAll(/「(.+?)」/g)].map(match => match[1]);
      if (names.length) out.push('附件：' + names.join('、'));
      continue;
    }
    if (trimmed.startsWith('已附带画面：') || trimmed.startsWith('注意：本轮附带的本地媒体')) continue;
    out.push(block);
  }
  return out.join('\n\n').trim();
}

const TOOL_LABELS: Record<string, { zho: string; en: string }> = {
  flovart_workflow_inspect: { zho: '读取画布', en: 'Read canvas' },
  flovart_workflow_selection_get: { zho: '读取选中节点', en: 'Read selection' },
  flovart_workflow_apply: { zho: '修改画布', en: 'Edit canvas' },
  flovart_workflow_node_run: { zho: '运行生成', en: 'Run generation' },
  flovart_workflow_node_tool: { zho: '画布工具', en: 'Canvas tool' },
  flovart_image_tool: { zho: '图片工具', en: 'Image tool' },
  flovart_video_tool: { zho: '视频工具', en: 'Video tool' },
  flovart_audio_tool: { zho: '音频工具', en: 'Audio tool' },
  flovart_node_tool_list: { zho: '工具说明', en: 'Tool manual' },
  flovart_workflow_media_view: { zho: '查看画面', en: 'View media' },
  flovart_workflow_search_nodes: { zho: '查找节点', en: 'Find nodes' },
  flovart_web_search: { zho: '联网搜索', en: 'Web search' },
  flovart_grep: { zho: '搜索本地文件', en: 'Search local files' },
  flovart_todo: { zho: '任务清单', en: 'To-do list' },
  flovart_ask: { zho: '向你提问', en: 'Question for you' },
  flovart_skill_read: { zho: '读取技能', en: 'Read skill' },
  flovart_memory: { zho: '项目记忆', en: 'Project memory' },
  flovart_pipeline_run_start: { zho: '创建制作 run', en: 'Start run' },
  flovart_pipeline_run_get: { zho: '读取制作 run', en: 'Read run' },
};

/** 工具卡标题用人话；未登记的工具（插件等）保持原名。 */
export function agentToolLabel(toolName: string | undefined, language: 'en' | 'zho'): string | undefined {
  if (!toolName) return toolName;
  return TOOL_LABELS[toolName]?.[language] || toolName;
}
