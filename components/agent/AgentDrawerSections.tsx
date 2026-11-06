import { Activity, ChevronDown, Gauge, Link2, MessageSquare, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import '../../styles/agentDrawerSections.css';
import { AgentActivityPanel } from './AgentActivityPanel';
import { AgentHostPicker } from './AgentHostPicker';
import { AgentHeaderLeadingContext } from './agentHeaderSlot';

export type AgentDrawerSection = 'chat' | 'connect' | 'status' | 'log';

const LOGO_SRC = `${import.meta.env.BASE_URL}favicon.png`;

const SECTIONS: ReadonlyArray<{ id: AgentDrawerSection; icon: LucideIcon; zho: string; en: string }> = [
  { id: 'chat', icon: MessageSquare, zho: '对话', en: 'Chat' },
  { id: 'connect', icon: Link2, zho: '连接指引', en: 'Connection guide' },
  { id: 'status', icon: Gauge, zho: '连接状态', en: 'Status' },
  { id: 'log', icon: Activity, zho: '运行日志', en: 'Run log' },
];

function AgentLogoMenu({ section, onSelect, zh }: { section: AgentDrawerSection; onSelect: (next: AgentDrawerSection) => void; zh: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  const menuLabel = zh ? '切换 Agent 页面' : 'Switch Agent page';
  return (
    <div ref={rootRef} className="agent-logo-menu">
      <button
        type="button"
        className="agent-logo-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel}
        title={menuLabel}
        onClick={() => setOpen(value => !value)}
      >
        <img src={LOGO_SRC} alt="" />
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="agent-logo-menu__list" role="menu" aria-label={menuLabel}>
          {SECTIONS.map(item => {
            const Icon = item.icon;
            const active = item.id === section;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={active ? 'is-active' : undefined}
                onClick={() => { onSelect(item.id); setOpen(false); }}
              >
                <Icon size={14} aria-hidden="true" />
                <span>{zh ? item.zho : item.en}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface AgentDrawerSectionsProps {
  projectTitle?: string;
  language?: 'en' | 'zho';
  /** children 自带顶栏（FlovartAgentPanel）时为 true：Logo 菜单会放进它的顶栏，而不是再叠一行。 */
  chatHasHeader?: boolean;
  /** 内置助手对话区；始终保持挂载，切到其它页面不会中断正在生成的回复。 */
  children: ReactNode;
}

export function AgentDrawerSections({ projectTitle, language = 'zho', chatHasHeader = false, children }: AgentDrawerSectionsProps) {
  const [section, setSection] = useState<AgentDrawerSection>('chat');
  const zh = language === 'zho';
  const leading = <AgentLogoMenu section={section} onSelect={setSection} zh={zh} />;
  const leadingInChat = section === 'chat' && chatHasHeader;
  const current = SECTIONS.find(item => item.id === section) ?? SECTIONS[0];
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="agent-drawer-sections">
      {!leadingInChat && (
        <header className="agent-drawer-header">
          {leading}
          <strong className="agent-drawer-header__title">{zh ? current.zho : current.en}</strong>
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <AgentHeaderLeadingContext.Provider value={leadingInChat ? leading : null}>
          <div className="h-full min-h-0" style={{ display: section === 'chat' ? undefined : 'none' }}>{children}</div>
        </AgentHeaderLeadingContext.Provider>
        {section !== 'chat' && (
          <div className="h-full min-h-0 overflow-y-auto p-3">
            {section === 'connect' && <AgentHostPicker projectTitle={projectTitle} language={language} />}
            {section === 'status' && <AgentActivityPanel language={language} view="status" />}
            {section === 'log' && <AgentActivityPanel language={language} view="log" />}
          </div>
        )}
      </div>
    </div>
  );
}
