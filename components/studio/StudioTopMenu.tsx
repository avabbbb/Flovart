import { CircleAlert, CircleCheck, Languages, Moon, Settings, Sun, Building2, BookOpen, User } from 'lucide-react';
import React, { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { AuthModal } from '../auth/AuthModal';

export interface StudioMenuStatus {
  tone: 'ready' | 'warning';
  label: string;
  detail: string;
}

export interface StudioMenuModel {
  mode: 'canvas' | 'workflow';
  title: string;
  theme: 'light' | 'dark';
  language: 'en' | 'zho';
  status: StudioMenuStatus;
  actions: {
    changeMode: (mode: 'canvas' | 'workflow') => void;
    toggleTheme: () => void;
    toggleLanguage: () => void;
    openSettings: () => void;
  };
}

export interface StudioTopMenuProps {
  model: StudioMenuModel;
}

export const StudioTopMenu: React.FC<StudioTopMenuProps> = ({ model }) => {
  const { actions, language, mode, status, theme, title } = model;
  const isChinese = language === 'zho';
  const settingsLabel = isChinese ? '设置' : 'Settings';
  const { user, isLoggedIn } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <>
    <header
      className="theme-aware relative z-50 grid min-h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 px-2 py-1.5 sm:px-4"
      style={{ background: 'var(--app-bg)' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex shrink-0 items-center gap-2" aria-label="Flovart">
          <img src="/favicon.png" alt="" className="h-7 w-7 rounded-lg" />
          <span className="hidden text-sm font-black tracking-[-0.03em] sm:inline" style={{ color: 'var(--isl-ink)' }}>Flovart</span>
        </div>
        <span className="hidden h-4 w-px sm:block" style={{ background: 'var(--isl-border)' }} />
        <strong className="hidden min-w-0 truncate text-xs font-semibold min-[540px]:block" style={{ color: 'var(--isl-ink-soft)' }}>
          {title || (mode === 'canvas' ? 'Canvas' : 'Workflow')}
        </strong>
      </div>

      <nav className="flex shrink-0 items-center gap-0.5" aria-label={isChinese ? '工作区切换' : 'Workspace switcher'}>
        {(['canvas', 'workflow'] as const).map(item => (
          <button
            key={item}
            type="button"
            onClick={() => actions.changeMode(item)}
            className={`isl-tab px-2 py-1.5 text-[11px] font-semibold transition-colors sm:px-3 sm:text-xs ${mode === item ? 'isl-tab--active' : ''}`}
            style={{ color: mode === item ? 'var(--isl-ink)' : 'var(--isl-ink-soft)' }}
            aria-current={mode === item ? 'page' : undefined}
          >
            {item === 'canvas' ? 'Canvas' : 'Workflow'}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 items-center justify-end gap-0.5 sm:gap-1">
        <Link
          to="/prompts"
          className="isl-icon-btn flex h-8 items-center gap-1.5 px-2"
          title={isChinese ? '提示词社区' : 'Prompt community'}
          aria-label={isChinese ? '提示词社区' : 'Prompt community'}
        >
          <BookOpen size={15} />
        </Link>
        <Link
          to="/enterprise"
          className="isl-icon-btn flex h-8 items-center gap-1.5 px-2"
          title={isChinese ? '企业后台' : 'Enterprise console'}
          aria-label={isChinese ? '企业后台' : 'Enterprise console'}
        >
          <Building2 size={15} />
        </Link>
        <button
          type="button"
          className="isl-icon-btn flex h-8 items-center gap-1.5 px-2"
          onClick={() => setAuthOpen(true)}
          title={isLoggedIn ? user?.username : (isChinese ? '登录' : 'Login')}
          aria-label={isChinese ? '登录' : 'Login'}
        >
          <User size={15} />
          {isLoggedIn && <span className="hidden text-[11px] font-semibold sm:inline" style={{ color: 'var(--isl-ink-soft)' }}>{user?.username}</span>}
        </button>
        <button
          type="button"
          className="isl-icon-btn flex h-8 min-w-8 items-center gap-1.5 px-2"
          onClick={actions.openSettings}
          title={status.detail}
          aria-label={`${status.label}: ${status.detail}`}
          style={{ color: status.tone === 'ready' ? 'var(--isl-mint-deep)' : 'var(--isl-coral-deep)' }}
        >
          {status.tone === 'ready' ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <span className="hidden whitespace-nowrap text-[11px] font-semibold lg:inline">{status.label}</span>
        </button>
        <button type="button" className="isl-icon-btn h-8 w-8" onClick={actions.toggleLanguage} title={isChinese ? 'Switch to English' : '切换到中文'}>
          <Languages size={15} />
          <span className="sr-only">{isChinese ? 'Switch to English' : '切换到中文'}</span>
        </button>
        <button type="button" className="isl-icon-btn h-8 w-8" onClick={actions.toggleTheme} title={theme === 'dark' ? (isChinese ? '切换到浅色' : 'Light mode') : (isChinese ? '切换到深色' : 'Dark mode')}>
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button type="button" className="isl-icon-btn h-8 w-8" onClick={actions.openSettings} title={settingsLabel} aria-label={settingsLabel}>
          <Settings size={15} />
        </button>
      </div>
    </header>
    <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
};
