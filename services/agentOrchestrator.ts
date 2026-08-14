/**
 * Multi-Agent Orchestrator
 * 
 * Manages a group of AI agents that discuss a user task collaboratively,
 * then produce a final prompt for image generation.
 */

import type { AgentRole, AgentRoleId, AgentConfig, AgentMessage, AgentSession, AgentBudget, AIProvider, UserApiKey } from '../types';
import { generateTextWithProvider, inferProviderFromModel } from './aiGateway';
import { normalizeProviderBaseUrl } from './baseUrl';

// ── Preset Agent Roles ──────────────────────────────────────────────

export const PRESET_ROLES: AgentRole[] = [
    {
        id: 'creative_director',
        name: '创意总监',
        emoji: '🎬',
        color: '#6366F1',
        description: '构思画面内容和叙事',
        systemPrompt: `你是一位创意总监。你的职责是：
- 根据用户任务构思画面内容、场景和叙事
- 提出有创意的视觉概念
- 确定画面要传达的情绪和氛围
回复请简洁（2-4句话），用中文，不要使用markdown格式。聚焦于创意方向。`,
    },
    {
        id: 'prompt_engineer',
        name: '提示词工程师',
        emoji: '✍️',
        color: '#EC4899',
        description: '将想法转为精准提示词',
        systemPrompt: `你是一位提示词工程师。你的职责是：
- 将创意想法转化为精准的AI绘图提示词
- 使用专业的提示词结构（主体、场景、光照、风格、质量标签）
- 确保提示词对AI模型友好
回复请简洁（2-4句话），用中文，不要使用markdown格式。聚焦于提示词优化。`,
    },
    {
        id: 'style_master',
        name: '风格大师',
        emoji: '🎨',
        color: '#F59E0B',
        description: '决定艺术风格和色调',
        systemPrompt: `你是一位风格大师。你的职责是：
- 决定画面的艺术风格（写实、动漫、油画、水彩等）
- 建议色彩搭配和色调
- 提供参考风格关键词
回复请简洁（2-4句话），用中文，不要使用markdown格式。聚焦于风格建议。`,
    },
    {
        id: 'compositor',
        name: '构图师',
        emoji: '📐',
        color: '#10B981',
        description: '决定画面构图和视角',
        systemPrompt: `你是一位构图师。你的职责是：
- 决定画面的构图方式（三分法、对称、引导线等）
- 建议镜头角度和视角（俯视、仰视、特写等）
- 确定画面的景深和空间感
回复请简洁（2-4句话），用中文，不要使用markdown格式。聚焦于构图和视角。`,
    },
    {
        id: 'quality_reviewer',
        name: '质量审查',
        emoji: '✅',
        color: '#8B5CF6',
        description: '审查最终提示词并提出修改',
        systemPrompt: `你是一位质量审查员。你的职责是：
- 审查前面所有人的讨论，综合出最终的图片生成提示词
- 检查提示词是否完整、清晰、无矛盾
- 在最后一轮时，输出最终提示词，格式为：[FINAL_PROMPT]你的最终提示词[/FINAL_PROMPT]
回复请简洁，用中文，不要使用markdown格式。`,
    },
];

export function getRoleById(id: AgentRoleId): AgentRole | undefined {
    return PRESET_ROLES.find(r => r.id === id);
}

// ── Default Agent Team ──────────────────────────────────────────────

export function createDefaultTeam(): AgentConfig[] {
    return PRESET_ROLES.map((role, i) => ({
        id: `agent-${i}`,
        roleId: role.id,
        enabled: true,
    }));
}

export function createDefaultBudget(): AgentBudget {
    return { maxCost: 0.5, currentCost: 0, maxRounds: 5 };
}

export function createSession(task: string, agents: AgentConfig[], budget: AgentBudget): AgentSession {
    return {
        id: `session-${Date.now()}`,
        task,
        agents: agents.filter(a => a.enabled),
        messages: [],
        status: 'idle',
        budget,
        currentRound: 0,
    };
}

// ── LLM Call ────────────────────────────────────────────────────────

interface LLMCallOptions {
    model: string;
    systemPrompt: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    apiKey: string;
    baseUrl: string;
    provider: AIProvider;
    key?: UserApiKey;
    signal?: AbortSignal;
}

const DEFAULT_BASE_URLS: Partial<Record<AIProvider, string>> = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta',
    deepseek: 'https://api.deepseek.com/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    siliconflow: 'https://api.siliconflow.cn/v1',
};

