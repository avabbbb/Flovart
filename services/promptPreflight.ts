import { getModelCapabilities } from './modelTemplateRegistry';
import { generateTextWithProvider } from './aiGateway';
import { getKeyCapabilities, getKeyModelIds } from '../utils/modelRefs';
import type { UserApiKey } from '../types';

export interface PreflightResult {
  optimizedPrompt: string;
  complianceWarnings: string[];
  skippedOptimization: boolean;
  skippedCompliance: boolean;
}

const COMPLIANCE_KEYWORDS = [
  '暴力', '血腥', '色情', '裸体', '恐怖主义', '政治敏感',
  'violence', 'gore', 'pornographic', 'nudity', 'terrorism',
];

function basicComplianceCheck(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  return COMPLIANCE_KEYWORDS.filter(keyword => lower.includes(keyword.toLowerCase()));
}

function findTextKey(keys: UserApiKey[]): { key: UserApiKey; model: string } | null {
  for (const key of keys) {
    if (key.status === 'error') continue;
    if (!getKeyCapabilities(key).includes('text')) continue;
    const model = getKeyModelIds(key, 'text')[0];
    if (model) return { key, model };
  }
  return null;
}

const OPTIMIZATION_SYSTEM_PROMPT = `你是一个视频生成提示词优化专家。请将用户给定的提示词优化为更适合 Seedance 视频生成模型的英文提示词。
要求：
1. 保留原始创意意图和关键描述
2. 补充运镜、光影、构图等视觉细节
3. 使用英文输出，不超过 200 词
4. 只输出优化后的提示词，不要解释`;

export async function runPreflight(
  prompt: string,
  modelId: string | undefined,
  userApiKeys: UserApiKey[],
  capability?: 'text' | 'image' | 'video',
): Promise<PreflightResult> {
  const caps = getModelCapabilities(modelId, capability);
  const result: PreflightResult = {
    optimizedPrompt: prompt,
    complianceWarnings: [],
    skippedOptimization: true,
    skippedCompliance: true,
  };

  if (!caps) return result;

  if (caps.complianceCheck) {
    const flagged = basicComplianceCheck(prompt);
    if (flagged.length > 0) {
      result.complianceWarnings = flagged;
    }
    result.skippedCompliance = false;
  }

  if (caps.promptOptimization && prompt.trim()) {
    const textKey = findTextKey(userApiKeys);
    if (textKey) {
      try {
        const optimized = await generateTextWithProvider(
          `${OPTIMIZATION_SYSTEM_PROMPT}\n\n[原始提示词]\n${prompt}`,
          textKey.model,
          textKey.key,
          { signal: AbortSignal.timeout(15000) },
        );
        if (optimized?.trim()) {
          result.optimizedPrompt = optimized.trim();
          result.skippedOptimization = false;
        }
      } catch {
        result.skippedOptimization = true;
      }
    }
  }

  return result;
}
