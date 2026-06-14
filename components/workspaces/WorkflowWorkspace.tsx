import React from 'react';

interface WorkflowWorkspaceProps {
  workflowPanel: React.ReactNode;
  language?: 'en' | 'zho';
  theme?: 'light' | 'dark';
  onSwitchToCanvas?: () => void;
  onToggleTheme?: () => void;
  onToggleLanguage?: () => void;
  onOpenLegal?: (type: 'terms' | 'privacy') => void;
}

export const WorkflowWorkspace: React.FC<WorkflowWorkspaceProps> = ({
  workflowPanel,
  language = 'en',
  theme = 'light',
  onSwitchToCanvas,
  onToggleTheme,
  onToggleLanguage,
  onOpenLegal,
}) => (
  <div className="h-full min-h-0 overflow-hidden flex flex-col">
    <div className="relative flex-1 min-h-0 overflow-hidden">
      {workflowPanel}
    </div>
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[48] pointer-events-none">
      <div className="pointer-events-auto">
        <div className="isl-tabbar isl-tabbar--ac-sm flex items-center gap-0.5">
          {onOpenLegal && (
            <>
              <button type="button" onClick={() => onOpenLegal('terms')} className="isl-tab">
                {language === 'zho' ? '使用条款' : 'Terms'}
              </button>
              <button type="button" onClick={() => onOpenLegal('privacy')} className="isl-tab">
                {language === 'zho' ? '隐私政策' : 'Privacy'}
              </button>
            </>
          )}
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              className="isl-tab inline-flex items-center gap-0.5"
              title={theme === 'dark' ? (language === 'zho' ? '切换到浅色模式' : 'Switch to light mode') : (language === 'zho' ? '切换到深色模式' : 'Switch to dark mode')}
            >
              {theme === 'dark' ? (
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
                  <circle cx="6" cy="6" r="2.2" fill="currentColor" stroke="none" />
                  <line x1="6" y1="0.5" x2="6" y2="2" />
                  <line x1="6" y1="10" x2="6" y2="11.5" />
                  <line x1="0.5" y1="6" x2="2" y2="6" />
                  <line x1="10" y1="6" x2="11.5" y2="6" />
                  <line x1="2.1" y1="2.1" x2="3.2" y2="3.2" />
                  <line x1="8.8" y1="8.8" x2="9.9" y2="9.9" />
                  <line x1="9.9" y1="2.1" x2="8.8" y2="3.2" />
                  <line x1="3.2" y1="8.8" x2="2.1" y2="9.9" />
                </svg>
              ) : (
                <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M 9.2 2.4 A 4.6 4.6 0 1 0 9.2 9.6 A 3.6 3.6 0 0 1 9.2 2.4 Z" />
                </svg>
              )}
            </button>
          )}
          <div className="h-3 w-px" style={{ background: 'var(--isl-border)' }}></div>
          {onSwitchToCanvas && (
            <button
              type="button"
              onClick={onSwitchToCanvas}
              className="isl-tab isl-tab--active inline-flex items-center gap-1"
              title={language === 'zho' ? '切换到画布模式' : 'Switch to Canvas'}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="18" r="3" />
                <path d="M12 9v3M9 15l3-3M15 15l-3-3" />
              </svg>
              <span className="text-[10px]">{language === 'zho' ? '工作流' : 'Workflow'}</span>
            </button>
          )}
          {onToggleLanguage && (
            <button
              type="button"
              onClick={onToggleLanguage}
              className="isl-tab inline-flex items-center gap-0.5"
              title={language === 'zho' ? 'Switch to English' : '切换到中文'}
            >
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="4.2" />
                <ellipse cx="6" cy="6" rx="1.8" ry="4.2" />
                <line x1="1.8" y1="6" x2="10.2" y2="6" />
              </svg>
              {language === 'zho' ? 'EN' : '中'}
            </button>
          )}
        </div>
      </div>
    </div>
  </div>
);
