// /app/home — 应用内产品首页，参考 flova.tv/zh-CN/skill/ 生态重构。
import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Home as HomeIcon,
  Folder as FolderIcon,
  Zap,
  Library,
  Sparkles,
  Tv,
  BookOpen,
  Terminal,
  Plus,
  Send,
  ChevronRight,
  Play,
  Volume2,
  Maximize2,
} from 'lucide-react';
import { useWorkflowStore } from '../workflow/store';
import { COMMUNITY_WORKFLOWS, type CommunityWorkflow } from '../landing/communityTypes';
import type { BundledDirectorSkill } from '../../services/directorSkillCatalog';
import { DirectorSkillShelf } from './DirectorSkillShelf';

const linkTo = (path: string) => (window.location.hash = path);

const SIDEBAR_NAV = [
  { icon: HomeIcon, label: '首页', action: () => linkTo('/app/home') },
  { icon: FolderIcon, label: '项目', action: () => linkTo('/app') },
  { icon: Zap, label: '快速生成', action: () => linkTo('/app') },
  { icon: Library, label: '资产库', action: () => linkTo('/app') },
  { icon: Sparkles, label: 'Skill', action: () => document.getElementById('skill-hub')?.scrollIntoView({ behavior: 'smooth' }) },
  { icon: Tv, label: 'FlovartTV', action: () => document.getElementById('flovarttv')?.scrollIntoView({ behavior: 'smooth' }) },
  { icon: BookOpen, label: '教程', action: () => window.open('https://github.com/avabbbb/Flovart/blob/main/docs', '_blank') },
  { icon: Terminal, label: 'FlovartCLI', action: () => window.open('https://github.com/avabbbb/Flovart', '_blank') },
];

const TV_TABS = ['全部', '影视', '短剧', '漫剧', 'MV', 'TVC'] as const;
type TvTab = (typeof TV_TABS)[number];

// 把 mock 类目映射到页面 tabs
const CATEGORY_TO_TAB: Record<CommunityWorkflow['category'], TvTab> = {
  'TV Show': '影视',
  '人物': '短剧',
  '风景': 'MV',
  '产品': 'TVC',
  '动漫': '漫剧',
  '抽象': 'MV',
};

const TV_SKILL_NAMES = [
  '3D 国漫短剧',
  '剧情短片',
  '剧本生视频',
  '商品宣传短片',
] as const;

// FlovartTV 卡片：用 COMMUNITY_WORKFLOWS mock 资料但映射到 tab
interface TvCardItem {
  id: string;
  title: string;
  author: string;
  gradient: string;
  tab: TvTab;
  skillName: string;
}

const TV_CARDS: TvCardItem[] = COMMUNITY_WORKFLOWS.map((w, i) => {
  const tab = CATEGORY_TO_TAB[w.category] ?? '影视';
  return {
    id: `tv-${w.id ?? i}`,
    title: w.title,
    author: w.author?.name ?? 'flovart',
    gradient: w.gradient,
    tab,
    skillName: TV_SKILL_NAMES[i % TV_SKILL_NAMES.length],
  };
});

