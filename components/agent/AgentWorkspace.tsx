import { Sparkles } from 'lucide-react';
import '../../styles/agent.css';
import type { WorkflowProject } from '../workflow/types';

/**
 * Dedicated top-level Agent surface.
 *
 * This page is for discovering, preparing, and switching local/external coding
 * agents (Codex, WorkBuddy, etc.). It intentionally does not contain the
 * built-in Flovart assistant; that assistant stays beside Canvas/Table in the
 * right drawer so users can keep the work visible while chatting.
 */
function isHostedDemo(): boolean {
  if (typeof window === 'undefined') return false;
  const { protocol, hostname } = window.location;
  return protocol === 'https:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname);
}

export function AgentConnectionsPage({ project, language = 'zho' }: { project: WorkflowProject | null; language?: 'en' | 'zho' }) {
  void project;
  const hosted = isHostedDemo();
  const zh = language === 'zho';
  const copy = zh
    ? {
        tag: 'Agent · DSH',
        title: '用 DeepSeek Harness（DSH）指挥画布',
        body: 'DSH 主会话是指挥入口，Flovart 插件在 Iris 页签中读取并修改你当前可见的 Workflow。生成仍走同一条确认与提交链路。',
        envHosted: '你正在使用线上演示页（HTTPS）。线上页无法连接你电脑上的 DSH 或本地 Agent：浏览器会阻止 HTTPS 页面访问本机 http 服务。以下步骤需要在本地工作区完成。',
        envLocal: '当前为本地工作区，可按以下步骤连接 DSH。',
        stepsTitle: '本地连接步骤',
        steps: [
          ['克隆 Flovart 仓库并安装依赖', 'npm install'],
          ['安装 DSH Profile（兼容 DeepSeek Harness 0.1.0-rc.8，Node 22.19+ 或 24+）', 'npm run dsh:profile:install'],
          ['启动 DSH；启动器会准备本地工作区并打开可见 Workflow', 'npm run dsh:start'],
          ['在 DeepSeek 主会话切换到 Iris 页签，用自然语言指挥，例如“创建三个镜头的工作流”，再“只修改第二个镜头”', ''],
          ['回到本地画布查看变更；没有可见 Workflow 时 DSH 会明确提示，不会创建隐藏副本', ''],
        ],
        status: '状态：插件已在本地完成打包与干净 Profile 安装验证；npm 发布与插件市场尚未完成；真实 DeepSeek 登录态下的对话验收待验证。',
        drawer: '不连接 DSH 也可以在画布右侧的助手面板继续工作。',
      }
    : {
        tag: 'Agent · DSH',
        title: 'Drive the canvas from DeepSeek Harness (DSH)',
        body: 'The DSH main conversation is the command entry; the Flovart plugin reads and edits your currently visible Workflow from the Iris tab. Generation still goes through the same confirm-and-submit path.',
        envHosted: 'You are on the hosted demo (HTTPS). It cannot reach DSH or a local agent on your computer: browsers block HTTPS pages from calling local http services. The steps below run in a local workspace.',
        envLocal: 'This is a local workspace; follow the steps below to connect DSH.',
        stepsTitle: 'Local setup',
        steps: [
          ['Clone the Flovart repo and install dependencies', 'npm install'],
          ['Install the DSH profile (DeepSeek Harness 0.1.0-rc.8, Node 22.19+ or 24+)', 'npm run dsh:profile:install'],
          ['Start DSH; the launcher prepares the local workspace and opens a visible Workflow', 'npm run dsh:start'],
          ['In the DeepSeek main conversation open the Iris tab and give instructions, e.g. "create a three-shot workflow", then "only change the second shot"', ''],
          ['Check the change on the local canvas; with no visible Workflow DSH says so and never creates a hidden copy', ''],
        ],
        status: 'Status: packaged and installed into a clean profile locally; npm publish and marketplace listing not done yet; conversation acceptance under a real DeepSeek login still unverified.',
        drawer: 'Without DSH you can keep working in the assistant panel beside the canvas.',
      };
  return (
    <div className="h-full min-h-0 overflow-y-auto" data-testid="agent-connections-page" style={{ color: 'var(--isl-ink)' }}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <section className={'agent-connections-page_' + '_surface'} data-testid="agent-connections-surface" aria-labelledby="agent-connections-title">
          <header className={'agent-connections-page_' + '_header'}>
            <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--isl-ink-ghost)' }}>{copy.tag}</span>
            <h1 id="agent-connections-title">{copy.title}</h1>
            <p>{copy.body}</p>
          </header>
          <div className="m-3 rounded-xl border p-4 text-sm" role="note" data-testid="agent-env-note" data-env={hosted ? 'hosted' : 'local'} style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface)' }}>
            {hosted ? copy.envHosted : copy.envLocal}
          </div>
          <div className="m-3 rounded-xl border p-4" data-testid="agent-dsh-steps" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface)' }}>
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={18} style={{ color: 'var(--isl-mint)' }} />
              <strong className="text-sm">{copy.stepsTitle}</strong>
            </div>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
              {copy.steps.map(([text, command]) => (
                <li key={text}>
                  <span>{text}</span>
                  {command ? <code className="ml-2 rounded px-1.5 py-0.5 text-xs" style={{ background: 'var(--isl-surface-strong, rgba(0,0,0,0.06))' }}>{command}</code> : null}
                </li>
              ))}
            </ol>
          </div>
          <p className="mx-3 text-xs" data-testid="agent-dsh-status" style={{ color: 'var(--isl-ink-soft)' }}>{copy.status}</p>
          <p className="mx-3 mb-3 mt-1 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>{copy.drawer}</p>
        </section>
      </div>
    </div>
  );
}

/**
 * Project-less onboarding for the in-context assistant drawer. A Workflow is
 * required before the built-in assistant can edit the shared canvas.
 */
export function AgentDrawerEmptyState({ onCreateProject, language = 'zho' }: { onCreateProject: () => void; language?: 'en' | 'zho' }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="agent-drawer-empty" style={{ color: 'var(--isl-ink)' }}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CreateProjectCard onCreateProject={onCreateProject} language={language} />
      </div>
    </div>
  );
}

function CreateProjectCard({ onCreateProject, language }: { onCreateProject: () => void; language: 'en' | 'zho' }) {
  const copy = language === 'zho'
    ? { title: '从一个新项目开始', body: '创建画布后，你和助手可以一起编辑，结果会保存在这里。', create: '创建项目' }
    : { title: 'Start with a new project', body: 'Create a canvas to edit together with your assistant. Your work will be saved here.', create: 'Create project' };
  return (
    <div className="m-3 rounded-xl border p-5 text-center" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface)' }}>
      <Sparkles className="mx-auto mb-2" size={22} style={{ color: 'var(--isl-mint)' }} />
      <strong className="text-sm">{copy.title}</strong>
      <p className="mt-1 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>{copy.body}</p>
      <button type="button" className="mx-auto mt-3 rounded-lg border px-3 py-2 text-xs font-semibold" style={{ borderColor: 'var(--isl-border)' }} onClick={onCreateProject}>{copy.create}</button>
    </div>
  );
}
