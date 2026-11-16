// Composer 里两个浮层（@ 引用、Skill）共用的键盘与筛选规则：焦点始终留在输入框，
// 高亮用 aria-activedescendant 表达；↑/↓ 移动，Enter / Tab 选中，Esc 关闭，悬停同步高亮。

/**
 * 下一个高亮下标。-1 表示仍在输入框。
 * exitAbove：在第一项按 ↑ 回到输入框（-1）；否则夹住在 0。到末尾按 ↓ 停在最后一项（不回绕，避免误跳）。
 */
export function nextHighlight(index: number, count: number, delta: 1 | -1, options: { exitAbove?: boolean; wrap?: boolean } = {}): number {
  if (count <= 0) return -1;
  if (index < 0) return delta > 0 ? 0 : (options.wrap ? count - 1 : -1);
  const next = index + delta;
  if (next < 0) return options.wrap ? count - 1 : options.exitAbove ? -1 : 0;
  if (next >= count) return options.wrap ? 0 : count - 1;
  return next;
}

/** 列表变短后把高亮夹回范围内。 */
export function clampHighlight(index: number, count: number): number {
  if (count <= 0 || index < 0) return -1;
  return Math.min(index, count - 1);
}

const TYPE_WORDS: Record<string, string[]> = {
  image: ['图片', '图像', '照片', 'image', 'img', 'picture', 'photo'],
  video: ['视频', '影片', 'video', 'clip', 'movie'],
  audio: ['音频', '声音', 'audio', 'sound'],
  text: ['文本', '文字', 'text', 'note'],
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

/** 节点类型或 MIME → image / video / audio / text。 */
export function mediaKind(mediaType?: string): string {
  const value = String(mediaType || '').toLowerCase();
  if (value.startsWith('image') || value === 'image') return 'image';
  if (value.startsWith('video')) return 'video';
  if (value.startsWith('audio')) return 'audio';
  if (value === 'text' || value.startsWith('text/')) return 'text';
  return value;
}

/**
 * @ 后的实时筛选：名称子串（忽略空格与大小写，「图片3」能匹配「图片 3」），
 * 或类型词（「视频」「image」）。查询由「类型词 + 余下文字」组成时两者都要满足，例如「视频2」。
 */
export function matchesReference(item: { label: string; mediaType?: string }, rawQuery: string): boolean {
  const query = normalize(rawQuery);
  if (!query) return true;
  const label = normalize(item.label);
  if (label.includes(query)) return true;
  const kind = mediaKind(item.mediaType);
  const words = TYPE_WORDS[kind] || [];
  for (const word of words) {
    const normalizedWord = normalize(word);
    if (query === normalizedWord || normalizedWord.startsWith(query)) return true;
    if (query.startsWith(normalizedWord)) {
      const rest = query.slice(normalizedWord.length);
      if (!rest || label.includes(rest)) return true;
    }
  }
  return false;
}

/**
 * 悬停 / 键盘预览卡放哪：以最近的裁切容器（右侧 Agent 面板、画布内 Agent 窗）为界，而不是视口。
 * 面板外壳 overflow 会裁掉越界的卡片——左侧放得下才放左边，否则放上方，都不行就不显示。
 */
export function previewPlacement(host: Element, width: number, height: number): 'left' | 'above' | 'hidden' {
  const rect = host.getBoundingClientRect();
  const clip = host.closest('.compact-right-panel, .workflow-agent, .agent-conversation')?.getBoundingClientRect();
  const left = clip ? rect.left - clip.left : rect.left;
  const top = clip ? rect.top - clip.top : rect.top;
  if (left >= width + 16) return 'left';
  if (top >= height + 16) return 'above';
  return 'hidden';
}