function Sidebar() {
  return (
    <aside className="flex flex-col justify-between px-4 py-6" style={{ width: 200, borderRight: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 px-2 mb-6 cursor-pointer" onClick={() => linkTo('/app/home')}>
        <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>Flovart</span>
        <Sparkles size={14} color="#19c8b9" />
      </div>
      <nav className="flex flex-col gap-1 flex-1">
        {SIDEBAR_NAV.map(item => (
          <button
            key={item.label}
            onClick={item.action}
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all hover:bg-white/5 text-left"
            style={{ color: '#a8a49c' }}
          >
            <item.icon size={16} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="flex flex-col gap-3 mt-6 px-3">
        <div className="text-xs font-medium" style={{ color: '#4a463f' }}>邀请/社群</div>
        <div className="flex items-center gap-3">
          <a href="#" className="text-xs hover:text-white" style={{ color: '#6b6862' }}>X</a>
          <a href="#" className="text-xs hover:text-white" style={{ color: '#6b6862' }}>YouTube</a>
          <a href="#" className="text-xs hover:text-white" style={{ color: '#6b6862' }}>Discord</a>
        </div>
      </div>
    </aside>
  );
}

function HeroAndInput({ onCreate }: { onCreate: (title?: string) => void }) {
  const [draft, setDraft] = useState('');
  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onCreate(trimmed.length > 20 ? trimmed.slice(0, 20) + '…' : trimmed);
    setDraft('');
  };
  return (
    <section className="px-10 pt-16 pb-10 flex flex-col items-center">
      <h1 className="text-center" style={{ fontSize: 40, fontWeight: 200, lineHeight: 1.2 }}>
        Flovart 1.0 — 你的专属AI视频创作Agent
      </h1>
      <p className="mt-3 text-center" style={{ fontSize: 16, fontWeight: 300, color: '#a8a49c' }}>
        把品味和习惯写进 Skill，让精力回归创意
      </p>
      <div className="mt-8 w-full" style={{ maxWidth: '70vw' }}>
        <div
          className="rounded-2xl p-4"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="由一个想法或故事开始…"
            rows={2}
            className="w-full bg-transparent outline-none resize-none"
            style={{ color: '#f5f5f0', fontSize: 16 }}
          />
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2">
              <button
                className="rounded-full flex items-center justify-center hover:bg-white/10"
                style={{ width: 32, height: 32, background: 'rgba(255,255,255,0.05)' }}
                title="添加文件"
              >
                <Plus size={16} color="#a8a49c" />
              </button>
              {['模型', 'Skill', '资产库'].map(label => (
                <span
                  key={label}
                  className="rounded-full px-3 py-1 text-xs"
                  style={{ background: 'rgba(255,255,255,0.05)', color: '#a8a49c' }}
                >
                  {label}
                </span>
              ))}
            </div>
            <button
              onClick={submit}
              className="rounded-full flex items-center justify-center transition-all hover:scale-105"
              style={{ width: 36, height: 36, background: '#19c8b9', color: '#fff' }}
              title="发送"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionTitle({ title, extra }: { title: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-2xl font-bold" style={{ color: '#f5f5f0' }}>{title}</h2>
      {extra}
    </div>
  );
}

function RecentProjects({
  projects,
  onCreate,
  onOpen,
}: {
  projects: ReturnType<typeof useWorkflowStore.getState>['projects'];
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 10);
  }, [projects]);

  return (
    <section id="recent-projects" className="px-10 py-6">
      <SectionTitle title="最近项目" extra={<button className="text-sm hover:underline" style={{ color: '#a8a49c' }}>查看全部 <ChevronRight size={14} className="inline" /></button>} />
      <div className="flex gap-4 overflow-x-auto pb-3" style={{ scrollbarWidth: 'thin' }}>
        <button
          onClick={onCreate}
          className="rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all hover:bg-white/5"
          style={{ width: 300, height: 200, border: '2px dashed rgba(255,255,255,0.15)', color: '#a8a49c', flexShrink: 0 }}
        >
          <Plus size={28} />
          <span className="text-sm">创建新项目</span>
        </button>
        {sorted.map(p => (
          <button
            key={p.id}
            onClick={() => onOpen(p.id)}
            className="group rounded-2xl overflow-hidden text-left transition-all hover:scale-[1.02]"
            style={{ width: 300, height: 200, flexShrink: 0, background: p.backgroundMode === 'lines' ? '#1c1c1c' : 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="h-[130px] relative" style={{ background: 'linear-gradient(135deg, #111 0%, #1a1a2e 100%)' }}>
              <div className="absolute inset-0 flex items-center justify-center" style={{ color: '#4a463f' }}>
                <Play size={20} />
              </div>
            </div>
            <div className="px-3 py-2">
              <div className="text-sm font-medium truncate" style={{ color: '#f5f5f0' }}>{p.title || '未命名项目'}</div>
              <div className="text-xs mt-0.5" style={{ color: '#6b6862' }}>最后编辑于 {new Date(p.updatedAt).toLocaleDateString('zh-CN')}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function FlovartTV() {
  const [activeTab, setActiveTab] = useState<TvTab>('全部');
  const [addedSkills, setAddedSkills] = useState<Record<string, boolean>>({});
  const cards = activeTab === '全部' ? TV_CARDS : TV_CARDS.filter(c => c.tab === activeTab);
  return (
    <section id="flovarttv" className="px-10 py-6">
      <SectionTitle title="FlovartTV" />
      <div className="flex gap-2 mb-4 sticky top-0 z-10 py-2" style={{ background: '#0a0a0a' }}>
        {TV_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-4 py-1.5 rounded-full text-sm transition-all"
            style={{
              background: activeTab === tab ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
              color: activeTab === tab ? '#fff' : '#a8a49c',
              border: `1px solid ${activeTab === tab ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)'}`,
            }}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gridAutoRows: 213, gridAutoFlow: 'row dense' }}>
        {cards.map((card, i) => (
          <div
            key={card.id}
            className="group relative rounded-2xl overflow-hidden"
            style={{ gridColumn: i % 5 === 0 ? 'span 1' : undefined, gridRow: 'span 2', height: 438, background: card.gradient, border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span className="absolute top-3 left-3 text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', color: '#fff' }}>{card.tab}</span>
            <div className="absolute top-3 right-3 flex items-center gap-1.5">
              <button className="rounded-full w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}><Volume2 size={12} color="#fff" /></button>
              <button className="rounded-full w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}><Maximize2 size={12} color="#fff" /></button>
            </div>
            <div className="absolute bottom-0 left-0 right-0 p-3 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <div className="rounded-full" style={{ width: 26, height: 26, background: 'rgba(255,255,255,0.18)' }} />
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>@{card.author}</span>
              </div>
              <h3 className="text-sm font-semibold truncate" style={{ color: '#fff' }}>{card.title}</h3>
            </div>
            <div
              className="absolute inset-0 p-3 flex flex-col justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'rgba(0,0,0,0.62)' }}
            >
              <div className="flex items-center justify-between rounded-full px-3 py-1 text-xs self-start" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                <span className="flex items-center gap-1"><Sparkles size={12} /> {card.skillName}</span>
              </div>
              <button
                onClick={() => setAddedSkills(s => ({ ...s, [card.skillName]: !s[card.skillName] }))}
                className="self-start rounded-full px-3 py-1 text-xs"
                style={{ background: addedSkills[card.skillName] ? 'rgba(155,201,87,0.18)' : 'rgba(255,255,255,0.12)', color: addedSkills[card.skillName] ? '#9BC957' : '#fff' }}
              >
                {addedSkills[card.skillName] ? '已添加我的 Skill' : '添加为我的 Skill'}
              </button>
              <div className="h-px" style={{ background: 'rgba(255,255,255,0.18)' }} />
              <div className="flex items-center gap-2">
                <button className="rounded-full px-3 py-1.5 text-xs font-medium" style={{ background: '#fff', color: '#000' }}>查看</button>
                <button className="rounded-full px-3 py-1.5 text-xs flex-1" style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}>查看创作过程</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="px-10 py-8 mt-8" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="grid grid-cols-2 gap-8" style={{ maxWidth: 600 }}>
        <div>
          <div className="text-xs mb-2 font-semibold" style={{ color: '#6b6862' }}>公司</div>
          <ul className="space-y-1 text-xs" style={{ color: '#a8a49c' }}>
            <li><a href="#" className="hover:text-white">关于我们</a></li>
            <li><a href="#" className="hover:text-white">联系</a></li>
            <li><a href="#/business" className="hover:text-white">企业版</a></li>
          </ul>
        </div>
        <div>
          <div className="text-xs mb-2 font-semibold" style={{ color: '#6b6862' }}>社交媒体</div>
          <ul className="space-y-1 text-xs" style={{ color: '#a8a49c' }}>
            <li><a href="#" className="hover:text-white">X</a></li>
            <li><a href="#" className="hover:text-white">YouTube</a></li>
            <li><a href="#" className="hover:text-white">Discord</a></li>
          </ul>
        </div>
      </div>
      <div className="mt-6 text-xs" style={{ color: '#4a463f' }}>© 2026 Flovart · 本地优先 · 开源免费</div>
    </footer>
  );
}

export default function FlovartHome() {
  const projects = useWorkflowStore(s => s.projects);
  const createProject = useWorkflowStore(s => s.createProject);
  const setActiveProject = useWorkflowStore(s => s.setActiveProject);

  const openCanvas = () => linkTo('/app');

  const handleCreate = (title?: string) => {
    const id = createProject(title);
    setActiveProject(id);
    openCanvas();
  };

  const handleOpen = (id: string) => {
    setActiveProject(id);
    openCanvas();
  };

  const handleUseSkill = (skill: BundledDirectorSkill) => {
    handleCreate(`${skill.displayName} 示例`);
  };

  return (
    <div className="flex" style={{ height: '100vh', background: '#0a0a0a', color: '#f5f5f0', fontFamily: '-apple-system, "Segoe UI", "Noto Sans SC", sans-serif' }}>
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <HeroAndInput onCreate={handleCreate} />
        <DirectorSkillShelf onUse={handleUseSkill} />
        <RecentProjects projects={projects} onCreate={() => handleCreate()} onOpen={handleOpen} />
        <FlovartTV />
        <Footer />
      </div>
    </div>
  );
}
