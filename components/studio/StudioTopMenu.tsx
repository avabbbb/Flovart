import { Languages, Moon, Settings, Sun, Monitor, User, Download, RefreshCw, Loader2, Plus, Trash2, Pencil, Check, X, ChevronDown, Search } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useUpdaterStore } from '../../stores/useUpdaterStore';
import { useAgentConnectionStore } from '../../stores/useAgentConnectionStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { toLocalLinkPublicStatus } from '../../tools/flovart/public-status';
import { AuthModal } from '../auth/AuthModal';
import type { ThemeMode } from '../../types';
import '../../styles/studio.css';

export interface StudioMenuStatus {
  tone: 'ready' | 'warning';
  label: string;
  detail: string;
}

export interface StudioMenuProjectRef {
  id: string;
  title: string;
}

export type StudioMode = 'workflow' | 'agent';

export interface StudioMenuModel {
  mode: StudioMode;
  title: string;
  themeMode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  language: 'en' | 'zho';
  status: StudioMenuStatus;
  actions: {
    changeMode: (mode: StudioMode) => void;
    setThemeMode: (mode: ThemeMode) => void;
    toggleLanguage: () => void;
    openSettings: () => void;
  };
  // 工作流项目管理（目前仅 workflow 视图使用，其他视图保持 undefined 即可）
  projectList?: StudioMenuProjectRef[];
  activeProjectIndex?: number;
  projectActions?: {
    create: () => void;
    remove: () => void;
    rename: (newTitle: string) => void;
    setActiveByIndex: (index: number) => void;
  };
}

export interface StudioTopMenuProps {
  model: StudioMenuModel;
}

