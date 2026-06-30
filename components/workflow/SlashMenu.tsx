import { Grid3x3, Aperture, Sun, Film, User, Search, Clapperboard } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlashCommand } from './types';

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'multi-camera-9',
    label: '多机位九宫格',
    description: '从 1 张图生成 9 个不同机位视角（3×3 网格）',
    icon: 'grid',
    category: 'camera',
    mode: 'image',
    minSources: 1,
    maxSources: 1,
    generateCount: 9,
    gridCols: 3,
    promptBuilder: index => {
      const angles = ['front view', 'front-left 3/4 view', 'left side profile', 'back-left 3/4 view', 'back view', 'back-right 3/4 view', 'right side profile', 'front-right 3/4 view', 'top-down bird\'s eye view'];
      return `same subject, ${angles[index] || 'front view'}, different camera angle, consistent identity`;
    },
  },
  {
    id: 'character-3-view',
    label: '角色三视图',
    description: '从 1 张角色图生成前/侧/后三视图',
    icon: 'user',
    category: 'character',
    mode: 'image',
    minSources: 1,
    maxSources: 1,
    generateCount: 3,
    gridCols: 3,
    promptBuilder: index => {
      const views = ['front view', 'side profile view', 'back view'];
      return `character turnaround, ${views[index] || 'front view'}, consistent design`;
    },
  },
  {
    id: 'story-4-grid',
    label: '剧情推演四宫格',
    description: '将描述拆为 4 格剧情演绎图（2×2 网格）',
    icon: 'film',
    category: 'storyboard',
    mode: 'image',
    minSources: 0,
    maxSources: 1,
    generateCount: 4,
    gridCols: 2,
    promptBuilder: index => `story progression, scene ${index + 1} of 4, cinematic narrative beat`,
  },
  {
    id: 'lighting-fix',
    label: '电影级光影矫正',
    description: '修复不稳定光线，专业色彩分级',
    icon: 'sun',
    category: 'enhance',
    mode: 'image',
    minSources: 1,
    maxSources: 1,
    generateCount: 1,
    gridCols: 1,
    promptBuilder: () => 'cinematic lighting correction, professional color grading, balanced exposure, dramatic but natural light',
  },
  {
    id: 'portrait-enhance',
    label: '人像质感增强',
    description: '增强皮肤质感、光影细节',
    icon: 'aperture',
    category: 'enhance',
    mode: 'image',
    minSources: 1,
    maxSources: 1,
    generateCount: 1,
    gridCols: 1,
    promptBuilder: () => 'enhanced skin texture, detailed facial features, soft studio lighting, shallow depth of field, high quality portrait',
  },
  {
    id: 'storyboard-25',
    label: '25宫格连贯分镜',
    description: '将描述拆为 25 帧连贯分镜（5×5 网格）',
    icon: 'clapperboard',
    category: 'storyboard',
    mode: 'image',
    minSources: 0,
    maxSources: 1,
    generateCount: 25,
    gridCols: 5,
    promptBuilder: index => `storyboard frame ${index + 1} of 25, sequential narrative beat, consistent style and characters`,
  },
];

const ICON_MAP: Record<string, typeof Grid3x3> = {
  grid: Grid3x3,
  user: User,
  film: Film,
  sun: Sun,
  aperture: Aperture,
  clapperboard: Clapperboard,
};

const CATEGORY_LABELS: Record<SlashCommand['category'], string> = {
  storyboard: '分镜',
  character: '角色',
  camera: '机位',
  enhance: '增强',
};

export function SlashMenu({ onSelect, onClose }: {
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return SLASH_COMMANDS;
    const lower = query.toLowerCase();
    return SLASH_COMMANDS.filter(cmd =>
      cmd.label.toLowerCase().includes(lower) ||
      cmd.description.toLowerCase().includes(lower) ||
      CATEGORY_LABELS[cmd.category].includes(query),
    );
  }, [query]);

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
              key={command.id}
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