async function callLLM(opts: LLMCallOptions): Promise<string> {
    const { model, systemPrompt, messages, apiKey, baseUrl, provider, key, signal: externalSignal } = opts;

    // 60s 超时，同时尊重外部 abort signal
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort);
    const signal = controller.signal;

    try {

    if (key) {
        const prompt = messages.map(message => message.content).join('\n\n');
        return await generateTextWithProvider(prompt, model, key, {
            systemPrompt,
            temperature: 0.7,
            maxTokens: 512,
            signal,
        });
    }

    if (provider === 'anthropic') {
        const response = await fetch(`${baseUrl}/messages`, {
            method: 'POST',
            signal,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model,
                max_tokens: 512,
                system: systemPrompt,
                messages,
            }),
        });
        if (!response.ok) throw new Error(`Anthropic ${response.status}`);
        const json = await response.json();
        return Array.isArray(json?.content) ? json.content.map((c: { text?: string }) => c.text || '').join('') : '';
    }

    if (provider === 'google') {
        const url = `${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));
        const response = await fetch(url, {
            method: 'POST',
            signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents,
                generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
            }),
        });
        if (!response.ok) throw new Error(`Google ${response.status}`);
        const json = await response.json();
        return json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    // OpenAI-compatible (openai, deepseek, qwen, siliconflow, custom)
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            temperature: 0.7,
            max_tokens: 512,
            messages: [
                { role: 'system', content: systemPrompt },
                ...messages,
            ],
        }),
    });
    if (!response.ok) throw new Error(`LLM ${response.status}`);
    const json = await response.json();
    return json?.choices?.[0]?.message?.content || '';

    } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', onExternalAbort);
    }
}

// ── Orchestration Engine ────────────────────────────────────────────

export interface OrchestratorCallbacks {
    onMessage: (msg: AgentMessage) => void;
    onStatusChange: (status: AgentSession['status']) => void;
    onRoundChange: (round: number) => void;
    onFinalPrompt: (prompt: string) => void;
    onError: (error: string) => void;
    onBudgetUpdate: (budget: AgentBudget) => void;
    getApiKeyForModel: (model: string) => UserApiKey | undefined;
}

// Approximate costs per 1K tokens for common models
const COST_PER_1K: Record<string, number> = {
    'gpt-5.4': 0.005,
    'gpt-5.4-mini': 0.001,
    'gpt-5.4-nano': 0.0003,
    'gpt-4o': 0.005,
    'gpt-4o-mini': 0.00015,
    'claude-opus-4-6': 0.015,
    'claude-sonnet-4-6': 0.003,
    'claude-haiku-4-5': 0.0008,
    'gemini-3-flash': 0.0001,
    'gemini-3.1-pro': 0.001,
    'gemini-2.5-flash': 0.0001,
    'gemini-2.5-pro': 0.001,
    'deepseek-chat': 0.0001,
    'deepseek-v3': 0.0001,
    'qwen-max': 0.0002,
};

function estimateCost(model: string, outputChars: number): number {
    const tokensApprox = outputChars / 3;
    const normalizedModel = model.toLowerCase();
    for (const [key, cost] of Object.entries(COST_PER_1K)) {
        if (normalizedModel.includes(key)) return (tokensApprox / 1000) * cost;
    }
    return (tokensApprox / 1000) * 0.001; // fallback
}

export class AgentOrchestrator {
    private session: AgentSession;
    private callbacks: OrchestratorCallbacks;
    private abortController: AbortController | null = null;
    private textModel: string;

    constructor(session: AgentSession, callbacks: OrchestratorCallbacks, textModel: string) {
        this.session = session;
        this.callbacks = callbacks;
        this.textModel = textModel;
    }

    async run() {
        this.abortController = new AbortController();
        this.session.status = 'discussing';
        this.callbacks.onStatusChange('discussing');

        const enabledAgents = this.session.agents.filter(a => a.enabled);
        const roles = enabledAgents.map(a => getRoleById(a.roleId)).filter(Boolean) as AgentRole[];

        try {
            for (let round = 1; round <= this.session.budget.maxRounds; round++) {
                if (this.abortController.signal.aborted) break;
                if (this.session.budget.currentCost >= this.session.budget.maxCost) {
                    this.callbacks.onError(`已达到预算上限 $${this.session.budget.maxCost.toFixed(2)}`);
                    break;
                }

                this.session.currentRound = round;
                this.callbacks.onRoundChange(round);

                const isLastRound = round === this.session.budget.maxRounds;

                for (let i = 0; i < enabledAgents.length; i++) {
                    if (this.abortController.signal.aborted) break;

                    const agent = enabledAgents[i];
                    const role = roles[i];
                    if (!role) continue;

                    // Build conversation context for this agent
                    const conversationHistory = this.buildConversationContext(round, isLastRound, role);

                    const model = agent.model || this.textModel;
                    const provider = inferProviderFromModel(model);
                    const key = this.callbacks.getApiKeyForModel(model);

                    if (!key?.key) {
                        this.callbacks.onError(`未找到模型 ${model} 的 API Key`);
                        this.session.status = 'error';
                        this.callbacks.onStatusChange('error');
                        return;
                    }

                    const baseUrl = normalizeProviderBaseUrl(provider, key.baseUrl || DEFAULT_BASE_URLS[provider] || '');

                    // Emit "generating" placeholder
                    const placeholderId = `msg-${Date.now()}-${i}`;
                    const placeholder: AgentMessage = {
                        id: placeholderId,
                        agentId: agent.id,
                        agentName: role.name,
                        agentEmoji: role.emoji,
                        agentColor: role.color,
                        role: 'agent',
                        content: '',
                        timestamp: Date.now(),
                        isGenerating: true,
                    };
                    this.callbacks.onMessage(placeholder);

                    try {
                        const reply = await callLLM({
                            model,
                            systemPrompt: role.systemPrompt + (isLastRound ? '\n这是最后一轮讨论，请给出你的最终总结。' : ''),
                            messages: conversationHistory,
                            apiKey: key.key,
                            baseUrl,
                            provider,
                            key,
                            signal: this.abortController?.signal,
                        });

                        // Update cost
                        const cost = estimateCost(model, reply.length);
                        this.session.budget.currentCost += cost;
                        this.callbacks.onBudgetUpdate({ ...this.session.budget });

                        const finalMsg: AgentMessage = {
                            ...placeholder,
                            content: reply,
                            isGenerating: false,
                            timestamp: Date.now(),
                        };
                        this.session.messages.push(finalMsg);
                        this.callbacks.onMessage(finalMsg);

                        // Check for final prompt
                        const finalPromptMatch = reply.match(/\[FINAL_PROMPT\]([\s\S]*?)\[\/FINAL_PROMPT\]/);
                        if (finalPromptMatch) {
                            this.session.finalPrompt = finalPromptMatch[1].trim();
                            this.session.status = 'generating';
                            this.callbacks.onStatusChange('generating');
                            this.callbacks.onFinalPrompt(this.session.finalPrompt);
                            return;
                        }
                    } catch (err) {
                        const errorMsg: AgentMessage = {
                            ...placeholder,
                            content: `⚠️ ${role.name} 请求失败: ${err instanceof Error ? err.message : String(err)}`,
                            isGenerating: false,
                        };
                        this.session.messages.push(errorMsg);
                        this.callbacks.onMessage(errorMsg);
                    }

                    // Small delay between agents
                    await new Promise(r => setTimeout(r, 300));
                }
            }

            // If no FINAL_PROMPT was extracted, ask quality reviewer to summarize
            if (!this.session.finalPrompt) {
                const lastMessages = this.session.messages.slice(-10).map(m => m.content).join('\n');
                this.session.finalPrompt = lastMessages;
                this.session.status = 'generating';
                this.callbacks.onStatusChange('generating');
                this.callbacks.onFinalPrompt(lastMessages);
            }
        } catch (err) {
            this.session.status = 'error';
            this.callbacks.onStatusChange('error');
            this.callbacks.onError(err instanceof Error ? err.message : String(err));
        }
    }

    stop() {
        this.abortController?.abort();
        this.session.status = 'stopped';
        this.callbacks.onStatusChange('stopped');
    }

    private buildConversationContext(currentRound: number, isLastRound: boolean, _currentRole: AgentRole): { role: 'user' | 'assistant'; content: string }[] {
        const history: { role: 'user' | 'assistant'; content: string }[] = [];

        // Start with user task
        history.push({
            role: 'user',
            content: `用户任务：${this.session.task}\n\n当前是第${currentRound}/${this.session.budget.maxRounds}轮讨论。${isLastRound ? '这是最后一轮，请给出最终结论。' : '请提出你的建议。'}`,
        });

        // Add previous messages as context
        const recentMessages = this.session.messages.slice(-12);
        for (const msg of recentMessages) {
            if (msg.role === 'agent') {
                history.push({
                    role: 'assistant',
                    content: `[${msg.agentName}]: ${msg.content}`,
                });
            }
        }

        // Add a nudge to continue discussion
        if (recentMessages.length > 0) {
            history.push({
                role: 'user',
                content: isLastRound
                    ? '请综合以上讨论，给出你对最终提示词的建议。如果你是质量审查员，请用 [FINAL_PROMPT]...[/FINAL_PROMPT] 输出最终提示词。'
                    : '请基于以上讨论，提出你的专业建议。',
            });
        }

        return history;
    }
}
