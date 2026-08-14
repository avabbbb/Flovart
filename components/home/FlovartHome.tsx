import { useMemo, useRef, useState } from 'react';
import {
  Bot,
  BookOpen,
  ChevronRight,
  Clapperboard,
  FolderClock,
  Home as HomeIcon,
  Image as ImageIcon,
  LayoutGrid,
  MonitorPlay,
  Plus,
  Send,
  Sparkles,
  Table2,
  Video,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { nanoid } from 'nanoid';

import contactSheet from '../../tools/flovart/evaluations/vox-history-1776/contact-sheet-10.png';
import smokeFilm from '../../tools/flovart/evaluations/vox-history-1776/_smoke/render-smoke.mp4';
import hookFrame from '../../tools/flovart/evaluations/vox-sky-blue-2026-08-04/preview-hook.jpg';
import detailFrame from '../../tools/flovart/evaluations/vox-sky-blue-2026-08-04/preview-hookdetail.jpg';
import payoffFrame from '../../tools/flovart/evaluations/vox-sky-blue-2026-08-04/preview-payoff.jpg';
import workflowPreview from '../../tools/flovart/evaluations/reddit-politics-2026-07-25/workflow-cli-sync.png';
import { createWorkflowNode } from '../workflow/constants';
import { useWorkflowStore } from '../workflow/store';
import type { WorkflowProject, WorkflowNodeType } from '../workflow/types';
import type { BundledProductionSkill } from '../../services/productionSkillCatalog';
import { buildProductionSkillStarterPrompt } from '../../services/productionSkillLaunch';
import { queuePendingProductionSkill } from '../../stores/useProductionSkillComposerStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { ProductionSkillShelf } from './ProductionSkillShelf';
import '../../styles/home.css';

const linkTo = (path: string) => { window.location.hash = path; };

type WorkspaceTarget = 'workflow' | 'table' | 'agent';
type Capability = {
  title: string;
  description: string;
  badge: string;
  media: string;
  mediaType?: 'video';
  target: WorkspaceTarget | 'skill';
  icon: typeof WorkflowIcon;
};

const CAPABILITIES: Capability[] = [
  {
    title: '无限 Workflow',
    description: '文本、图片、视频与处理步骤在同一空间自由编排。',
    badge: '画布',
    media: workflowPreview,
    target: 'workflow',
    icon: WorkflowIcon,
  },
  {
    title: '图片生成与迭代',
    description: '参考图、提示词和参数贴着节点走，结果可继续连接。',
    badge: '图片',
    media: hookFrame,
    target: 'workflow',
    icon: ImageIcon,
  },
  {
    title: '轻量视频节点',
    description: '封面优先加载，需要时再启用播放器，支持大批量视频。',
    badge: '视频',
    media: smokeFilm,
    mediaType: 'video',
    target: 'workflow',
    icon: Video,
  },
  {
    title: '脚本到分镜',
    description: '把脚本、镜头与生成结果组织成可追溯的制作链路。',
    badge: '分镜',
    media: contactSheet,
    target: 'workflow',
    icon: Clapperboard,
  },
  {
    title: '节点式媒体处理',
    description: '裁剪、拆分、拼接等处理保留输入与输出关系。',
    badge: 'Table',
    media: detailFrame,
    target: 'table',
    icon: Table2,
  },
  {
    title: 'Agent + Production Skill',
    description: '让 Agent 读取项目上下文，按制作方法推进并回写产物。',
    badge: 'Agent',
    media: payoffFrame,
    target: 'skill',
    icon: Bot,
  },
];

const TYPE_LABELS: Record<WorkflowNodeType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
  config: '配置',
  script: '脚本',
  operation: '处理',
};

