import React, { useMemo, useState } from 'react';
import '../../styles/settings.css';
import { useReverseStore } from '../../stores/useReverseStore';
import { ReverseVideoPanel } from './ReverseVideoPanel';
import { ReverseGamePanel } from './ReverseGamePanel';
import type { ReverseDirection, ReverseProject } from '../../services/reverse/types';

export interface ReverseWorkbenchProps {
  language: 'en' | 'zho';
  workflowProjectId: string | null;
  /** 切回 Canvas 并定位到指定节点（子画布框）。 */
  onOpenInCanvas?: (nodeId: string) => void;
}

const TEXT = {
  zho: {
    title: '逆向工作台',
    video: '视频逆向',
    game: '游戏素材逆向',
    videoHint: '拆解参考视频的镜头、脚本与节奏，替换槽位并按变体矩阵批量生成。',
    gameHint: '从 manifest 导入原作素材清单，按风格圣经重绘，相似度闸门通过后回填。',
    projects: '项目',
    create: '新建',
    empty: '还没有项目',
    remove: '删除',
    untitledVideo: '未命名视频',
    untitledGame: '未命名游戏',
    pick: '新建或选择一个项目开始',
    gateNote: '生成一律走 Workflow 节点或 production 预演 → 批准 → 运行；预算与路线闸门只由人批准。',
  },
  en: {
    title: 'Reverse Workbench',
    video: 'Video reverse',
    game: 'Game asset reverse',
    videoHint: 'Break a reference video into shots, script and pacing, swap slots and batch-generate a variant matrix.',
    gameHint: 'Import the original asset ledger from a manifest, redraw against a style bible, back-fill once similarity gates pass.',
    projects: 'Projects',
    create: 'New',
    empty: 'No projects yet',
    remove: 'Delete',
    untitledVideo: 'Untitled video',
    untitledGame: 'Untitled game',
    pick: 'Create or pick a project to start',
    gateNote: 'Generation always goes through Workflow nodes or production dry-run, approve, run; budget and route gates are human-approved only.',
  },
} as const;

const DIRECTIONS: ReverseDirection[] = ['video', 'game'];

function tabClass(active: boolean): string {
  return 'shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-bold transition ' + (active ? 'bg-black/5' : 'opacity-50 hover:opacity-80');
}

export function ReverseWorkbench({ language, workflowProjectId, onOpenInCanvas }: ReverseWorkbenchProps) {
  const t = TEXT[language];
  const tab = useReverseStore((s) => s.tab);
  const setTab = useReverseStore((s) => s.setTab);
  const projects = useReverseStore((s) => s.projects);
  const activeIds = useReverseStore((s) => s.activeIds);
  const setActive = useReverseStore((s) => s.setActive);
  const createProject = useReverseStore((s) => s.createProject);
  const removeProject = useReverseStore((s) => s.removeProject);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const list = useMemo(() => projects.filter((p) => p.direction === tab), [projects, tab]);
  const active: ReverseProject | undefined = list.find((p) => p.id === activeIds[tab]) ?? list[0];

  const handleCreate = () => {
    const base = tab === 'video' ? t.untitledVideo : t.untitledGame;
    createProject(tab, base + ' ' + (list.length + 1));
  };

  return (
    <div className="reverse-workbench flex h-full min-h-0 w-full flex-col" style={{ color: 'var(--isl-ink)' }} data-testid="reverse-workbench">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-5 pb-3 pt-4">
        <h1 className="text-base font-bold">{t.title}</h1>
        <nav className="flex items-center gap-0.5" role="tablist" aria-label={t.title}>
          {DIRECTIONS.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={tab === d} className={tabClass(tab === d)} onClick={() => setTab(d)}>
              {d === 'video' ? t.video : t.game}
            </button>
          ))}
        </nav>
        <p className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--isl-ink-soft)' }}>{tab === 'video' ? t.videoHint : t.gameHint}</p>
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
                      onClick={() => { setActive(tab, p.id); setConfirmId(null); }}
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
              {active.direction === 'video' ? (
                <ReverseVideoPanel
                  key={active.id}
                  project={active}
                  language={language}
                  workflowProjectId={workflowProjectId}
                  onOpenInCanvas={onOpenInCanvas}
                  onUpdate={(fn) => useReverseStore.getState().updateProject(active.id, (p) => (p.direction === 'video' ? fn(p) : p))}
                />
              ) : (
                <ReverseGamePanel
                  key={active.id}
                  project={active}
                  language={language}
                  workflowProjectId={workflowProjectId}
                  onUpdate={(fn) => useReverseStore.getState().updateProject(active.id, (p) => (p.direction === 'game' ? fn(p) : p))}
                />
              )}
            </div>
          ) : (
            <div className="grid flex-1 place-content-center text-sm" style={{ color: 'var(--isl-ink-ghost)' }}>{t.pick}</div>
          )}
        </main>
      </div>
    </div>
  );
}
