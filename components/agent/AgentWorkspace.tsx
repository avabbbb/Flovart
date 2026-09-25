import { Sparkles } from 'lucide-react';
import '../../styles/agent.css';
import type { WorkflowProject } from '../workflow/types';
import { AgentHostPicker } from './AgentHostPicker';

/**
 * Dedicated top-level Agent surface.
 *
 * This page is for discovering, preparing, and switching local/external coding
 * agents (Codex, WorkBuddy, etc.). It intentionally does not contain the
 * built-in Flovart assistant; that assistant stays beside Canvas/Table in the
 * right drawer so users can keep the work visible while chatting.
 */
export function AgentConnectionsPage({ project, language = 'zho' }: { project: WorkflowProject | null; language?: 'en' | 'zho' }) {
  const copy = language === 'zho'
    ? { connect: '连接本地 Agent', intro: '连接 Codex、WorkBuddy 等本地 Agent。这里负责连接和状态；内置助手仍在画布右侧使用。' }
    : { connect: 'Connect a local Agent', intro: 'Connect local agents such as Codex or WorkBuddy. Manage connections here; use the built-in assistant beside the canvas.' };
  return (
    <div className="h-full min-h-0 overflow-y-auto" data-testid="agent-connections-page" style={{ color: 'var(--isl-ink)' }}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <header className="max-w-2xl">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--isl-ink-ghost)' }}>Agent</span>
          <h1 className="mt-1 text-lg font-bold">{copy.connect}</h1>
          <p className="mt-1 text-xs leading-5" style={{ color: 'var(--isl-ink-soft)' }}>
            {copy.intro}
          </p>
        </header>
        <AgentHostPicker projectTitle={project?.title} language={language} />
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