function HomeRail({ onCreate, onOpenView }: {
  onCreate: () => void;
  onOpenView: (view: WorkspaceTarget) => void;
}) {
  const actions = [
    { label: '首页', icon: HomeIcon, action: () => document.querySelector('.flovart-home__scroll')?.scrollTo({ top: 0, behavior: 'smooth' }) },
    { label: '新建项目', icon: Plus, action: onCreate, primary: true },
    { label: 'Workflow', icon: WorkflowIcon, action: () => onOpenView('workflow') },
    { label: 'Table', icon: Table2, action: () => onOpenView('table') },
    { label: 'Agent', icon: Bot, action: () => onOpenView('agent') },
    { label: 'Skill', icon: Sparkles, action: () => document.getElementById('skill-hub')?.scrollIntoView({ behavior: 'smooth' }) },
  ];
  return (
    <nav className="flovart-home__rail" aria-label="首页导航">
      <button className="home-rail__brand" type="button" aria-label="Flovart 首页" onClick={() => linkTo('/app/home')}>F</button>
      <div className="home-rail__actions">
        {actions.map(item => (
          <button
            key={item.label}
            type="button"
            className={item.primary ? 'is-primary' : undefined}
            aria-label={item.label}
            title={item.label}
            onClick={item.action}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <a href="https://github.com/avabbbb/Flovart/tree/main/docs" target="_blank" rel="noreferrer" aria-label="文档" title="文档">
        <BookOpen size={18} /><span>文档</span>
      </a>
    </nav>
  );
}

function CapabilityCard({ item, onOpen }: { item: Capability; onOpen: (target: Capability['target']) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const startPreview = () => { if (videoRef.current) void videoRef.current.play().catch(() => undefined); };
  const stopPreview = () => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    videoRef.current.currentTime = 0;
  };
  return (
    <button
      type="button"
      className="home-capability"
      onClick={() => onOpen(item.target)}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
      onFocus={startPreview}
      onBlur={stopPreview}
      aria-label={`${item.title}：${item.description}`}
    >
      {item.mediaType === 'video'
        ? <video ref={videoRef} src={item.media} muted loop playsInline preload="metadata" poster={contactSheet} />
        : <img src={item.media} alt="" draggable={false} />}
      <span className="home-capability__shade" />
      <span className="home-capability__badge">{item.badge}</span>
      <span className="home-capability__copy">
        <strong><item.icon size={15} />{item.title}</strong>
        <small>{item.description}</small>
      </span>
      <span className="home-capability__open">进入 <ChevronRight size={13} /></span>
    </button>
  );
}

function Hero({ onCreate, onOpen }: {
  onCreate: () => void;
  onOpen: (target: Capability['target']) => void;
}) {
  return (
    <>
      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero__copy">
          <span className="home-eyebrow"><Sparkles size={13} /> AI 原生制作空间</span>
          <h1 id="home-hero-title">一张 Workflow，<br />把想法连到最终成片</h1>
          <p>从素材、生成、处理到 Agent 协作，每一步都留在可编辑的节点关系里。</p>
          <button type="button" className="home-primary-action" onClick={onCreate}><Plus size={17} />新建 Workflow</button>
        </div>
        <div className="home-capability-grid">
          {CAPABILITIES.map(item => <CapabilityCard key={item.title} item={item} onOpen={onOpen} />)}
        </div>
      </section>
      <div className="home-quick-strip" aria-label="核心能力">
        {[
          [MonitorPlay, '图片 / 视频生成', '结果直接成为节点'],
          [WorkflowIcon, '自由编排', '关系与版本可追溯'],
          [Table2, '媒体处理', '输入输出显式连接'],
          [Bot, 'Agent 协作', '读取上下文并回写'],
        ].map(([Icon, title, detail]) => (
          <span key={String(title)}><i><Icon size={16} /></i><strong>{String(title)}</strong><small>{String(detail)}</small></span>
        ))}
      </div>
    </>
  );
}

function IdeaComposer({ onSubmit, onCreateEmpty }: {
  onSubmit: (idea: string) => void;
  onCreateEmpty: () => void;
}) {
  const [draft, setDraft] = useState('');
  const submit = () => {
    const idea = draft.trim();
    if (!idea) return;
    onSubmit(idea);
    setDraft('');
  };
  return (
    <div className="home-agent-composer">
      <textarea
        aria-label="创作想法"
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="说出你的创意，或者选一个 Skill 开始创作"
        rows={3}
      />
      <div>
        <button type="button" className="home-composer-tool" onClick={onCreateEmpty}><Plus size={16} />空白 Workflow</button>
        <span><WorkflowIcon size={14} />想法会保存为首个文本节点</span>
        <button type="button" className="home-composer-send" aria-label="发送" disabled={!draft.trim()} onClick={submit}><Send size={17} /></button>
      </div>
    </div>
  );
}

function ProjectPreview({ project }: { project: WorkflowProject }) {
  const visible = project.nodes.filter(node => node.isVisible !== false).slice(0, 6);
  return (
    <div className="home-project-preview" aria-hidden="true">
      <span className="home-project-preview__grid" />
      {visible.length ? visible.map((node, index) => (
        <i key={node.id} data-type={node.type} style={{ left: `${10 + (index % 3) * 28}%`, top: `${18 + Math.floor(index / 3) * 38}%` }}>
          {node.type === 'video' ? <Video size={13} /> : node.type === 'image' ? <ImageIcon size={13} /> : node.type === 'script' ? <Clapperboard size={13} /> : <LayoutGrid size={13} />}
        </i>
      )) : <span className="home-project-preview__empty"><Plus size={20} />空白画布</span>}
    </div>
  );
}

function RecentProjects({ projects, onCreate, onOpen, onOpenAll }: {
  projects: WorkflowProject[];
  onCreate: () => void;
  onOpen: (id: string) => void;
  onOpenAll: () => void;
}) {
  const sorted = useMemo(() => [...projects]
    .sort((left, right) => +new Date(right.updatedAt) - +new Date(left.updatedAt))
    .slice(0, 7), [projects]);
  return (
    <section id="recent-projects" className="home-section">
      <div className="home-section__heading">
        <div><span>LOCAL PROJECTS</span><h2>最近项目</h2></div>
        <button type="button" onClick={onOpenAll}>查看全部 <ChevronRight size={14} /></button>
      </div>
      <div className="home-project-grid">
        <button type="button" className="home-project-card home-project-card--new" onClick={onCreate}>
          <span><Plus size={24} /></span><strong>创建新项目</strong><small>从空白 Workflow 开始</small>
        </button>
        {sorted.map(project => {
          const counts = project.nodes.reduce<Partial<Record<WorkflowNodeType, number>>>((result, node) => {
            result[node.type] = (result[node.type] || 0) + 1;
            return result;
          }, {});
          const summary = Object.entries(counts).slice(0, 3).map(([type, count]) => `${count} ${TYPE_LABELS[type as WorkflowNodeType]}`).join(' · ') || '空白 Workflow';
          return (
            <button type="button" className="home-project-card" key={project.id} onClick={() => onOpen(project.id)}>
              <ProjectPreview project={project} />
              <span className="home-project-card__meta">
                <strong>{project.title || '未命名项目'}</strong>
                <small>{summary}</small>
                <em>打开创作过程 <ChevronRight size={13} /></em>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function FlovartHome() {
  const projects = useWorkflowStore(state => state.projects);
  const createProject = useWorkflowStore(state => state.createProject);
  const setActiveProject = useWorkflowStore(state => state.setActiveProject);
  const setActiveView = useWorkspaceStore(state => state.setActiveView);

  const openView = (view: WorkspaceTarget) => {
    setActiveView(view);
    linkTo('/app');
  };
  const createEmpty = () => {
    const id = createProject();
    setActiveProject(id);
    openView('workflow');
  };
  const startFromIdea = (idea: string) => {
    const title = idea.length > 28 ? `${idea.slice(0, 28)}…` : idea;
    const projectId = createProject(title);
    const node = createWorkflowNode(nanoid(), 'text', { x: 120, y: 120 }, { content: idea, prompt: idea });
    useWorkflowStore.getState().updateProject(projectId, { nodes: [node], selectedNodeIds: [node.id] });
    setActiveProject(projectId);
    openView('agent');
  };
  const openProject = (id: string) => {
    setActiveProject(id);
    openView('workflow');
  };
  const openCapability = (target: Capability['target']) => {
    if (target === 'skill') {
      document.getElementById('skill-hub')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    openView(target);
  };
  const useSkill = (skill: BundledProductionSkill) => {
    const projectId = createProject(`${skill.displayName} 示例`);
    setActiveProject(projectId);
    queuePendingProductionSkill({
      projectId,
      skillId: skill.id,
      skillVersion: skill.version,
      skillName: skill.displayName,
      prompt: buildProductionSkillStarterPrompt(skill),
    });
    try { localStorage.setItem('flovart.workflow.agent.mode', 'local'); } catch { /* keep the current mode */ }
    openView('agent');
  };

  return (
    <div className="flovart-home">
      <HomeRail onCreate={createEmpty} onOpenView={openView} />
      <main className="flovart-home__scroll">
        <header className="home-topbar">
          <strong>Flovart</strong><span>本地优先的 AI 视频制作空间</span>
          <button type="button" onClick={() => document.getElementById('recent-projects')?.scrollIntoView({ behavior: 'smooth' })}><FolderClock size={15} />本地项目 {projects.length}</button>
        </header>
        <div className="flovart-home__content">
          <Hero onCreate={createEmpty} onOpen={openCapability} />
          <section className="home-agent" aria-labelledby="home-agent-title">
            <div className="home-section__heading">
              <div><span>FLOVART AGENT</span><h2 id="home-agent-title">说出创意，或者选择一种制作方法</h2></div>
              <button type="button" onClick={() => openView('agent')}>打开 Agent <ChevronRight size={14} /></button>
            </div>
            <div className="home-agent__panel">
              <IdeaComposer onSubmit={startFromIdea} onCreateEmpty={createEmpty} />
              <ProductionSkillShelf onUse={useSkill} />
            </div>
          </section>
          <RecentProjects projects={projects} onCreate={createEmpty} onOpen={openProject} onOpenAll={() => openView('workflow')} />
          <footer className="home-footer">
            <span>Flovart · Workflow / Table / Agent</span>
            <a href="https://github.com/avabbbb/Flovart" target="_blank" rel="noreferrer">GitHub <ChevronRight size={13} /></a>
          </footer>
        </div>
      </main>
    </div>
  );
}
