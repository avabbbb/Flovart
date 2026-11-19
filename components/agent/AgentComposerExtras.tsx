import { ArrowRight, BookOpen, Box, Check, Clapperboard, Image as ImageIcon, LayoutGrid, ScanSearch, Sparkles, Upload, Video, WandSparkles, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { getProductModels, type ProductModelDefinition } from '../../services/productModelCatalog';
import { AGENT_CREATION_MODES, type AgentCreationMode } from '../../services/canvasSkillRecipe';
import '../../styles/agentPanelLibtv.css';

type Lang = 'en' | 'zho';
const ui = (language: Lang, zho: string, en: string) => (language === 'zho' ? zho : en);

export type AgentQuickAction = 'perceive' | 'preset' | 'adapt' | 'optimize';

export interface AgentModelSelection {
  id: string;
  capability: 'image' | 'video';
  name: string;
}

export const STORY_TEXT_LIMIT = 8000;

export function creationModeLabel(mode: AgentCreationMode, language: Lang): string {
  const labels: Record<AgentCreationMode, [string, string]> = {
    all: ['全能创作', 'All-round'],
    image: ['图片创作', 'Image'],
    video: ['视频创作', 'Video'],
    storyboard: ['剧本分镜', 'Storyboard'],
  };
  const [zho, en] = labels[mode];
  return ui(language, zho, en);
}

const MODE_ICON: Record<AgentCreationMode, typeof Sparkles> = { all: Sparkles, image: ImageIcon, video: Video, storyboard: Clapperboard };

/** 空会话：居中标志 + 标题，底部四个快捷入口（LibTV 式）。 */
export function AgentEmptyState({ language, onAction, onStoryText }: {
  language: Lang;
  onAction: (action: Exclude<AgentQuickAction, 'adapt'>) => void;
  onStoryText: (text: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const rows: Array<{ id: AgentQuickAction; icon: typeof Sparkles; label: string }> = [
    { id: 'perceive', icon: ScanSearch, label: ui(language, '感知画布开始创作', 'Read the canvas and start') },
    { id: 'preset', icon: BookOpen, label: ui(language, '从爆款预设开始剧本原创', 'Write a script from a hit preset') },
    { id: 'adapt', icon: Upload, label: ui(language, '上传故事来改编', 'Upload a story to adapt') },
    { id: 'optimize', icon: WandSparkles, label: ui(language, '批量优化提示词', 'Optimize prompts in bulk') },
  ];
  return (
    <section className="agent-empty" data-testid="agent-empty-state" aria-label={ui(language, '开始创作', 'Get started')}>
      <div className="agent-empty__hero">
        <span className="agent-empty__logo" aria-hidden="true" />
        <h2>{ui(language, '让 Iris Agent 辅助你的无限创意', 'Let Iris Agent amplify your ideas')}</h2>
      </div>
      <div className="agent-empty__actions">
        {rows.map(row => {
          const Icon = row.icon;
          return (
            <button key={row.id} type="button" className="agent-empty__row" onClick={() => (row.id === 'adapt' ? fileInput.current?.click() : onAction(row.id))}>
              <Icon size={15} />
              <span>{row.label}</span>
              <ArrowRight size={14} />
            </button>
          );
        })}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".txt,.md,text/plain,text/markdown"
        hidden
        data-testid="agent-story-input"
        onChange={async event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          onStoryText((await file.text()).slice(0, STORY_TEXT_LIMIT));
        }}
      />
    </section>
  );
}

/**
 * 「+」菜单里的创作模式分区（不再占输入框底栏）：menuitemradio，选中打勾；选完关闭菜单。
 * 非默认（全能创作以外）时底栏只显示一个可移除的小标签，见 CreationModeTag。
 */
export function CreationModeMenuSection({ value, onChange, language }: {
  value: AgentCreationMode;
  onChange: (mode: AgentCreationMode) => void;
  language: Lang;
}) {
  const title = ui(language, '创作模式', 'Creation mode');
  return (
    <div className="agent-attachment-menu__section" role="group" aria-label={title}>
      <p className="agent-attachment-menu__label" aria-hidden="true">{title}</p>
      {AGENT_CREATION_MODES.map(mode => {
        const ItemIcon = MODE_ICON[mode];
        return (
          <button key={mode} type="button" role="menuitemradio" aria-checked={mode === value} onClick={() => onChange(mode)}>
            <ItemIcon size={15} aria-hidden="true" /><span><strong>{creationModeLabel(mode, language)}</strong></span>{mode === value && <Check size={14} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

/** 底栏里的创作模式小标签：只在非默认模式时出现，✕ 恢复全能创作。 */
export function CreationModeTag({ value, onReset, language }: { value: AgentCreationMode; onReset: () => void; language: Lang }) {
  if (value === 'all') return null;
  const Icon = MODE_ICON[value];
  const label = creationModeLabel(value, language);
  return (
    <span className="agent-mode-tag" data-testid="agent-creation-mode-tag" title={`${ui(language, '创作模式', 'Creation mode')}：${label}`}>
      <Icon size={12} aria-hidden="true" /><span>{label}</span>
      <button type="button" aria-label={ui(language, '恢复全能创作', 'Reset mode')} onClick={onReset}><X size={11} aria-hidden="true" /></button>
    </span>
  );
}

function modelHint(model: ProductModelDefinition): string {
  const extra = model as unknown as { description?: string; company?: string };
  return extra.description || extra.company || model.shortName || '';
}

export function ModelPickerControl({ value, onChange, open, onOpenChange, language }: {
  value: AgentModelSelection | null;
  onChange: (model: AgentModelSelection | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: Lang;
}) {
  const [tab, setTab] = useState<'image' | 'video'>(value?.capability ?? 'image');
  const models = getProductModels(tab);
  const label = ui(language, '选择模型', 'Choose model');
  return (
    <div className="agent-mode-control">
      <button type="button" className={`agent-icon-btn${value ? ' is-active' : ''}`} aria-label={label} title={value ? value.name : label} aria-expanded={open} onClick={() => onOpenChange(!open)}>
        <Box size={15} />
      </button>
      {open && (
        <div className="agent-mode-menu agent-model-menu" role="dialog" aria-label={label}>
          <div className="agent-model-menu__head">
            <strong>{label}</strong>
            <div className="agent-segmented" role="tablist">
              {(['image', 'video'] as const).map(item => (
                <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>
                  {item === 'image' ? ui(language, '图片', 'Image') : ui(language, '视频', 'Video')}
                </button>
              ))}
            </div>
          </div>
          <div className="agent-model-menu__list">
            {models.length === 0 && <p className="agent-model-menu__empty">{ui(language, '暂无可用模型', 'No models')}</p>}
            {models.map(model => {
              const selected = value?.id === model.id;
              return (
                <button key={model.id} type="button" role="menuitemradio" aria-checked={selected} onClick={() => { onChange(selected ? null : { id: model.id, capability: tab, name: model.name }); onOpenChange(false); }}>
                  {tab === 'image' ? <ImageIcon size={15} /> : <Video size={15} />}
                  <span><strong>{model.name}</strong><small>{modelHint(model)}</small></span>
                  {selected && <Check size={14} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export { LayoutGrid };
