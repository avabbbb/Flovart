import { Box, Check, KeyRound, Loader2, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AICapability, ModelItem, RouteMappingBinding, UserApiKey } from '../../types';
import { isOpenAICompatibleProvider } from '../../services/baseUrl';
import { resolveBrowserAgentTextRoute } from '../../services/browserAgentKernel';
import { fetchModelsForProvider } from '../../services/modelFetcher';

type Lang = 'en' | 'zho';
const ui = (language: Lang, zho: string, en: string) => (language === 'en' ? en : zho);

const isAgentText = (mapping: RouteMappingBinding) => mapping.target.kind === 'runtime-capability' && mapping.target.capability === 'agent-text';
const agentTextMapping = (routeId: string): RouteMappingBinding => ({ target: { kind: 'runtime-capability', capability: 'agent-text' }, routeId, order: 0 });

function textKeys(keys: UserApiKey[]) {
  return keys.filter(key => isOpenAICompatibleProvider(key.provider) && key.status !== 'error' && (!key.capabilities?.length || key.capabilities.includes('text')));
}

function keyModels(key: UserApiKey): ModelItem[] {
  const items: ModelItem[] = key.models?.length
    ? key.models
    : (key.customModels || []).map(id => ({ id, name: id, capability: 'text' as AICapability }));
  const text = items.filter(item => item.capability === 'text');
  return text.length ? text : items;
}

function keyLabel(key: UserApiKey): string {
  if (key.name) return key.name;
  try { return key.baseUrl ? new URL(key.baseUrl).host : key.provider; } catch { return key.provider; }
}

export function AgentModelPicker({ userApiKeys, onAddApiKey, onUpdateApiKey, open, onOpenChange, language }: {
  userApiKeys: UserApiKey[];
  onAddApiKey?: (payload: Omit<UserApiKey, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateApiKey?: (id: string, patch: Partial<Omit<UserApiKey, 'id' | 'createdAt'>>) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: Lang;
}) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keys = useMemo(() => textKeys(userApiKeys), [userApiKeys]);
  const current = useMemo(() => resolveBrowserAgentTextRoute(userApiKeys), [userApiKeys]);
  const currentKeyId = useMemo(() => keys.find(key => key.routeMappings?.some(mapping => isAgentText(mapping) && mapping.routeId.trim() === current?.model))?.id, [keys, current]);
  const groups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return keys
      .map(key => ({ key, models: keyModels(key).filter(model => !normalized || model.id.toLowerCase().includes(normalized) || (model.name || '').toLowerCase().includes(normalized)) }))
      .filter(group => group.models.length > 0);
  }, [keys, query]);
  const showForm = adding || keys.length === 0;
  const label = ui(language, '选择模型', 'Choose model');

  // 只保留一条 agent-text 映射，选哪个就是哪个，避免排序规则让别的 Key 抢先。
  const select = (keyId: string, modelId: string) => {
    for (const key of keys) {
      const others = (key.routeMappings || []).filter(mapping => !isAgentText(mapping));
      const next = key.id === keyId ? [...others, agentTextMapping(modelId)] : others;
      if (next.length !== (key.routeMappings || []).length || key.id === keyId) onUpdateApiKey?.(key.id, { routeMappings: next });
    }
    onOpenChange(false);
  };

  const importModels = async () => {
    const url = baseUrl.trim();
    const secret = apiKey.trim();
    if (!url || !secret || importing) return;
    setImporting(true);
    setError(null);
    try {
      const result = await fetchModelsForProvider('openai_compatible', secret, url);
      if (!result.ok || result.models.length === 0) {
        setError(result.error || ui(language, '没有拉取到模型，请检查 URL 和 Key', 'No models found. Check the URL and key.'));
        return;
      }
      const models: ModelItem[] = result.models.map(model => ({ id: model.id, name: model.name || model.id, capability: model.capability }));
      const capabilities = [...new Set<AICapability>(models.map(model => model.capability))];
      const firstText = models.find(model => model.capability === 'text') || models[0];
      // 新 Key 接管 Agent：先清掉其他 Key 的 agent-text 映射。
      for (const key of keys) {
        const others = (key.routeMappings || []).filter(mapping => !isAgentText(mapping));
        if (others.length !== (key.routeMappings || []).length) onUpdateApiKey?.(key.id, { routeMappings: others });
      }
      const effectiveBaseUrl = result.effectiveBaseUrl || url;
      let name = effectiveBaseUrl;
      try { name = new URL(effectiveBaseUrl).host; } catch { /* keep raw url */ }
      onAddApiKey?.({
        provider: 'openai_compatible',
        key: secret,
        baseUrl: effectiveBaseUrl,
        name,
        capabilities: capabilities.length ? capabilities : ['text'],
        models,
        defaultModel: firstText.id,
        status: 'ok',
        routeMappings: [agentTextMapping(firstText.id)],
      });
      setApiKey('');
      setBaseUrl('');
      setAdding(false);
    } catch {
      setError(ui(language, '网络错误，拉取模型失败', 'Network error while fetching models.'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="agent-mode-control">
      <button type="button" className={`agent-model-trigger${current ? ' is-active' : ''}`} aria-label={label} title={current ? current.model : label} aria-expanded={open} onClick={() => onOpenChange(!open)}>
        <Box size={14} /><span>{current ? current.model : label}</span>
      </button>
      {open && (
        <div className="agent-mode-menu agent-model-menu agent-model-picker" role="dialog" aria-label={label}>
          <div className="agent-model-picker__head">
            <strong>{label}</strong>
            {keys.length > 0 && <button type="button" aria-label={ui(language, '添加 Key', 'Add key')} aria-pressed={adding} onClick={() => { setAdding(value => !value); setError(null); }}><Plus size={14} /></button>}
          </div>
          {showForm && (
            <form className="agent-model-picker__form" onSubmit={event => { event.preventDefault(); void importModels(); }}>
              <input aria-label="Base URL" placeholder="Base URL，如 https://api.example.com/v1" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} autoComplete="off" spellCheck={false} />
              <input aria-label="API Key" placeholder="API Key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} />
              <button type="submit" disabled={!baseUrl.trim() || !apiKey.trim() || importing}>
                {importing ? <Loader2 size={13} className="is-spinning" /> : <KeyRound size={13} />}
                {importing ? ui(language, '正在拉取模型…', 'Fetching models…') : ui(language, '导入全部模型', 'Import all models')}
              </button>
              {error && <p className="agent-model-picker__error" role="alert">{error}</p>}
            </form>
          )}
          {keys.length > 0 && <label className="agent-model-picker__search"><Search size={13} /><input aria-label={ui(language, '搜索模型', 'Search models')} placeholder={ui(language, '搜索模型', 'Search models')} value={query} onChange={event => setQuery(event.target.value)} /></label>}
          {keys.length > 0 && (
            <div className="agent-model-menu__list" role="listbox" aria-label={label}>
              {groups.length === 0 && <p className="agent-model-menu__empty">{ui(language, '没有匹配的模型', 'No matching models')}</p>}
              {groups.map(group => (
                <section key={group.key.id} className="agent-model-picker__group">
                  <small>{keyLabel(group.key)}</small>
                  {group.models.map(model => {
                    const selected = group.key.id === currentKeyId && model.id === current?.model;
                    return (
                      <button key={model.id} type="button" role="option" aria-selected={selected} onClick={() => select(group.key.id, model.id)}>
                        <span><strong>{model.name || model.id}</strong>{model.name && model.name !== model.id && <small>{model.id}</small>}</span>
                        {selected && <Check size={14} />}
                      </button>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
