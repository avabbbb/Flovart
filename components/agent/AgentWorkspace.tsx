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
export function AgentConnectionsPage({ project, language = 'zho' }: { project: WorkflowProject | null; language?: 'en' | 'zho' }) {
  void project;
  const copy = language === 'zho'
    ? { tag: 'Agent', title: '正在优化，后续上线', body: '连接本地 Agent、协作 Agent、实时操作与项目共享回执正在重做。你的连接与数据都会保留，上线后自动恢复。现在可以在画布右侧的助手面板继续工作。' }
    : { tag: 'Agent', title: 'Being reworked, coming soon', body: 'Local-agent connection, collaborators, live activity and shared receipts are being rebuilt. Your connections and data are kept and return automatically once it ships. Use the assistant panel beside the canvas in the meantime.' };
  return (
    <div className="h-full min-h-0 overflow-y-auto" data-testid="agent-connections-page" style={{ color: 'var(--isl-ink)' }}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <section className="agent-connections-page__surface" data-testid="agent-connections-surface" aria-labelledby="agent-connections-title">
          <header className="agent-connections-page__header">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--isl-ink-ghost)' }}>{copy.tag}</span>
            <h1 id="agent-connections-title">{copy.title}</h1>
            <p>{copy.body}</p>
          </header>
          <div className="m-3 flex flex-col items-center gap-2 rounded-xl border p-6 text-center" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface)' }}>
            <Sparkles size={22} style={{ color: 'var(--isl-mint)' }} />
            <strong className="text-sm">{copy.title}</strong>
          </div>
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
