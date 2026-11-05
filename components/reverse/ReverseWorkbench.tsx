import React, { useMemo, useState } from 'react';
import '../../styles/settings.css';
import { useReverseStore } from '../../stores/useReverseStore';
import { ReverseVideoPanel } from './ReverseVideoPanel';
import type { ReverseProject } from '../../services/reverse/types';

export interface ReverseWorkbenchProps {
  language: 'en' | 'zho';
  workflowProjectId: string | null;
  /** 切回 Canvas 并定位到指定节点（子画布框）。 */
  onOpenInCanvas?: (nodeId: string) => void;
}

const TEXT = {
  zho: {
    title: '逆向工作台',
    hint: '拆解参考视频的镜头、脚本与节奏，替换槽位并按变体矩阵批量生成。',
    projects: '项目',
    create: '新建',
    empty: '还没有项目',
    remove: '删除',
    untitled: '未命名视频',
    pick: '新建或选择一个项目开始',
    gateNote: '生成一律走 Workflow 节点或 production 预演 → 批准 → 运行；预算与路线闸门只由人批准。',
  },
  en: {
    title: 'Reverse Workbench',
    hint: 'Break a reference video into shots, script and pacing, swap slots and batch-generate a variant matrix.',
    projects: 'Projects',
    create: 'New',
    empty: 'No projects yet',
    remove: 'Delete',
    untitled: 'Untitled video',
    pick: 'Create or pick a project to start',
    gateNote: 'Generation always goes through Workflow nodes or production dry-run, approve, run; budget and route gates are human-approved only.',
  },
} as const;

export function ReverseWorkbench({ language, workflowProjectId, onOpenInCanvas }: ReverseWorkbenchProps) {
  const t = TEXT[language];
  const projects = useReverseStore((s) => s.projects);
  const activeId = useReverseStore((s) => s.activeIds.video);
  const setActive = useReverseStore((s) => s.setActive);
  const createProject = useReverseStore((s) => s.createProject);
  const removeProject = useReverseStore((s) => s.removeProject);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const list = useMemo(() => projects.filter((p) => p.direction === 'video'), [projects]);
  const active: ReverseProject | undefined = list.find((p) => p.id === activeId) ?? list[0];

  const handleCreate = () => {
    createProject('video', t.untitled + ' ' + (list.length + 1));
  };

  return (
    <div className="reverse-workbench flex h-full min-h-0 w-full flex-col" style={{ color: 'var(--isl-ink)' }} data-testid="reverse-workbench">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-5 pb-3 pt-4">
        <h1 className="text-base font-bold">{t.title}</h1>
        <p className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--isl-ink-soft)' }}>{t.hint}</p>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 px-5 pb-5">
        <aside className="settings-elevated settings-elevated--soft flex w-56 shrink-0 flex-col rounded-xl p-3" style={{ background: 'var(--isl-surface-2)' }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--isl-ink-ghost)' }}>{t.projects}</span>
            <button type="button" className="isl-opt rounded px-2 py-0.5 text-[11px] font-semibold" onClick={handleCreate} data-testid="reverse-create">{t.create}</button>
          </div>
          {list.length === 0 ? (
            <p className="py-6 text-center text-xs" style={{ color: 'var(--isl-ink-ghost)' }}>{t.empty}</p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
              {list.map((p) => {
                const selected = active?.id === p.id;
                return (
                  <li key={p.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      className={'min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs ' + (selected ? 'bg-black/5 font-semibold' : 'opacity-70 hover:opacity-100')}
                      onClick={() => { setActive('video', p.id); setConfirmId(null); }}
                    >
                      {p.title}
                    </button>
                    {confirmId === p.id ? (
                      <button type="button" className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--isl-coral-deep)', color: '#fff' }} onClick={() => { removeProject(p.id); setConfirmId(null); }}>{t.remove}</button>
                    ) : (
                      <button type="button" aria-label={t.remove} className="rounded px-1 text-[11px] opacity-0 transition group-hover:opacity-60" onClick={() => setConfirmId(p.id)}>×</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-[10px] leading-relaxed" style={{ color: 'var(--isl-ink-ghost)' }}>{t.gateNote}</p>
        </aside>

        <main className="settings-elevated flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl" style={{ background: 'var(--isl-surface-1, var(--isl-surface-2))' }}>
          {active ? (
            <div className='flex min-h-0 flex-1 flex-col overflow-y-auto p-5' data-testid={'reverse-panel-' + active.direction}>
              <h2 className='mb-4 text-sm font-bold'>{active.title}</h2>
              <ReverseVideoPanel
                key={active.id}
                project={active}
                language={language}
                workflowProjectId={workflowProjectId}
                onOpenInCanvas={onOpenInCanvas}
                onUpdate={(fn) => useReverseStore.getState().updateProject(active.id, fn)}
              />
            </div>
          ) : (
            <div className="grid flex-1 place-content-center text-sm" style={{ color: 'var(--isl-ink-ghost)' }}>{t.pick}</div>
          )}
        </main>
      </div>
    </div>
  );
}
