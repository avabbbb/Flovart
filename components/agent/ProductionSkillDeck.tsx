import { BookOpen, Check, ChevronDown, Plus, Search, Shuffle, Sparkles, Star, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import localforage from 'localforage';

import {
  createProductionSkillAttachment,
  listBundledProductionSkills,
  type BundledProductionSkill,
  type ProductionSkillAttachment,
} from '../../services/productionSkillCatalog';
import { buildProductionSkillStarterPrompt, productionSkillHandle } from '../../services/productionSkillLaunch';
import voxSkillCover from '../../tools/flovart/evaluations/vox-sky-blue-2026-08-04/preview-hook.jpg';

const SKILL_ACCENTS = [
  ['#f4b452', '#df6b3f'],
  ['#5fc8bb', '#23767b'],
  ['#7f8de7', '#7355ad'],
  ['#d77f9c', '#8d4469'],
] as const;

function skillCover(skill: BundledProductionSkill) {
  return skill.id === 'community.vox-director' ? voxSkillCover : undefined;
}

export function ProductionSkillDeck({
  attachment,
  onChange,
  dropTargetRef,
  onPromptChange,
  showWelcome = false,
}: {
  attachment?: ProductionSkillAttachment;
  onChange: (attachment?: ProductionSkillAttachment) => void;
  dropTargetRef: RefObject<HTMLElement | null>;
  onPromptChange?: (prompt: string) => void;
  showWelcome?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [shuffleOffset, setShuffleOffset] = useState(0);
  const [availableHeight, setAvailableHeight] = useState(380);
  const [activeTab, setActiveTab] = useState<'all' | 'favorites'>('all');
  const [favoriteIds, setFavoriteIds] = useState<ReadonlySet<string>>(new Set());
  const reduceMotion = useReducedMotion();

  // 收藏持久化到本地（localforage）
  useEffect(() => {
    let cancelled = false;
    void localforage.getItem<string[]>('flovart.skill.favorites').then(saved => {
      if (!cancelled) setFavoriteIds(new Set(saved || []));
    });
    return () => { cancelled = true; };
  }, []);

  const toggleFavorite = (id: string) => {
    setFavoriteIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      void localforage.setItem('flovart.skill.favorites', [...next]);
      return next;
    });
  };

  // 弹性高度：picker 从 composer 向上弹出，高度按可用空间比例收缩，避免顶部被面板/视口裁切
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = dropTargetRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const spaceAbove = rect.top - 8;
      setAvailableHeight(Math.max(200, Math.min(400, spaceAbove, viewportHeight * 0.55)));
    };
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [open, dropTargetRef]);
  const skills = listBundledProductionSkills();
  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const byQuery = !normalized
      ? skills
      : skills.filter(skill => [skill.displayName, skill.id, skill.description, productionSkillHandle(skill)]
          .some(value => value.toLowerCase().includes(normalized)));
    return activeTab === 'favorites'
      ? byQuery.filter(skill => favoriteIds.has(skill.id))
      : byQuery;
  }, [query, skills, activeTab, favoriteIds]);
  const welcomeSkills = useMemo(() => skills.length
    ? Array.from({ length: Math.min(4, skills.length) }, (_, index) => skills[(shuffleOffset + index) % skills.length])
    : [], [shuffleOffset, skills]);

  const attach = async (id: string, seedPrompt = false) => {
    const skill = skills.find(item => item.id === id);
    if (!skill || loading) return;
    setLoading(true);
    try {
      onChange(await createProductionSkillAttachment(skill));
      if (seedPrompt) onPromptChange?.(buildProductionSkillStarterPrompt(skill));
      setOpen(false);
      setQuery('');
    } finally {
      setLoading(false);
    }
  };

  const droppedInComposer = (point: { x: number; y: number }) => {
    const rect = dropTargetRef.current?.getBoundingClientRect();
    return Boolean(rect
      && point.x >= rect.left && point.x <= rect.right
      && point.y >= rect.top && point.y <= rect.bottom);
  };

  return (
    <>
      {showWelcome && !attachment && welcomeSkills.length > 0 && (
        <section className="agent-skill-welcome" aria-label="推荐制作 Skill">
          <div className="agent-skill-welcome__heading">
            <BookOpen size={18} />
            <h2>每个 Skill，都是一个开场</h2>
            {skills.length > 1 && <button type="button" onClick={() => setShuffleOffset(value => (value + 1) % skills.length)}><Shuffle size={12} />换一批</button>}
          </div>
          <div className="agent-skill-welcome__grid">
            {welcomeSkills.map((skill, index) => <SkillCard key={`${skill.id}-${index}`} skill={skill} accent={SKILL_ACCENTS[index % SKILL_ACCENTS.length]} onClick={() => void attach(skill.id, true)} />)}
          </div>
        </section>
      )}
      {!showWelcome && <div className="agent-skill-control">
        {attachment ? (
          <span className="agent-skill-chip">
            <BookOpen size={13} />
            <span>{attachment.displayName}</span>
            <button type="button" aria-label={`移除 ${attachment.displayName}`} onClick={() => onChange(undefined)}><X size={11} /></button>
          </span>
        ) : (
          <button type="button" aria-label="选择制作 Skill" className="agent-composer-tool" onClick={() => setOpen(value => !value)}>
            <BookOpen size={16} /><span>Skill</span><ChevronDown size={12} />
          </button>
        )}
        <AnimatePresence>
          {open && (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="agent-skill-picker"
              role="dialog"
              aria-label="Skill"
              style={{ maxHeight: availableHeight }}
            >
              <header className="agent-skill-picker__header">
                <strong>Skill</strong>
                <button type="button" className="agent-skill-picker__create" disabled><Plus size={16} />创建</button>
                <button type="button" className="agent-skill-picker__filter">全部</button>
                <button type="button" aria-label="关闭 Skill" onClick={() => setOpen(false)}><X size={15} /></button>
              </header>
              <div className="agent-skill-picker__toolbar">
                <div role="tablist" aria-label="Skill 分类"><button type="button" aria-selected={activeTab === 'all'} onClick={() => setActiveTab('all')}>通用</button><button type="button" aria-selected={activeTab === 'favorites'} onClick={() => setActiveTab('favorites')}>收藏{favoriteIds.size > 0 ? `（${favoriteIds.size}）` : ''}</button></div>
                <label><Search size={15} /><input autoFocus aria-label="搜索 Skill" placeholder="搜索 Skill" value={query} onChange={event => setQuery(event.target.value)} /></label>
              </div>
              <div className="agent-skill-picker__list">
                {filteredSkills.map((skill, index) => (
                  <motion.button
                    key={skill.id}
                    type="button"
                    aria-label={`添加 ${skill.displayName}`}
                    disabled={loading}
                    whileHover={reduceMotion ? undefined : { x: 2 }}
                    whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                    whileDrag={reduceMotion ? undefined : { scale: 1.02 }}
                    drag
                    dragElastic={0.14}
                    dragSnapToOrigin
                    onDragEnd={(_, info) => { if (droppedInComposer(info.point)) void attach(skill.id); }}
                    transition={{ type: 'spring', stiffness: 520, damping: 30 }}
                    className="agent-skill-picker__row"
                    onClick={() => void attach(skill.id)}
                  >
                    <SkillMark accent={SKILL_ACCENTS[index % SKILL_ACCENTS.length]} cover={skillCover(skill)} />
                    <span><strong>{skill.displayName}<em>{productionSkillHandle(skill)}</em></strong><small>{skill.description}</small></span>
                    <i>{attachment?.id === skill.id ? <Check size={13} /> : '详情'}</i>
                    <span role="button" tabIndex={-1} aria-label={favoriteIds.has(skill.id) ? `取消收藏 ${skill.displayName}` : `收藏 ${skill.displayName}`} title={favoriteIds.has(skill.id) ? '取消收藏' : '收藏'}
                      onClick={event => { event.stopPropagation(); toggleFavorite(skill.id); }}
                      style={{ flex: '0 0 auto', display: 'grid', width: 22, height: 22, placeContent: 'center', borderRadius: 5, color: favoriteIds.has(skill.id) ? '#d97757' : 'var(--isl-ink-ghost)' }}>
                      <Star size={13} fill={favoriteIds.has(skill.id) ? 'currentColor' : 'none'} />
                    </span>
                  </motion.button>
                ))}
                {!filteredSkills.length && <div className="agent-skill-picker__empty">未找到匹配的 Skill</div>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>}
    </>
  );
}

function SkillMark({ accent, cover }: { accent: readonly [string, string]; cover?: string }) {
  return <span className="agent-skill-mark" style={{ background: `linear-gradient(135deg, ${accent[0]}, ${accent[1]})` }}>{cover ? <img src={cover} alt="" /> : <Sparkles size={15} />}</span>;
}

function SkillCard({ skill, accent, onClick }: { skill: BundledProductionSkill; accent: readonly [string, string]; onClick: () => void }) {
  return (
    <motion.button type="button" className="agent-skill-card" aria-label={`使用 Skill ${skill.displayName}`} onClick={onClick} whileHover={{ y: -2 }} whileTap={{ scale: .98 }} transition={{ type: 'spring', stiffness: 440, damping: 30 }}>
      <SkillMark accent={accent} cover={skillCover(skill)} />
      <span><strong>{skill.displayName}</strong><small>{productionSkillHandle(skill)}</small></span>
    </motion.button>
  );
}
