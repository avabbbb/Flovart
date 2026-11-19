import { X } from 'lucide-react';
import { CUT_ACTIONS, CUT_DEFAULT_SHORTCUTS, formatShortcut } from '../../services/cut/shortcuts';

type Lang = 'zho' | 'en';

export function CutShortcutSheet({ language, onClose }: { language: Lang; onClose: () => void }) {
  const zh = language === 'zho';
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return (
    <div className="cut-sheet" role="dialog" aria-modal="true" aria-label={zh ? '快捷键' : 'Keyboard shortcuts'} data-testid="cut-shortcuts" onClick={onClose}>
      <div className="cut-sheet__card" onClick={event => event.stopPropagation()}>
        <header className="cut-panel__head">
          <h2 className="cut-panel__title">{zh ? '快捷键（剪映 / CapCut 默认）' : 'Keyboard shortcuts (CapCut defaults)'}</h2>
          <button type="button" className="iris-icon-btn is-small" aria-label={zh ? '关闭' : 'Close'} onClick={onClose}><X size={12} /></button>
        </header>
        <dl className="cut-sheet__list">
          {CUT_DEFAULT_SHORTCUTS.map(([action, keys]) => (
            <div key={action} className="cut-sheet__row">
              <dt>{zh ? CUT_ACTIONS[action].zh : CUT_ACTIONS[action].en}</dt>
              <dd>{keys.filter(key => key !== 'mod+plus' && key !== '?').map(key => <kbd key={key}>{formatShortcut(key, mac)}</kbd>)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
