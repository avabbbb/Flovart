import { CircleAlert, CircleCheck, Languages, Moon, Settings, Sun, Monitor, Building2, BookOpen, User, Download, RefreshCw, Loader2, Home, Plus, Trash2, ChevronLeft, ChevronRight, Pencil, Check, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useUpdaterStore } from '../../stores/useUpdaterStore';
import { AuthModal } from '../auth/AuthModal';
import type { ThemeMode } from '../../types';

export interface StudioMenuStatus {
  tone: 'ready' | 'warning';
  label: string;
  detail: string;
}

export interface StudioMenuProjectRef {
  id: string;
  title: string;
}

export type StudioMode = 'workflow' | 'table' | 'agent';

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
  const settingsLabel = isChinese ? '设置' : 'Settings';
  const { user, isLoggedIn } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const isTauri = Boolean((window as any)?.__TAURI__ || (window as any)?.__TAURI_INTERNALS__);

  // LOGO 下拉（回主页/新建工作流/删除工作流）
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const logoMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!logoMenuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (logoMenuRef.current && !logoMenuRef.current.contains(event.target as Node)) setLogoMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [logoMenuOpen]);

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
  const hasMultipleProjects = (projectList?.length || 0) > 1;
  const projectIndex = activeProjectIndex ?? 0;
  const switchProject = (direction: 1 | -1) => {
    if (!hasMultipleProjects) return;
    const next = (projectIndex + direction + projectList!.length) % projectList!.length;
    projectActions!.setActiveByIndex(next);
  };
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

  return (
    <>
    <header
      className="theme-aware relative z-50 grid min-h-12 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 px-2 py-1.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-4"
      style={{ background: 'var(--app-bg)' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div ref={logoMenuRef} className="relative shrink-0">
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg p-0.5 transition hover:bg-black/5"
            aria-label="Flovart 菜单"
            title={canManageProjects ? (isChinese ? '点击打开工作流菜单' : 'Open workflow menu') : 'Flovart'}
            onClick={() => { if (canManageProjects) setLogoMenuOpen(open => !open); }}
          >
            <img src="/favicon.png" alt="" className="h-7 w-7 rounded-lg" />
            <span className="hidden text-sm font-black tracking-[-0.03em] sm:inline" style={{ color: 'var(--isl-ink)' }}>Flovart</span>
          </button>
          {logoMenuOpen && canManageProjects && (
            <div
              role="menu"
              aria-label={isChinese ? '工作流菜单' : 'Workflow menu'}
              className="isl-pop absolute left-0 top-full z-[90] mt-1.5 min-w-[200px] p-1.5"
              onPointerDown={event => event.stopPropagation()}
            >
<a
                href="/"
                className="isl-opt flex items-center gap-2"
                role="menuitem"
                onClick={event => { event.preventDefault(); setLogoMenuOpen(false); navigate('/app/home'); }}
              >
                <Home size={14} />
                <span className="text-xs font-bold">{isChinese ? '回到首页' : 'Back to home'}</span>
              </a>
              <button type="button" role="menuitem" className="isl-opt flex items-center gap-2" onClick={() => { projectActions!.create(); setLogoMenuOpen(false); }}>
                <Plus size={14} />
                <span className="text-xs font-bold">{isChinese ? '新建工作流' : 'New workflow'}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="isl-opt flex items-center gap-2"
                disabled={(projectList?.length || 0) === 0}
                style={{ color: 'var(--isl-coral-deep)' }}
                onClick={() => { projectActions!.remove(); setLogoMenuOpen(false); }}
              >
                <Trash2 size={14} />
                <span className="text-xs font-bold">{isChinese ? '删除当前工作流' : 'Delete workflow'}</span>
              </button>
            </div>
          )}
        </div>
        <span className="hidden h-4 w-px sm:block" style={{ background: 'var(--isl-border)' }} />
        {canManageProjects ? (
          <div className="flex min-w-0 items-center gap-1.5">
            {isEditingTitle ? (
              <div className="flex min-w-0 items-center gap-0.5">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={event => setTitleDraft(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') commitTitle(); if (event.key === 'Escape') cancelTitle(); }}
                  onBlur={commitTitle}
                  className="min-w-0 max-w-[180px] rounded-md border-[1.5px] px-1.5 py-0.5 text-xs font-semibold outline-none"
                  style={{ borderColor: 'var(--isl-mint)', background: 'var(--isl-surface-2)', color: 'var(--isl-ink)' }}
                  aria-label={isChinese ? '工作流名称' : 'Workflow name'}
                />
                <button type="button" className="isl-icon-btn h-6 w-6" onClick={commitTitle} aria-label={isChinese ? '确认' : 'Confirm'}><Check size={13} /></button>
                <button type="button" className="isl-icon-btn h-6 w-6" onClick={cancelTitle} aria-label={isChinese ? '取消' : 'Cancel'}><X size={13} /></button>
              </div>
            ) : (
              <button
                type="button"
                className="group hidden min-w-0 items-center gap-1 rounded-md px-1 py-0.5 transition hover:bg-black/5 min-[540px]:flex"
                onClick={() => setIsEditingTitle(true)}
                title={isChinese ? '点击修改工作流名称' : 'Click to rename workflow'}
              >
                <strong className="min-w-0 truncate text-xs font-semibold" style={{ color: 'var(--isl-ink-soft)' }}>
                  {title || 'Workflow'}
                </strong>
                <Pencil size={10} className="shrink-0 opacity-0 transition group-hover:opacity-60" />
              </button>
            )}
            {hasMultipleProjects && (
              <div className="flex shrink-0 items-center gap-0.5">
                <button type="button" className="isl-icon-btn h-6 w-6" onClick={() => switchProject(-1)} aria-label={isChinese ? '上一个工作流' : 'Previous workflow'} disabled={projectList!.length < 2}><ChevronLeft size={13} /></button>
                <span className="tabular-nums text-[11px] font-bold" style={{ color: 'var(--isl-ink-soft)' }} title={isChinese ? `${projectIndex + 1} / ${projectList!.length} 个工作流` : `${projectIndex + 1} / ${projectList!.length} workflows`}>{projectIndex + 1}/{projectList!.length}</span>
                <button type="button" className="isl-icon-btn h-6 w-6" onClick={() => switchProject(1)} aria-label={isChinese ? '下一个工作流' : 'Next workflow'} disabled={projectList!.length < 2}><ChevronRight size={13} /></button>
              </div>
            )}
          </div>
        ) : (
          <strong className="hidden min-w-0 truncate text-xs font-semibold min-[540px]:block" style={{ color: 'var(--isl-ink-soft)' }}>
            {title || 'Workflow'}
          </strong>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-center gap-0.5">
        {(['workflow', 'table', 'agent'] as const).map(tabMode => {
          const isActive = mode === tabMode;
          const label = tabMode === 'workflow'
            ? (isChinese ? '工作流' : 'Workflow')
            : tabMode === 'table' ? 'Table' : 'Agent';
          return (
            <button
              key={tabMode}
              type="button"
              onClick={() => actions.changeMode(tabMode)}
              className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-bold transition ${isActive ? 'bg-black/5' : 'opacity-50 hover:opacity-80'}`}
              style={{ color: 'var(--isl-ink)' }}
              aria-pressed={isActive}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 items-center justify-end gap-0.5 sm:gap-1">
        <Link
          to="/prompts"
          className="isl-icon-btn max-sm:!hidden h-8 items-center gap-1.5 px-2 sm:!flex"
          title={isChinese ? '提示词社区' : 'Prompt community'}
          aria-label={isChinese ? '提示词社区' : 'Prompt community'}
        >
          <BookOpen size={15} />
        </Link>
        <Link
          to="/enterprise"
          className="isl-icon-btn max-sm:!hidden h-8 items-center gap-1.5 px-2 sm:!flex"
          title={isChinese ? '企业后台' : 'Enterprise console'}
          aria-label={isChinese ? '企业后台' : 'Enterprise console'}
        >
          <Building2 size={15} />
        </Link>
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
        <button
          type="button"
          className="isl-icon-btn flex h-8 min-w-8 shrink-0 items-center gap-1.5 px-2"
          onClick={actions.openSettings}
          title={status.detail}
          aria-label={`${status.label}: ${status.detail}`}
          style={{ color: status.tone === 'ready' ? 'var(--isl-mint-deep)' : 'var(--isl-coral-deep)' }}
        >
          {status.tone === 'ready' ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <span className="hidden whitespace-nowrap text-[11px] font-semibold lg:inline">{status.label}</span>
        </button>
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