export const StudioTopMenu: React.FC<StudioTopMenuProps> = ({ model }) => {
  const { actions, language, mode, status, themeMode, resolvedTheme, title, projectList, activeProjectIndex, projectActions } = model;
  const navigate = useNavigate();
  const isChinese = language === 'zho';
  // The real view switch (Canvas vs Table) lives here in the single top bar —
  // not on a second row. Read it straight from the workspace store.
  const canvasView = useWorkspaceStore(s => s.canvasView);
  const setCanvasView = useWorkspaceStore(s => s.setCanvasView);
  const settingsLabel = isChinese ? '设置' : 'Settings';
  const { user, isLoggedIn } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const isTauri = Boolean((window as any)?.__TAURI__ || (window as any)?.__TAURI_INTERNALS__);
  // 工作流切换器：顶部唯一的工作流入口（切换 / 搜索 / 新建 / 重命名 / 删除）。
  // 原左侧图标栏与项目侧栏已移除，避免与顶部栏重复。
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const projectMenuRef = useRef<HTMLDivElement>(null);
  // UX-HEU-01: deleting the current workflow is the most destructive action in
  // the app — it must not fire on a single misclick. Gate it behind an inline
  // confirmation inside the same popover so the user sees the project title
  // they are about to lose.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const closeProjectMenu = () => {
    setProjectMenuOpen(false);
    setConfirmingDelete(false);
    setProjectQuery('');
  };
  useEffect(() => {
    if (!projectMenuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(event.target as Node)) closeProjectMenu();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeProjectMenu(); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [projectMenuOpen]);

  // 工作流名称 inline 编辑
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  useEffect(() => { if (!isEditingTitle) setTitleDraft(title); }, [title, isEditingTitle]);

  // 主题下拉（浅色/深色/跟随系统）
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!themeMenuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(event.target as Node)) setThemeMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [themeMenuOpen]);
  const themeIcon = themeMode === 'light' ? <Sun size={15} /> : themeMode === 'dark' ? <Moon size={15} /> : <Monitor size={15} />;
  const themeLabel = themeMode === 'light' ? (isChinese ? '浅色' : 'Light') : themeMode === 'dark' ? (isChinese ? '深色' : 'Dark') : (isChinese ? '跟随系统' : 'System');
  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== title) projectActions?.rename(trimmed);
    else setTitleDraft(title);
    setIsEditingTitle(false);
  };
  const cancelTitle = () => { setTitleDraft(title); setIsEditingTitle(false); };

  const canManageProjects = Boolean(projectList && projectActions);
  const projectIndex = activeProjectIndex ?? 0;
  const normalizedQuery = projectQuery.trim().toLowerCase();
  const filteredProjects = (projectList || [])
    .map((project, index) => ({ project, index }))
    .filter(({ project }) => !normalizedQuery || (project.title || '').toLowerCase().includes(normalizedQuery));
  const upStatus = useUpdaterStore(s => s.status);
  const upVersion = useUpdaterStore(s => s.availableVersion);
  const upProgress = useUpdaterStore(s => s.downloadProgress);
  const checkForUpdates = useUpdaterStore(s => s.checkForUpdates);
  const applyUpdate = useUpdaterStore(s => s.applyUpdate);
  const upBusy = upStatus === 'checking' || upStatus === 'downloading';
  const upClick = () => (upStatus === 'available' ? applyUpdate() : checkForUpdates());
  const upTitle = upStatus === 'available'
    ? (isChinese ? `更新到 v${upVersion}` : `Update to v${upVersion}`)
    : upStatus === 'downloading'
      ? (isChinese ? `下载中 ${Math.round(upProgress * 100)}%` : `Downloading ${Math.round(upProgress * 100)}%`)
      : upStatus === 'checking'
        ? (isChinese ? '检查更新中...' : 'Checking...')
        : upStatus === 'up-to-date'
          ? (isChinese ? '已是最新版本' : 'Up to date')
          : (isChinese ? '检查更新' : 'Check for updates');
  const agentConnectionStatus = useAgentConnectionStore(state => state.status);
  const agentPublicStatus = toLocalLinkPublicStatus({
    ready: agentConnectionStatus === 'ready',
    agent: { status: agentConnectionStatus === 'auth_failed' ? 'auth_failed' : agentConnectionStatus },
    browserConnected: agentConnectionStatus === 'ready',
  });
  const agentReady = agentPublicStatus.state === 'ready';
  const agentLabel = isChinese
    ? agentPublicStatus.label
    : ({ ready: 'Ready', needs_setup: 'Needs setup', needs_login: 'Needs login', offline: 'Offline' }[agentPublicStatus.state]);
  const agentColor = agentReady ? 'var(--isl-mint-deep)' : agentPublicStatus.state === 'needs_login' || agentPublicStatus.state === 'offline' ? 'var(--isl-coral-deep)' : 'var(--isl-ink-soft)';

  return (
    <>
    <header
      className="studio-top-menu theme-aware relative z-50 grid min-h-12 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 px-2 py-1.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-4"
      style={{ background: 'var(--app-bg)' }}
    >
      <div className='studio-top-menu__leading flex min-w-0 items-center gap-2'>
        <button
          type='button'
          className='flex shrink-0 items-center gap-2 rounded-lg p-0.5 transition hover:bg-black/5'
          aria-label={isChinese ? '回到画布' : 'Back to canvas'}
          title={isChinese ? '回到画布' : 'Back to canvas'}
          onClick={() => {
            const workspace = useWorkspaceStore.getState();
            workspace.setActiveView('workflow');
            workspace.setCanvasView('spatial');
            navigate('/app');
          }}
        >
          <img src='/favicon.png' alt='' className='h-7 w-7 rounded-lg' />
          <span className='hidden text-sm font-black tracking-[-0.03em] sm:inline' style={{ color: 'var(--isl-ink)' }}>Flovart</span>
        </button>
        <span className='hidden h-4 w-px sm:block' style={{ background: 'var(--isl-border)' }} />
        {canManageProjects ? (
          <div ref={projectMenuRef} className='relative flex min-w-0 items-center'>
            {isEditingTitle ? (
              <div className='flex min-w-0 items-center gap-0.5'>
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={event => setTitleDraft(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') commitTitle(); if (event.key === 'Escape') cancelTitle(); }}
                  onBlur={commitTitle}
                  className='min-w-0 max-w-[180px] rounded-md border-[1.5px] px-1.5 py-0.5 text-xs font-semibold outline-none'
                  style={{ borderColor: 'var(--isl-mint)', background: 'var(--isl-surface-2)', color: 'var(--isl-ink)' }}
                  aria-label={isChinese ? '工作流名称' : 'Workflow name'}
                />
                <button type='button' className='isl-icon-btn h-6 w-6' onClick={commitTitle} aria-label={isChinese ? '确认' : 'Confirm'}><Check size={13} /></button>
                <button type='button' className='isl-icon-btn h-6 w-6' onClick={cancelTitle} aria-label={isChinese ? '取消' : 'Cancel'}><X size={13} /></button>
              </div>
            ) : (
              <button
                type='button'
                className='flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:bg-black/5'
                aria-haspopup='menu'
                aria-expanded={projectMenuOpen}
                aria-label={isChinese ? '切换工作流' : 'Switch workflow'}
                title={isChinese ? '切换或管理工作流，双击重命名' : 'Switch or manage workflows. Double-click to rename'}
                onClick={() => { if (projectMenuOpen) closeProjectMenu(); else setProjectMenuOpen(true); }}
                onDoubleClick={() => { closeProjectMenu(); setIsEditingTitle(true); }}
              >
                <strong className='min-w-0 max-w-[220px] truncate text-xs font-semibold' style={{ color: 'var(--isl-ink-soft)' }}>
                  {title || 'Workflow'}
                </strong>
                {(projectList?.length || 0) > 1 && (
                  <span className='tabular-nums text-[10px] font-bold' style={{ color: 'var(--isl-ink-ghost)' }}>{(projectIndex + 1) + '/' + projectList!.length}</span>
                )}
                <ChevronDown size={12} className='shrink-0 opacity-60' />
              </button>
            )}
            {projectMenuOpen && (
              <div
                role='menu'
                aria-label={isChinese ? '工作流菜单' : 'Workflow menu'}
                className='isl-pop absolute left-0 top-full z-[90] mt-1.5 w-[260px] p-1.5'
                onPointerDown={event => event.stopPropagation()}
              >
                <button type='button' role='menuitem' className='isl-opt flex w-full items-center gap-2' onClick={() => { projectActions!.create(); closeProjectMenu(); }}>
                  <Plus size={14} />
                  <span className='text-xs font-bold'>{isChinese ? '新建工作流' : 'New workflow'}</span>
                </button>
                <label className='mx-1 my-1 flex items-center gap-1.5 rounded-md border px-2 py-1' style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-2)' }}>
                  <Search size={12} className='shrink-0 opacity-60' />
                  <input
                    autoFocus
                    value={projectQuery}
                    onChange={event => setProjectQuery(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && filteredProjects[0]) {
                        projectActions!.setActiveByIndex(filteredProjects[0].index);
                        closeProjectMenu();
                      }
                    }}
                    placeholder={isChinese ? '搜索工作流' : 'Search workflows'}
                    aria-label={isChinese ? '搜索工作流' : 'Search workflows'}
                    className='min-w-0 flex-1 bg-transparent text-xs outline-none'
                    style={{ color: 'var(--isl-ink)' }}
                  />
                </label>
                <div className='max-h-[280px] overflow-y-auto' role='group' aria-label={isChinese ? '全部工作流' : 'All workflows'}>
                  {filteredProjects.map(({ project, index }) => {
                    const isActive = index === projectIndex;
                    return (
                      <button
                        key={project.id}
                        type='button'
                        role='menuitemradio'
                        aria-checked={isActive}
                        className={'isl-opt flex w-full items-center gap-2' + (isActive ? ' isl-opt--active' : '')}
                        title={project.title}
                        onClick={() => { if (!isActive) projectActions!.setActiveByIndex(index); closeProjectMenu(); }}
                      >
                        <span aria-hidden='true' className='h-1.5 w-1.5 shrink-0 rounded-full' style={{ background: isActive ? 'var(--isl-mint)' : 'var(--isl-ink-ghost)' }} />
                        <span className='min-w-0 flex-1 truncate text-left text-xs font-bold'>{project.title || (isChinese ? '未命名工作流' : 'Untitled workflow')}</span>
                        {isActive && <Check size={11} className='shrink-0 opacity-70' />}
                      </button>
                    );
                  })}
                  {filteredProjects.length === 0 && (
                    <p className='m-0 px-2 py-1.5 text-[11px]' style={{ color: 'var(--isl-ink-ghost)' }}>
                      {(projectList?.length || 0) === 0 ? (isChinese ? '还没有工作流' : 'No workflows yet') : (isChinese ? '没有匹配的工作流' : 'No matching workflows')}
                    </p>
                  )}
                </div>
                <div className='mx-1 my-1 h-px' style={{ background: 'var(--isl-border)' }} />
                <button type='button' role='menuitem' className='isl-opt flex w-full items-center gap-2' disabled={(projectList?.length || 0) === 0} onClick={() => { closeProjectMenu(); setIsEditingTitle(true); }}>
                  <Pencil size={14} />
                  <span className='text-xs font-bold'>{isChinese ? '重命名当前工作流' : 'Rename workflow'}</span>
                </button>
                <button
                  type='button'
                  role='menuitem'
                  className='isl-opt flex w-full items-center gap-2'
                  disabled={(projectList?.length || 0) === 0}
                  style={{ color: 'var(--isl-coral-deep)' }}
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 size={14} />
                  <span className='text-xs font-bold'>{isChinese ? '删除当前工作流' : 'Delete workflow'}</span>
                </button>
                {confirmingDelete && (
                  <div
                    role='alertdialog'
                    aria-label={isChinese ? '删除工作流确认' : 'Confirm workflow delete'}
                    className='mx-1 mb-1 rounded-md border p-2'
                    style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-2)' }}
                  >
                    <p className='m-0 text-[11px] leading-4' style={{ color: 'var(--isl-ink-soft)' }}>
                      {isChinese ? '确定删除“' + (title || '当前工作流') + '”？此操作不可撤销。' : 'Delete “' + (title || 'current workflow') + '”? This cannot be undone.'}
                    </p>
                    <div className='mt-1.5 flex justify-end gap-1.5'>
                      <button type='button' className='isl-opt text-[11px] font-semibold' onClick={() => setConfirmingDelete(false)}>{isChinese ? '取消' : 'Cancel'}</button>
                      <button
                        type='button'
                        className='isl-opt rounded px-2 py-0.5 text-[11px] font-semibold'
                        style={{ background: 'var(--isl-coral-deep)', color: '#fff' }}
                        onClick={() => { projectActions!.remove(); closeProjectMenu(); }}
                      >{isChinese ? '删除' : 'Delete'}</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <strong className='min-w-0 truncate text-xs font-semibold' style={{ color: 'var(--isl-ink-soft)' }}>
            {title || 'Workflow'}
          </strong>
        )}
      </div>

      <nav className="studio-top-menu__modes flex min-w-0 items-center justify-center gap-0.5" aria-label={isChinese ? '画布视图' : 'Canvas view'} role="tablist">
        {/* Three product surfaces: Canvas and Table work on the Workflow; Agent
            is the dedicated local-agent connection/control page. The built-in
            assistant remains a separate in-context drawer beside Canvas/Table. */}
        {(['spatial', 'table', 'agent'] as const).map(view => {
          const isActive = canvasView === view;
          const label = view === 'spatial' ? (isChinese ? '画布' : 'Canvas') : view === 'table' ? 'Table' : 'Agent';
          return (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setCanvasView(view)}
              className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-bold transition ${isActive ? 'bg-black/5' : 'opacity-50 hover:opacity-80'}`}
              style={{ color: 'var(--isl-ink)' }}
            >
              {label}
            </button>
          );
        })}
      </nav>

      <div className="studio-top-menu__actions flex min-w-0 items-center justify-end gap-0.5 sm:gap-1">
        {import.meta.env.DEV && (
          <span
            title="开发构建标识：刷新后时间变化即代表加载了最新代码"
            className="hidden items-center rounded px-1.5 py-0.5 text-[9px] font-semibold lg:inline-flex"
            style={{ color: 'var(--isl-ink-ghost)', background: 'var(--isl-surface-2)' }}
          >
            dev {new Date().toLocaleTimeString('zh-CN', { hour12: false })}
          </span>
        )}
        <button
          type="button"
          className="isl-icon-btn max-sm:!hidden h-8 items-center gap-1.5 px-2 sm:!flex"
          onClick={() => setAuthOpen(true)}
          title={isLoggedIn ? user?.username : (isChinese ? '登录' : 'Login')}
          aria-label={isChinese ? '登录' : 'Login'}
        >
          <User size={15} />
          {isLoggedIn && <span className="hidden text-[11px] font-semibold sm:inline" style={{ color: 'var(--isl-ink-soft)' }}>{user?.username}</span>}
        </button>
        {isTauri && (
          <button
            type="button"
            className="isl-icon-btn flex h-8 items-center gap-1.5 px-2"
            onClick={upClick}
            disabled={upBusy}
            title={upTitle}
            aria-label={upTitle}
            style={upStatus === 'available' ? { color: 'var(--isl-mint-deep)' } : upStatus === 'error' ? { color: 'var(--isl-coral-deep)' } : undefined}
          >
            {upStatus === 'available'
              ? <Download size={15} />
              : upStatus === 'downloading'
                ? <Loader2 size={15} className="animate-spin" />
                : upStatus === 'checking'
                  ? <Loader2 size={15} className="animate-spin" />
                  : <RefreshCw size={15} />}
            {upStatus === 'available' && (
              <span className="hidden text-[11px] font-semibold lg:inline">{isChinese ? '更新' : 'Update'}</span>
            )}
          </button>
        )}
        {/* One honest status line (Gyroflow-style): the AI service decides
            whether you can generate; the optional local Agent rides in the
            tooltip and as a second word only when connected. Not configured
            is a setup step, not an error, so it is never red; it opens
            Settings because that is the one thing to do about it. */}
        {(() => {
          const ready = status.tone === 'ready';
          const label = ready && agentReady ? `${status.label} · Agent` : status.label;
          const color = ready ? 'var(--isl-mint-deep)' : 'var(--isl-ink-soft)';
          const title = `${status.detail}${isChinese ? `\nAgent：${agentLabel}（在 Agent 页面管理）` : `\nAgent: ${agentLabel} (manage in the Agent page)`}`;
          const content = <>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: ready ? 'var(--isl-mint)' : 'var(--isl-ink-ghost)' }} />
            <span className="whitespace-nowrap text-[11px] font-semibold">{label}</span>
          </>;
          return ready ? (
            <span data-testid="runtime-status-chip" role="status" aria-label={`${label}: ${status.detail}`} title={title} className="flex h-8 shrink-0 cursor-default items-center gap-1.5 px-2" style={{ color }}>{content}</span>
          ) : (
            <button type="button" data-testid="runtime-status-chip" aria-label={`${label}: ${status.detail}`} title={title} onClick={actions.openSettings} className="isl-icon-btn flex h-8 w-auto shrink-0 items-center gap-1.5 px-2" style={{ color }}>{content}</button>
          );
        })()}
        <button type="button" className="isl-icon-btn h-8 w-8 shrink-0" onClick={actions.toggleLanguage} title={isChinese ? 'Switch to English' : '切换到中文'}>
          <Languages size={15} />
          <span className="sr-only">{isChinese ? 'Switch to English' : '切换到中文'}</span>
        </button>
        <div ref={themeMenuRef} className="relative hidden shrink-0 min-[430px]:block">
          <button type="button" className="isl-icon-btn h-8 w-8" onClick={() => setThemeMenuOpen(open => !open)} title={isChinese ? '主题模式' : 'Theme mode'} aria-label={isChinese ? '主题模式' : 'Theme mode'}>
            {themeIcon}
          </button>
          {themeMenuOpen && (
            <div
              role="menu"
              aria-label={isChinese ? '主题选择' : 'Theme selection'}
              className="isl-pop absolute right-0 top-full z-[90] mt-1.5 min-w-[140px] p-1.5"
              onPointerDown={event => event.stopPropagation()}
            >
              {([
                { mode: 'light' as ThemeMode, icon: <Sun size={13} />, label: isChinese ? '浅色模式' : 'Light' },
                { mode: 'dark' as ThemeMode, icon: <Moon size={13} />, label: isChinese ? '深色模式' : 'Dark' },
                { mode: 'system' as ThemeMode, icon: <Monitor size={13} />, label: isChinese ? '跟随系统' : 'System' },
              ]).map(item => (
                <button
                  key={item.mode}
                  type="button"
                  role="menuitem"
                  className={`isl-opt flex items-center gap-2 ${themeMode === item.mode ? 'isl-opt--active' : ''}`}
                  onClick={() => { actions.setThemeMode(item.mode); setThemeMenuOpen(false); }}
                >
                  {item.icon}
                  <span className="text-xs font-bold">{item.label}</span>
                  {themeMode === item.mode && <Check size={11} className="ml-auto opacity-70" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="isl-icon-btn h-8 w-8 shrink-0" onClick={actions.openSettings} title={settingsLabel} aria-label={settingsLabel}>
          <Settings size={15} />
        </button>
      </div>
    </header>
    <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
};
