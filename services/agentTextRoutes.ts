import type { RouteMappingBinding, UserApiKey } from '../types';
import { isOpenAICompatibleProvider, resolveProviderBaseUrl } from './baseUrl';

/**
 * Agent 文本线路的唯一解析点（浏览器内核、Tauri runtime 同步、模型选择器共用）。
 
  1. 显式：Key 的 routeMappings 里 runtime-capability/agent-text 映射，按 order → 默认 Key → id 排序。
 * 2. 隐式回退：没有任何显式映射时，取可用的 OpenAI 兼容文本 Key（默认 Key 优先），
 *    用它的 defaultModel / 第一个文本模型 / 第一个自定义模型。配好 Key 就能对话，
 *    不再强迫用户先去「模型映射」多点一步。
 */
export type AgentTextRouteKey = Pick<
  UserApiKey,
  'id' | 'provider' | 'baseUrl' | 'routeMappings' | 'isDefault' | 'capabilities' | 'status'
> & Partial<Pick<UserApiKey, 'models' | 'customModels' | 'defaultModel'>>;

export interface ResolvedAgentTextRoute<K extends AgentTextRouteKey = AgentTextRouteKey> {
  key: K;
  model: string;
  baseUrl: string;
  /** true = 没有显式 agent-text 映射，由回退规则选出。 */
  implicit: boolean;
}

export function isAgentTextMapping(mapping: RouteMappingBinding): boolean {
  return mapping.target.kind === 'runtime-capability' && mapping.target.capability === 'agent-text';
}

export function isAgentTextKey(key: AgentTextRouteKey): boolean {
  return isOpenAICompatibleProvider(key.provider)
    && Boolean(key.id)
    && key.status !== 'error'
    && (!key.capabilities?.length || key.capabilities.includes('text'));
}

export function fallbackAgentTextModel(key: AgentTextRouteKey): string {
  const textModels = (key.models || [])
    .filter(item => item.capability === 'text')
    .map(item => item.id.trim())
    .filter(Boolean);
  const preferred = key.defaultModel?.trim();
  if (preferred && (!textModels.length || textModels.includes(preferred))) return preferred;
  return textModels[0]
    || (key.customModels || []).map(id => id.trim()).find(Boolean)
    || '';
}

type Candidate<K> = { key: K; model: string; order: number; preferred: boolean };

const byPriority = <K extends AgentTextRouteKey>(left: Candidate<K>, right: Candidate<K>) => (
  left.order - right.order
  || Number(right.preferred) - Number(left.preferred)
  || left.key.id.localeCompare(right.key.id)
);

export function resolveAgentTextRoutes<K extends AgentTextRouteKey>(keys: readonly K[]): ResolvedAgentTextRoute<K>[] {
  const eligible = keys.filter(isAgentTextKey);
  const explicit: Candidate<K>[] = eligible.flatMap(key => (key.routeMappings || [])
    .filter(isAgentTextMapping)
    .map(mapping => ({ key, model: mapping.routeId.trim(), order: mapping.order, preferred: Boolean(key.isDefault) })));
  const usableExplicit = explicit.filter(candidate => candidate.model);
  const implicit = usableExplicit.length === 0;
  const candidates = implicit
    ? eligible.map(key => ({ key, model: fallbackAgentTextModel(key), order: 0, preferred: Boolean(key.isDefault) }))
      .filter(candidate => candidate.model)
    : usableExplicit;
  return candidates
    .sort(byPriority)
    .map(candidate => ({
      key: candidate.key,
      model: candidate.model,
      baseUrl: resolveProviderBaseUrl(candidate.key.provider, candidate.key.baseUrl),
      implicit,
    }))
    .filter(route => route.baseUrl);
}
