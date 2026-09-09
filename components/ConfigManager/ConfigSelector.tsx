/**
 * ConfigSelector — 输入框旁的配置 + 模型联动选择器
 *
 * 选择器只有一份业务状态，但会根据所在容器呈现为两个 chip、一个紧凑
 * selector 或移动端 bottom sheet。菜单通过共享 ResponsivePopover 定位，
 * 不依赖父级 overflow 或固定的 bottom-full 坐标。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelItem, UserApiKey } from '../../types';
import { DEFAULT_PROVIDER_MODELS, PROVIDER_LABELS } from '../../services/aiGateway';
import { ResponsivePopover } from '../ResponsivePopover';

interface ConfigSelectorProps {
  configs: UserApiKey[];
  activeConfigId: string | null;
  activeModelId: string | null;
  onConfigChange: (id: string) => void;
  onModelChange: (modelId: string) => void;
  isDark: boolean;
}

type SelectorMenu = 'config' | 'model' | 'combined';

/** 从 UserApiKey 中提取可用模型列表。 */
function getModelsForKey(key: UserApiKey): ModelItem[] {
  if (key.models && key.models.length > 0) return key.models;
  if (key.customModels && key.customModels.length > 0) return key.customModels.map(id => ({ id, name: id }));
  const providerModels = DEFAULT_PROVIDER_MODELS[key.provider];
  if (!providerModels) return [];
  return [...(providerModels.text || []), ...(providerModels.image || []), ...(providerModels.video || [])].map(id => ({ id, name: id }));
}

const Chevron = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const ConfigSelector: React.FC<ConfigSelectorProps> = ({
  configs,
  activeConfigId,
  activeModelId,
  onConfigChange,
  onModelChange,
  isDark,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverAnchorRef = useRef<HTMLElement | null>(null);
  const [openMenu, setOpenMenu] = useState<SelectorMenu | null>(null);
  const [modelQuery, setModelQuery] = useState('');
  const activeConfig = configs.find(config => config.id === activeConfigId);
  const models = activeConfig ? getModelsForKey(activeConfig) : [];
  const activeModel = models.find(model => model.id === activeModelId);

  const closeMenu = useCallback((restoreFocus = true) => {
    if (restoreFocus) popoverAnchorRef.current?.focus();
    setOpenMenu(null);
    setModelQuery('');
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const element = target instanceof Element ? target : null;
      if (rootRef.current?.contains(target) || element?.closest('[data-responsive-popover]')) return;
      closeMenu(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [closeMenu]);

  useEffect(() => {
    if (!openMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeMenu, openMenu]);

  const open = (menu: SelectorMenu, event: React.MouseEvent<HTMLButtonElement>) => {
    popoverAnchorRef.current = event.currentTarget;
    setModelQuery('');
    setOpenMenu(menu);
  };

  const serviceLabel = activeConfig?.name || (activeConfig ? PROVIDER_LABELS[activeConfig.provider] || activeConfig.provider : '选择服务');
  const modelLabel = activeModel?.name || activeModel?.id || '选择模型';
  const filteredModels = models.filter(model => `${model.name || ''} ${model.id}`.toLowerCase().includes(modelQuery.trim().toLowerCase()));

  if (configs.length === 0) {
    return (
      <div className="config-selector config-selector--empty" data-theme={isDark ? 'dark' : 'light'} role="status">
        <span aria-hidden="true">⚙️</span>
        <span>无配置，请到设置中新建</span>
      </div>
    );
  }

  const renderConfigOptions = () => (
    <div className="config-selector__options" role="menu" aria-label="AI 服务">
      {configs.map(config => {
        const label = config.name || PROVIDER_LABELS[config.provider] || config.provider;
        return (
          <button
            key={config.id}
            type="button"
            role="menuitemradio"
            aria-checked={config.id === activeConfigId}
            className={`isl-opt ${config.id === activeConfigId ? 'isl-opt--active' : ''}`}
            title={label}
            onClick={() => { onConfigChange(config.id); closeMenu(); }}
          >
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {config.id === activeConfigId && <span aria-hidden="true">✓</span>}
          </button>
        );
      })}
    </div>
  );

  const renderModelOptions = () => (
    <div className="config-selector__model-list">
      {models.length > 5 && (
        <label className="config-selector__search">
          <span className="sr-only">搜索模型</span>
          <input value={modelQuery} onChange={event => setModelQuery(event.target.value)} placeholder="搜索模型…" />
        </label>
      )}
      <div className="config-selector__options" role="menu" aria-label="可用模型">
        {filteredModels.length ? filteredModels.map(model => {
          const label = model.name || model.id;
          return (
            <button
              key={model.id}
              type="button"
              role="menuitemradio"
              aria-checked={model.id === activeModelId}
              className={`isl-opt ${model.id === activeModelId ? 'isl-opt--active' : ''}`}
              title={model.id}
              onClick={() => { onModelChange(model.id); closeMenu(); }}
            >
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {model.id === activeModelId && <span aria-hidden="true">✓</span>}
            </button>
          );
        }) : <p className="config-selector__empty-search">没有匹配的模型</p>}
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="config-selector" data-theme={isDark ? 'dark' : 'light'}>
      <div className="config-selector__wide" aria-label="AI 服务和模型">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'config'}
          onClick={event => open('config', event)}
          className={`isl-chip config-selector__trigger ${openMenu === 'config' ? 'isl-chip--active' : ''}`}
          title={serviceLabel}
        >
          <span aria-hidden="true">📋</span><span className="config-selector__label">{serviceLabel}</span><Chevron />
        </button>
        <button
          type="button"
          disabled={models.length === 0}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'model'}
          onClick={event => open('model', event)}
          className={`isl-chip config-selector__trigger ${openMenu === 'model' ? 'isl-chip--active' : ''}`}
          title={modelLabel}
        >
          <span aria-hidden="true">🤖</span><span className="config-selector__label">{modelLabel}</span><Chevron />
        </button>
      </div>

      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={openMenu === 'combined'}
        onClick={event => open('combined', event)}
        className="isl-chip config-selector__compact-trigger"
        title={`${serviceLabel} · ${modelLabel}`}
      >
        <span className="config-selector__label">{serviceLabel} · {modelLabel}</span><Chevron />
      </button>

      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={openMenu === 'combined'}
        onClick={event => open('combined', event)}
        className="isl-chip config-selector__narrow-trigger"
      >
        <span className="config-selector__label">AI 服务 / 模型</span><Chevron />
      </button>

      {openMenu && popoverAnchorRef.current && (
        <ResponsivePopover
          anchorRef={popoverAnchorRef}
          preferredSide="up"
          width={360}
          role="dialog"
          ariaLabel={openMenu === 'model' ? '选择模型' : openMenu === 'config' ? '选择 AI 服务' : '选择 AI 服务和模型'}
          onRequestClose={() => closeMenu()}
          dataTestId="config-selector-popover"
          className="config-selector__popover"
        >
          {openMenu === 'config' && <><div className="config-selector__popover-title">AI 服务</div>{renderConfigOptions()}</>}
          {openMenu === 'model' && <><div className="config-selector__popover-title">可用模型</div>{renderModelOptions()}</>}
          {openMenu === 'combined' && (
            <>
              <div className="config-selector__popover-title">AI 服务</div>
              {renderConfigOptions()}
              <div className="config-selector__divider" />
              <div className="config-selector__popover-title">可用模型</div>
              {models.length ? renderModelOptions() : <p className="config-selector__empty-search">当前服务没有可用模型</p>}
            </>
          )}
        </ResponsivePopover>
      )}
    </div>
  );
};
