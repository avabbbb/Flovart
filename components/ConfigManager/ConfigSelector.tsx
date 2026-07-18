/**
 * ConfigSelector — 输入框旁的配置 + 模型联动选择器
 *
 * 统一使用 UserApiKey 作为数据源（不再依赖 APIConfig）。
 * 两个紧凑下拉：选配置 → 选模型
 * 切换配置时自动更新模型列表并选中默认模型。
 */

import React, { useRef, useState, useEffect } from 'react';
import type { UserApiKey, ModelItem } from '../../types';
import { PROVIDER_LABELS, DEFAULT_PROVIDER_MODELS } from '../../services/aiGateway';

interface ConfigSelectorProps {
  configs: UserApiKey[];
  activeConfigId: string | null;
  activeModelId: string | null;
  onConfigChange: (id: string) => void;
  onModelChange: (modelId: string) => void;
  isDark: boolean;
}

/** 从 UserApiKey 中提取可用模型列表 */
function getModelsForKey(key: UserApiKey): ModelItem[] {
  if (key.models && key.models.length > 0) return key.models;
  if (key.customModels && key.customModels.length > 0) {
    return key.customModels.map(id => ({ id, name: id }));
  }
  // 回退到 provider 默认模型
  const pm = DEFAULT_PROVIDER_MODELS[key.provider];
  if (!pm) return [];
  const all = [
    ...(pm.text || []),
    ...(pm.image || []),
    ...(pm.video || []),
  ];
  return all.map(id => ({ id, name: id }));
}

export const ConfigSelector: React.FC<ConfigSelectorProps> = ({
  configs,
  activeConfigId,
  activeModelId,
  onConfigChange,
  onModelChange,
}) => {
  const [showConfigMenu, setShowConfigMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeConfig = configs.find(c => c.id === activeConfigId);
  const models: ModelItem[] = activeConfig ? getModelsForKey(activeConfig) : [];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setShowConfigMenu(false);
        setShowModelMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pillClass = 'isl-chip h-8 px-3 text-xs select-none';
  const pillActiveClass = 'isl-chip--active';
  const menuClass = 'isl-pop absolute bottom-full left-0 z-[85] mb-2 min-w-[200px] p-1.5';
  const optionClass = (active: boolean) =>
    `isl-opt text-xs ${active ? 'isl-opt--active' : ''}`;

  const chevron = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
  );

  if (configs.length === 0) {
    return (
      <div className="isl-chip h-8 border-dashed px-3 text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>
        <span>⚙️</span> 无配置，请到设置中新建
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex items-center gap-2">
      {/* 配置选择 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => { setShowConfigMenu(v => !v); setShowModelMenu(false); }}
          className={`${pillClass} ${showConfigMenu ? pillActiveClass : ''}`}
        >
          📋 <span className="max-w-[120px] truncate">{activeConfig?.name || (activeConfig ? PROVIDER_LABELS[activeConfig.provider] : '选择配置')}</span>
          {chevron}
        </button>

        {showConfigMenu && (
          <div className={menuClass}>
            <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--isl-ink-ghost)' }}>API 配置</div>
            {configs.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onConfigChange(c.id); setShowConfigMenu(false); }}
                className={optionClass(c.id === activeConfigId)}
              >
                <span className="truncate">{c.name || PROVIDER_LABELS[c.provider] || c.provider}</span>
                {c.id === activeConfigId && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 13 4 4L19 7" /></svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 模型选择 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => { setShowModelMenu(v => !v); setShowConfigMenu(false); }}
          disabled={models.length === 0}
          className={`${pillClass} ${showModelMenu ? pillActiveClass : ''} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          🤖 <span className="max-w-[120px] truncate">{models.find(m => m.id === activeModelId)?.name ?? '选择模型'}</span>
          {chevron}
        </button>

        {showModelMenu && models.length > 0 && (
          <div className={menuClass}>
            <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--isl-ink-ghost)' }}>可用模型</div>
            {models.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => { onModelChange(m.id); setShowModelMenu(false); }}
                className={optionClass(m.id === activeModelId)}
              >
                <span>{m.name}</span>
                {m.id === activeModelId && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m5 13 4 4L19 7" /></svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
