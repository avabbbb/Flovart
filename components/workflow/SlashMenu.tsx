import { Grid3x3, Aperture, Sun, Film, User, Search, Clapperboard } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const filtered = useMemo(() => filterSlashShortcuts(query, SLASH_SHORTCUTS), [query]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(prev => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (filtered[activeIndex]) onSelect(filtered[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      data-workflow-overlay
      className="workflow-slash-menu"
      onPointerDown={event => event.stopPropagation()}
    >
      <div className="workflow-slash-menu__search">
        <Search size={14} className="workflow-slash-menu__search-icon" />
        <input
          ref={inputRef}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索命令..."
          className="workflow-slash-menu__input"
        />
      </div>
      <div className="workflow-slash-menu__list">
        {filtered.length === 0 ? (
          <div className="workflow-slash-menu__empty">无匹配命令</div>
        ) : filtered.map((command, index) => {
          const Icon = ICON_MAP[command.icon] || Grid3x3;
          return (
            <button
              key={command.scene}
              className={`workflow-slash-menu__item ${index === activeIndex ? 'workflow-slash-menu__item--active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
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
