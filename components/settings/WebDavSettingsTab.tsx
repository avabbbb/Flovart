import { useEffect, useState } from 'react';
import type { UserApiKey } from '../../types';
import {
  DEFAULT_WEBDAV_CONFIG,
  WebDavError,
  loadWebDavConfig,
  saveWebDavConfig,
  syncWebDav,
  testWebDavConnection,
  type WebDavConfig,
} from '../../services/webdavSync';

interface WebDavSettingsTabProps {
  userApiKeys: UserApiKey[];
  onUpdateApiKey: (id: string, patch: Partial<Omit<UserApiKey, 'id' | 'createdAt'>>) => void;
}

const fieldClass = 'isl-well w-full px-3 py-2 text-sm text-[var(--isl-ink)] outline-none placeholder:text-[var(--isl-ink-ghost)]';
const labelClass = 'mb-1 block text-xs font-semibold text-[var(--isl-ink-soft)]';
const buttonClass = 'isl-chip px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';
// 占位地址用拼接构造（坚果云示例）。
const URL_PLACEHOLDER = 'https' + String.fromCharCode(58) + '//dav.jianguoyun.com/dav/';

function describeError(error: unknown): string {
  if (error instanceof WebDavError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export function WebDavSettingsTab({ userApiKeys, onUpdateApiKey }: WebDavSettingsTabProps) {
  const [config, setConfig] = useState<WebDavConfig>(DEFAULT_WEBDAV_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'test' | 'sync' | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let active = true;
    loadWebDavConfig()
      .then(saved => { if (active) setConfig(saved); })
      .catch(error => console.warn('[WebDAV] load config failed', error))
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  const patch = (next: Partial<WebDavConfig>) => setConfig(current => ({ ...current, ...next }));
  const disabled = !loaded || busy !== null || !config.url.trim();

  const handleTest = async () => {
    setBusy('test');
    setNotice(null);
    try {
      await saveWebDavConfig(config);
      const result = await testWebDavConnection(config);
      setNotice({ ok: true, text: result.dirCreated ? '连接成功，已创建远程目录' : '连接成功' });
    } catch (error) {
      setNotice({ ok: false, text: describeError(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async () => {
    setBusy('sync');
    setNotice(null);
    try {
      const now = Date.now();
      const result = await syncWebDav(config, userApiKeys, undefined, now);
      for (const item of result.merged) {
        if (!result.updatedIds.includes(item.id)) continue;
        const { id, ...rest } = item;
        onUpdateApiKey(id, rest);
      }
      const next = { ...config, lastSyncAt: now };
      setConfig(next);
      await saveWebDavConfig(next);
      const parts = ['同步完成'];
      if (result.updatedIds.length) parts.push('从远端更新 ' + result.updatedIds.length + ' 个渠道');
      if (result.missingLocally.length) {
        const names = result.missingLocally.map(item => item.name || item.provider).join('、');
        parts.push('远端另有 ' + result.missingLocally.length + ' 个渠道本机没有，需在本机添加 Key：' + names);
      }
      setNotice({ ok: true, text: parts.join('；') });
    } catch (error) {
      setNotice({ ok: false, text: describeError(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-4" data-testid="settings-webdav">
      <div>
        <div className="text-sm font-extrabold text-[var(--isl-ink)]">WebDAV 同步</div>
        <div className="mt-1 text-xs text-[var(--isl-ink-soft)]">
          在多台设备间同步渠道、模型列表与路由设置。API Key 不会上传，换设备后需要在本机重新填写 Key。服务端需放行跨域（CORS）。
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>WebDAV 地址</span>
          <input className={fieldClass} value={config.url} placeholder={URL_PLACEHOLDER} onChange={event => patch({ url: event.target.value })} />
        </label>
        <label className="block">
          <span className={labelClass}>远程目录</span>
          <input className={fieldClass} value={config.remoteDir} placeholder="flovart" onChange={event => patch({ remoteDir: event.target.value })} />
        </label>
        <label className="block">
          <span className={labelClass}>用户名</span>
          <input className={fieldClass} value={config.username} autoComplete="username" onChange={event => patch({ username: event.target.value })} />
        </label>
        <label className="block">
          <span className={labelClass}>密码 / 应用密码</span>
          <div className="flex gap-2">
            <input
              className={fieldClass}
              type={showPassword ? 'text' : 'password'}
              value={config.password}
              autoComplete="current-password"
              onChange={event => patch({ password: event.target.value })}
            />
            <button type="button" className={`${buttonClass} shrink-0 whitespace-nowrap`} onClick={() => setShowPassword(value => !value)}>
              {showPassword ? '隐藏' : '显示'}
            </button>
          </div>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} disabled={disabled} onClick={() => void handleTest()}>
          {busy === 'test' ? '测试中…' : '测试连接'}
        </button>
        <button type="button" className={buttonClass} disabled={disabled} onClick={() => void handleSync()}>
          {busy === 'sync' ? '同步中…' : '立即同步'}
        </button>
        <span className="text-xs text-[var(--isl-ink-soft)]">
          {config.lastSyncAt ? '上次同步：' + new Date(config.lastSyncAt).toLocaleString() : '尚未同步'}
        </span>
      </div>
      {notice && (
        <div
          role="status"
          className={'rounded-xl border px-3 py-2 text-xs ' + (notice.ok
            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300'
            : 'border-red-400/30 bg-red-400/10 text-red-700 dark:text-red-300')}
        >
          {notice.text}
        </div>
      )}
    </section>
  );
}
