import type { UserApiKey } from '../../types';
import { getKeyModelIds } from '../../utils/modelRefs';

interface ChannelListProps {
  userApiKeys: UserApiKey[];
  editingKeyId: string | null;
  providerLabel: (item: UserApiKey) => string;
  onEdit: (item: UserApiKey) => void;
  onDelete: (item: UserApiKey) => void;
  onSetDefault: (id: string) => void;
  t: (key: string, ...args: unknown[]) => string;
}

// 名称 · 协议 · 模型数 · 地址 · 操作
const COLUMNS = { gridTemplateColumns: 'minmax(0,1.4fr) 96px 56px minmax(0,1.6fr) auto' };
const actionClass = 'rounded-md px-2 py-1 text-xs text-[var(--isl-ink-soft)] transition hover:bg-[var(--isl-surface-2)] hover:text-[var(--isl-ink)]';

function displayAddress(url?: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.host + parsed.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function statusDot(status: UserApiKey['status']): string {
  if (status === 'ok') return 'bg-green-500';
  if (status === 'error') return 'bg-red-400';
  return 'bg-yellow-400';
}

export function ChannelList({ userApiKeys, editingKeyId, providerLabel, onEdit, onDelete, onSetDefault, t }: ChannelListProps) {
  if (userApiKeys.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--isl-border)] settings-elevated settings-elevated--soft px-4 py-6 text-center text-sm text-[var(--isl-ink-soft)]">
        <div className="font-medium text-[var(--isl-ink)]">{t('settingsExtra.emptyServicesTitle')}</div>
        <div className="mt-1 text-xs">{t('settingsExtra.emptyServicesHint')}</div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--isl-border)] settings-elevated" data-testid="settings-channel-list">
      <div style={COLUMNS} className="grid items-center gap-3 bg-[var(--isl-surface-2)] px-3 py-1.5 text-[11px] font-semibold text-[var(--isl-ink-soft)]">
        <span>名称</span>
        <span>协议</span>
        <span>模型</span>
        <span>地址</span>
        <span className="text-right">操作</span>
      </div>
      {userApiKeys.map(item => {
        const label = providerLabel(item);
        const statusTitle = item.status === 'ok'
          ? t('settingsExtra.api.verified')
          : item.status === 'error' ? t('settingsExtra.api.verificationFailed') : t('settingsExtra.api.unverified');
        return (
          <div
            key={item.id}
            style={COLUMNS}
            data-testid="settings-channel-row"
            className={'grid items-center gap-3 border-t border-[var(--isl-border)] px-3 py-2 text-sm ' + (editingKeyId === item.id ? 'bg-[var(--isl-surface-2)]' : '')}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className={'inline-block h-2 w-2 shrink-0 rounded-full ' + statusDot(item.status)} title={statusTitle} />
              <span className="truncate font-medium text-[var(--isl-ink)]" title={label}>{label}</span>
              {item.isDefault && (
                <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">{t('settingsExtra.api.default')}</span>
              )}
            </div>
            <div className="truncate text-xs text-[var(--isl-ink-soft)]">{item.extraConfig?.requestFormat || item.provider}</div>
            <div className="text-xs tabular-nums text-[var(--isl-ink-soft)]">{getKeyModelIds(item).length}</div>
            <div className="truncate text-xs text-[var(--isl-ink-soft)]" title={item.baseUrl}>
              {displayAddress(item.baseUrl) || t('settingsExtra.api.localConfiguration')}
            </div>
            <div className="flex justify-end gap-0.5">
              {!item.isDefault && (
                <button type="button" className={actionClass} onClick={() => onSetDefault(item.id)}>{t('settingsExtra.api.makeDefault')}</button>
              )}
              <button type="button" className={actionClass} onClick={() => onEdit(item)}>{t('settingsExtra.api.edit')}</button>
              <button type="button" className={actionClass + ' hover:text-red-500'} onClick={() => onDelete(item)}>{t('settingsExtra.api.delete')}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
