// 快捷键表：结构改编自 OpenCut classic apps/web/src/actions/definitions.ts（MIT，见 third_party/opencut/LICENSE）——
// 动作定义 + 默认按键表 + 按键规范化；默认键位改成剪映 / CapCut 的习惯（⌘/Ctrl+B 切分、Q/W 删左/右、↑↓ 跳剪辑点）。

export type CutAction =
  | 'toggle-play' | 'split' | 'delete-left' | 'delete-right' | 'delete-selected'
  | 'undo' | 'redo' | 'copy' | 'paste' | 'duplicate'
  | 'frame-back' | 'frame-forward' | 'prev-cut' | 'next-cut'
  | 'zoom-in' | 'zoom-out' | 'toggle-snapping' | 'show-shortcuts' | 'select-all' | 'deselect';

export interface CutActionDefinition { zh: string; en: string; category: 'playback' | 'editing' | 'navigation' | 'history' | 'timeline' }

export const CUT_ACTIONS: Record<CutAction, CutActionDefinition> = {
  'toggle-play': { zh: '播放 / 暂停', en: 'Play / pause', category: 'playback' },
  split: { zh: '在播放头处切分', en: 'Split at playhead', category: 'editing' },
  'delete-left': { zh: '删除播放头左侧', en: 'Delete left of playhead', category: 'editing' },
  'delete-right': { zh: '删除播放头右侧', en: 'Delete right of playhead', category: 'editing' },
  'delete-selected': { zh: '删除所选', en: 'Delete selection', category: 'editing' },
  copy: { zh: '复制', en: 'Copy', category: 'editing' },
  paste: { zh: '粘贴到播放头', en: 'Paste at playhead', category: 'editing' },
  duplicate: { zh: '创建副本', en: 'Duplicate', category: 'editing' },
  undo: { zh: '撤销', en: 'Undo', category: 'history' },
  redo: { zh: '重做', en: 'Redo', category: 'history' },
  'frame-back': { zh: '上一帧', en: 'Previous frame', category: 'navigation' },
  'frame-forward': { zh: '下一帧', en: 'Next frame', category: 'navigation' },
  'prev-cut': { zh: '上一个剪辑点', en: 'Previous cut point', category: 'navigation' },
  'next-cut': { zh: '下一个剪辑点', en: 'Next cut point', category: 'navigation' },
  'zoom-in': { zh: '时间线放大', en: 'Zoom timeline in', category: 'timeline' },
  'zoom-out': { zh: '时间线缩小', en: 'Zoom timeline out', category: 'timeline' },
  'toggle-snapping': { zh: '吸附开关', en: 'Toggle snapping', category: 'timeline' },
  'select-all': { zh: '全选', en: 'Select all', category: 'editing' },
  deselect: { zh: '取消选择', en: 'Deselect', category: 'editing' },
  'show-shortcuts': { zh: '快捷键一览', en: 'Keyboard shortcuts', category: 'timeline' },
};

/** 规范化按键：mod = ⌘（mac）或 Ctrl。 */
export const CUT_DEFAULT_SHORTCUTS: ReadonlyArray<readonly [CutAction, readonly string[]]> = [
  ['toggle-play', ['space']],
  ['split', ['mod+b']],
  ['delete-left', ['q']],
  ['delete-right', ['w']],
  ['delete-selected', ['delete', 'backspace']],
  ['undo', ['mod+z']],
  ['redo', ['mod+shift+z', 'mod+y']],
  ['copy', ['mod+c']],
  ['paste', ['mod+v']],
  ['duplicate', ['mod+d']],
  ['frame-back', ['left']],
  ['frame-forward', ['right']],
  ['prev-cut', ['up']],
  ['next-cut', ['down']],
  ['zoom-in', ['mod+=', 'mod+plus']],
  ['zoom-out', ['mod+-']],
  ['toggle-snapping', ['n']],
  ['select-all', ['mod+a']],
  ['deselect', ['escape']],
  ['show-shortcuts', ['shift+/', '?']],
];

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space', spacebar: 'space', arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down',
  esc: 'escape', del: 'delete', '+': 'plus', '_': '-', '＝': '=', '－': '-',
};

/** KeyboardEvent → 'mod+shift+b' 这种规范串。 */
export function shortcutFromEvent(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): string {
  let key = (event.key || '').toLowerCase();
  // 用物理键位兜底，中文输入法 / Shift 改变字符时仍然对得上。
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5);
  else if (event.code === 'Equal') key = '=';
  else if (event.code === 'Minus') key = '-';
  else if (event.code === 'Slash') key = '/';
  else if (event.code === 'NumpadAdd') key = 'plus';
  else if (event.code === 'NumpadSubtract') key = '-';
  key = KEY_ALIASES[key] ?? key;
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey && key !== '?') parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

const BY_KEY = new Map<string, CutAction>();
for (const [action, keys] of CUT_DEFAULT_SHORTCUTS) for (const key of keys) BY_KEY.set(key, action);

export function actionForEvent(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): CutAction | null {
  return BY_KEY.get(shortcutFromEvent(event)) ?? (event.key === '?' ? 'show-shortcuts' : null);
}

export function formatShortcut(shortcut: string, mac: boolean) {
  return shortcut.split('+').map(part => ({
    mod: mac ? '⌘' : 'Ctrl', shift: mac ? '⇧' : 'Shift', alt: mac ? '⌥' : 'Alt', space: 'Space', left: '←', right: '→', up: '↑', down: '↓',
    delete: 'Delete', backspace: '⌫', escape: 'Esc', plus: '+', '=': '+',
  }[part] ?? part.toUpperCase())).join(mac ? '' : '+');
}
