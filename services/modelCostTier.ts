/**
 * 模型费用档位（P2-F）：让 Agent 默认就能给用户「省钱 vs 质量」的选择。
 *
 * - priceRange：用户在 API Key 上配置的计价规则里，这个模型（或它的线路）实际的单价区间——这是真实价格，有就以它为准。
 * - costTier：cheap / standard / premium 粗分档位。没有任何官方价目表内置在应用里，所以档位来自模型在同家族里的定位
 *   （Fast / Flash / Lite 等为省钱档，Pro / Omni / 旗舰为高质量档），basis 标为 'family-position'，不是价格，
 *   只用于排序与给用户选项；要报金额只用 priceRange / cost_estimate 的 estimatedCost。
 */
import type { ApiPricingRule, UserApiKey } from '../types';
import { getProductModel } from './productModelCatalog';

export type ModelCostTier = 'cheap' | 'standard' | 'premium';

export interface ModelPriceRange {
  min: number;
  max: number;
  currency: 'USD' | 'CNY';
  unit: ApiPricingRule['unit'];
  /** 规则来源：official=随线路提供的官方价，manual=用户手填。 */
  source: ApiPricingRule['source'];
}

export interface ModelCostInfo {
  costTier: ModelCostTier;
  costTierBasis: 'family-position';
  priceRange?: ModelPriceRange;
}

/** 已知产品模型的档位（同一家族内的相对定位）。 */
const TIER_BY_MODEL: Record<string, ModelCostTier> = {
  'flovart:gpt-image-2': 'premium',
  'flovart:gemini-3-pro-image': 'premium',
  'flovart:gemini-3.1-flash-image': 'standard',
  'flovart:gemini-3.1-flash-lite-image': 'cheap',
  'flovart:imagen-4': 'standard',
  'flovart:seedream-5-pro': 'premium',
  'flovart:seedream-5-flash': 'cheap',
  'flovart:seedream-4.5': 'standard',
  'flovart:midjourney-v8-1': 'premium',
  'flovart:seedance-2': 'standard',
  'flovart:seedance-2-fast': 'cheap',
  'flovart:seedance-2.5': 'premium',
  'flovart:veo-3.1': 'premium',
  'flovart:veo-3.1-fast': 'standard',
  'flovart:veo-3.1-lite': 'cheap',
  'flovart:kling-video-3': 'standard',
  'flovart:kling-video-3-omni': 'premium',
  'flovart:grok-imagine-video': 'standard',
  'flovart:grok-imagine-video-1.5': 'standard',
};

/** 目录外的模型（RunningHub 动态卡等）按名字里的定位词推断。 */
export function inferCostTier(text: string): ModelCostTier {
  const value = text.toLowerCase();
  if (/(lite|flash|fast|mini|turbo|nano|low[-_ ]?price|schnell|lightning|轻量|极速|低价)/.test(value)) return 'cheap';
  if (/(pro|ultra|omni|max|premium|hd|master|旗舰|专业)/.test(value)) return 'premium';
  return 'standard';
}

export function modelCostTier(modelId: string | undefined): ModelCostTier {
  if (!modelId) return 'standard';
  const model = getProductModel(modelId);
  const id = model?.id || modelId;
  return TIER_BY_MODEL[id] || inferCostTier([id, model?.name || ''].join(' '));
}

/** 用户 Key 上配置的、作用于这个模型的计价规则 → 单价区间（只取同币种、同计价单位里最常见的一组）。 */
export function modelPriceRange(modelId: string, keys: readonly UserApiKey[]): ModelPriceRange | undefined {
  const model = getProductModel(modelId);
  const id = model?.id || modelId;
  const rules = keys.flatMap(key => (key.pricingRules || []).filter(rule => rule.productModelId === id
    && rule.unit !== 'input_token' && rule.unit !== 'output_token'));
  if (!rules.length) return undefined;
  const groups = new Map<string, ApiPricingRule[]>();
  for (const rule of rules) groups.set(rule.currency + ':' + rule.unit, [...(groups.get(rule.currency + ':' + rule.unit) || []), rule]);
  const [first] = [...groups.values()].sort((left, right) => right.length - left.length);
  const rates = first.map(rule => rule.rate);
  return {
    min: Math.min(...rates),
    max: Math.max(...rates),
    currency: first[0].currency,
    unit: first[0].unit,
    source: first.every(rule => rule.source === 'official') ? 'official' : 'manual',
  };
}

export function describeModelCost(modelId: string, keys: readonly UserApiKey[] = []): ModelCostInfo {
  const priceRange = modelPriceRange(modelId, keys);
  return { costTier: modelCostTier(modelId), costTierBasis: 'family-position', ...(priceRange ? { priceRange } : {}) };
}

const TIER_RANK: Record<ModelCostTier, number> = { cheap: 0, standard: 1, premium: 2 };
export const compareCostTier = (left: ModelCostTier, right: ModelCostTier) => TIER_RANK[left] - TIER_RANK[right];
