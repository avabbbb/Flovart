import { Grid3x3, Aperture, Sun, Film, User, Search, Clapperboard } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useListboxKeyboard } from '../../hooks/useListboxKeyboard';
import { SLASH_SHORTCUTS, SLASH_SHORTCUT_CATEGORY_LABELS, filterSlashShortcuts, type SlashShortcut } from './slashShortcuts';

const ICON_MAP: Record<string, typeof Grid3x3> = {
  grid: Grid3x3,
  user: User,
  film: Film,
  sun: Sun,
  aperture: Aperture,
  clapperboard: Clapperboard,
};

const CATEGORY_LABELS = SLASH_SHORTCUT_CATEGORY_LABELS;

export function SlashMenu({ onSelect, onClose, initialQuery = '', autoFocus = true }: {
  onSelect: (command: SlashShortcut) => void;
  onClose: () => void;
  /** Prompt Bar 里 `/` 之后已输入的字 */
  initialQuery?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const filtered = useMemo(() => filterSlashShortcuts(query, SLASH_SHORTCUTS), [query]);
  // 打开即可输入筛选；↑/↓ 回绕高亮、Enter 选中、Esc 先清空再关闭、输入法组字中不处理（hooks/useListboxKeyboard）。
  const listbox = useListboxKeyboard({ items: filtered, query, onQueryChange: setQuery, onClose, onSelect: command => onSelect(command), autoFocus });
  const activeIndex = listbox.activeIndex;

  return (
    <div
      data-workflow-overlay
      className="workflow-slash-menu"
      onPointerDown={event => event.stopPropagation()}
      {...listbox.getContainerProps()}
    >
      <div className="workflow-slash-menu__search">
        <Search size={14} className="workflow-slash-menu__search-icon" />
        <input
          {...listbox.getInputProps({ value: query, onChange: event => setQuery(event.target.value), placeholder: '搜索命令...', 'aria-label': '搜索命令', className: 'workflow-slash-menu__input' })}
        />
      </div>
      <div {...listbox.getListboxProps({ className: 'workflow-slash-menu__list', 'aria-label': '命令' })}>
        {filtered.length === 0 ? (
          <div className="workflow-slash-menu__empty">无匹配命令</div>
        ) : filtered.map((command, index) => {
          const Icon = ICON_MAP[command.icon] || Grid3x3;
          return (
            <button
              key={command.scene}
              type="button"
              tabIndex={-1}
              {...listbox.getOptionProps(index)}
              className={`workflow-slash-menu__item ${index === activeIndex ? 'workflow-slash-menu__item--active' : ''}`}
              onClick={() => onSelect(command)}
            >
              <Icon size={16} className="workflow-slash-menu__item-icon" />
              <div className="workflow-slash-menu__item-text">
                <div className="workflow-slash-menu__item-label">{command.label}</div>
                <div className="workflow-slash-menu__item-desc">{command.description}</div>
              </div>
              <span className="workflow-slash-menu__item-badge">{CATEGORY_LABELS[command.category]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
