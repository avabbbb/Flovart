import { Bot, Clapperboard, FileText, Image as ImageIcon, Plus, Trash2, Video, X } from 'lucide-react';
import { useState } from 'react';
import { Button, Modal, Segmented } from 'antd';
import { nanoid } from 'nanoid';
import { generateTextWithProvider } from '../../services/aiGateway';
import { inferProviderFromModel } from '../../services/aiGateway';
import type { ModelPreference, UserApiKey } from '../../types';
import type { ScriptAsset, ScriptBreakdown, ScriptShot, WorkflowNode, WorkflowNodeMetadata } from './types';

const BREAKDOWN_SYSTEM_PROMPT = `你是一个专业的剧本拆解助手。用户会给你一段剧本或故事描述，你需要将其拆解为结构化的分镜数据。

输出严格的 JSON 格式（不要 markdown 代码块，不要其他文字）：
{
  "assets": [
    { "kind": "character", "name": "角色名", "description": "外貌、性格描述" },
    { "kind": "scene", "name": "场景名", "description": "场景描述" },
    { "kind": "prop", "name": "道具名", "description": "道具描述" }
  ],
  "shots": [
    {
      "index": 0,
      "emotion": "情绪/表情",
      "action": "动作描述",
      "dialogue": "台词",
      "sfx": "音效/音乐",
      "scene": "场景名",
      "promptOverride": "用于 AI 生图的英文 prompt，包含角色、场景、动作、光影、构图等细节"
    }
  ]
}

规则：
- 每个分镜必须有 index（从 0 开始）、action、promptOverride
- promptOverride 用英文撰写，适合 AI 图片生成
- 尽量覆盖剧本的关键画面，通常 4-12 个分镜
- assets 列出所有出现的角色、场景和道具`;

function parseBreakdownResponse(text: string): ScriptBreakdown | null {
  try {
    const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.shots)) return null;
    return {
      assets: Array.isArray(parsed.assets) ? parsed.assets.map((asset: any, index: number) => ({
        id: nanoid(),
        kind: asset.kind || 'character',
        name: asset.name || `资产${index + 1}`,
        description: asset.description,
      })) : [],
      shots: parsed.shots.map((shot: any) => ({
        id: nanoid(),
        index: typeof shot.index === 'number' ? shot.index : 0,
        emotion: shot.emotion,
        action: shot.action,
        dialogue: shot.dialogue,
        sfx: shot.sfx,
        scene: shot.scene,
        promptOverride: shot.promptOverride,
      })),
      sourceText: undefined,
    };
  } catch {
    return null;
  }
}

function resolveTextModel(modelPreference: ModelPreference, userApiKeys: UserApiKey[]): string | null {
  if (modelPreference.textModel) return modelPreference.textModel;
  const textKey = userApiKeys.find(key => inferProviderFromModel('') !== key.provider && (key.provider === 'openai' || key.provider === 'anthropic' || key.provider === 'google' || key.provider === 'openrouter'));
  if (textKey?.models?.length) return textKey.models[0];
  return null;
}

export function ScriptNodeEditor({ node, onChange, onClose, userApiKeys, modelPreference, onOpenSettings, onBatchGenerate }: {
  node: WorkflowNode;
  onChange: (metadata: WorkflowNodeMetadata) => void;
  onClose: () => void;
  userApiKeys: UserApiKey[];
  modelPreference: ModelPreference;
  onOpenSettings?: () => void;
  onBatchGenerate?: (mode: 'image' | 'video') => void;
}) {
  const breakdown = node.metadata.scriptBreakdown || { assets: [], shots: [] };
  const [sourceText, setSourceText] = useState(breakdown.sourceText || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'shots' | 'assets'>('shots');

  const updateBreakdown = (patch: Partial<ScriptBreakdown>) => {
    onChange({ ...node.metadata, scriptBreakdown: { ...breakdown, ...patch } });
  };

  const handleBreakdown = async () => {
    if (!sourceText.trim()) { setError('请先输入剧本内容'); return; }
    const model = resolveTextModel(modelPreference, userApiKeys);
    if (!model) { setError('未配置文本模型，请先在设置中添加 API Key'); onOpenSettings?.(); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await generateTextWithProvider(sourceText, model, undefined, {
        systemPrompt: BREAKDOWN_SYSTEM_PROMPT,
        temperature: 0.7,
        maxTokens: 8192,
      });
      const parsed = parseBreakdownResponse(result);
      if (!parsed) { setError('AI 返回格式无法解析，请重试'); return; }
      updateBreakdown({ ...parsed, sourceText });
    } catch (err) {
      setError(err instanceof Error ? err.message : '剧本拆解失败');
    } finally {
      setBusy(false);
    }
  };

  const updateShot = (shotId: string, patch: Partial<ScriptShot>) => {
    updateBreakdown({ shots: breakdown.shots.map(shot => shot.id === shotId ? { ...shot, ...patch } : shot) });
  };

  const deleteShot = (shotId: string) => {
    updateBreakdown({ shots: breakdown.shots.filter(shot => shot.id !== shotId) });
  };

  const addShot = () => {
    const nextIndex = breakdown.shots.length;
    updateBreakdown({ shots: [...breakdown.shots, { id: nanoid(), index: nextIndex }] });
  };

  const updateAsset = (assetId: string, patch: Partial<ScriptAsset>) => {
    updateBreakdown({ assets: breakdown.assets.map(asset => asset.id === assetId ? { ...asset, ...patch } : asset) });
  };

  const deleteAsset = (assetId: string) => {
    updateBreakdown({ assets: breakdown.assets.filter(asset => asset.id !== assetId) });
  };

  const addAsset = (kind: ScriptAsset['kind']) => {
    updateBreakdown({ assets: [...breakdown.assets, { id: nanoid(), kind, name: '' }] });
  };

  return (
    <Modal
      open
      onCancel={busy ? undefined : onClose}
      footer={null}
      centered
      width="90%"
      style={{ maxWidth: 1200, top: 20 }}
      destroyOnHidden
      maskClosable={!busy}
      title={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Clapperboard size={18} />脚本分镜编辑器</div>}
    >
      <div style={{ display: 'flex', gap: 16, height: '72vh', minHeight: 500 }}>
        <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--wf-text)' }}>剧本原文</div>
            <textarea
              value={sourceText}
              onChange={event => setSourceText(event.target.value)}
              placeholder="粘贴剧本、故事大纲或分镜描述..."
              style={{ width: '100%', height: 180, resize: 'none', padding: 8, border: '1px solid var(--wf-border)', borderRadius: 6, background: 'var(--wf-panel)', color: 'var(--wf-text)', fontSize: 13, lineHeight: 1.5 }}
            />
            <Button type="primary" icon={<Bot size={15} />} loading={busy} onClick={handleBreakdown} block style={{ marginTop: 6 }}>
              AI 拆解剧本
            </Button>
            {error && <div role="alert" style={{ marginTop: 6, fontSize: 12, color: '#ef4444' }}>{error}</div>}
          </div>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--wf-text)' }}>资产列表 ({breakdown.assets.length})</span>
            <div style={{ display: 'flex', gap: 2 }}>
              <button className="isl-icon-btn h-7 w-7" aria-label="添加角色" onClick={() => addAsset('character')}><Plus size={14} /></button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {breakdown.assets.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--wf-muted)', textAlign: 'center', padding: '20px 0' }}>点击 AI 拆解或手动添加资产</div>
            ) : breakdown.assets.map(asset => (
              <div key={asset.id} style={{ padding: 8, border: '1px solid var(--wf-border)', borderRadius: 6, background: 'var(--wf-panel)', fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: asset.kind === 'character' ? '#6366f1' : asset.kind === 'scene' ? '#10b981' : '#f59e0b', color: '#fff' }}>
                    {asset.kind === 'character' ? '角色' : asset.kind === 'scene' ? '场景' : '道具'}
                  </span>
                  <input
                    value={asset.name}
                    placeholder="名称"
                    onChange={event => updateAsset(asset.id, { name: event.target.value })}
                    style={{ flex: 1, border: 'none', background: 'transparent', color: 'var(--wf-text)', fontSize: 12, fontWeight: 600, outline: 'none' }}
                  />
                  <button className="isl-icon-btn h-5 w-5" aria-label="删除资产" onClick={() => deleteAsset(asset.id)}><X size={12} /></button>
                </div>
                <textarea
                  value={asset.description || ''}
                  placeholder="描述"
                  onChange={event => updateAsset(asset.id, { description: event.target.value })}
                  rows={2}
                  style={{ width: '100%', resize: 'none', border: 'none', background: 'transparent', color: 'var(--wf-muted)', fontSize: 11, outline: 'none', lineHeight: 1.4 }}
                />
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Segmented
              value={activeTab}
              onChange={value => setActiveTab(value as 'shots' | 'assets')}
              options={[{ label: `分镜 (${breakdown.shots.length})`, value: 'shots' }, { label: `资产 (${breakdown.assets.length})`, value: 'assets' }]}
            />
            {activeTab === 'shots' && (
              <div style={{ display: 'flex', gap: 6 }}>
                <Button icon={<ImageIcon size={15} />} onClick={() => onBatchGenerate?.('image')} size="small" disabled={breakdown.shots.length === 0}>批量生图</Button>
                <Button icon={<Video size={15} />} onClick={() => onBatchGenerate?.('video')} size="small" disabled={breakdown.shots.length === 0}>批量生视频</Button>
                <Button icon={<Plus size={15} />} onClick={addShot} size="small">添加分镜</Button>
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            {activeTab === 'shots' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {breakdown.shots.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--wf-muted)' }}>
                    <FileText size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
                    <div style={{ fontSize: 13 }}>还没有分镜，输入剧本后点击"AI 拆解剧本"</div>
                  </div>
                ) : breakdown.shots.map(shot => (
                  <ShotCard
                    key={shot.id}
                    shot={shot}
                    onChange={patch => updateShot(shot.id, patch)}
                    onDelete={() => deleteShot(shot.id)}
                  />
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {breakdown.assets.map(asset => (
                  <div key={asset.id} style={{ padding: 12, border: '1px solid var(--wf-border)', borderRadius: 6, background: 'var(--wf-panel)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: asset.kind === 'character' ? '#6366f1' : asset.kind === 'scene' ? '#10b981' : '#f59e0b', color: '#fff' }}>
                        {asset.kind === 'character' ? '角色' : asset.kind === 'scene' ? '场景' : '道具'}
                      </span>
                      <input
                        value={asset.name}
                        placeholder="资产名称"
                        onChange={event => updateAsset(asset.id, { name: event.target.value })}
                        style={{ flex: 1, border: '1px solid var(--wf-border)', borderRadius: 4, padding: '4px 8px', background: 'var(--wf-bg)', color: 'var(--wf-text)', fontSize: 13, fontWeight: 600, outline: 'none' }}
                      />
                      <button className="isl-icon-btn h-7 w-7" aria-label="删除资产" onClick={() => deleteAsset(asset.id)}><Trash2 size={14} /></button>
                    </div>
                    <textarea
                      value={asset.description || ''}
                      placeholder="详细描述（外貌、性格、场景细节等）"
                      onChange={event => updateAsset(asset.id, { description: event.target.value })}
                      rows={3}
                      style={{ width: '100%', resize: 'vertical', border: '1px solid var(--wf-border)', borderRadius: 4, padding: '6px 8px', background: 'var(--wf-bg)', color: 'var(--wf-text)', fontSize: 12, outline: 'none', lineHeight: 1.5 }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ShotCard({ shot, onChange, onDelete }: {
  shot: ScriptShot;
  onChange: (patch: Partial<ScriptShot>) => void;
  onDelete: () => void;
}) {
  const field = (label: string, key: keyof ScriptShot, placeholder?: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--wf-muted)' }}>{label}</span>
      <input
        value={String(shot[key] || '')}
        placeholder={placeholder}
        onChange={event => onChange({ [key]: event.target.value } as Partial<ScriptShot>)}
        style={{ border: '1px solid var(--wf-border)', borderRadius: 4, padding: '3px 6px', background: 'var(--wf-bg)', color: 'var(--wf-text)', fontSize: 12, outline: 'none' }}
      />
    </label>
  );
  return (
    <div style={{ padding: 10, border: '1px solid var(--wf-border)', borderRadius: 6, background: 'var(--wf-panel)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--wf-text)', minWidth: 32 }}>#{shot.index + 1}</span>
        {shot.imageNodeId && <span title="已关联图片节点" style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#6366f1', color: '#fff' }}><ImageIcon size={10} style={{ verticalAlign: 'middle' }} /></span>}
        {shot.videoNodeId && <span title="已关联视频节点" style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#ec4899', color: '#fff' }}><Video size={10} style={{ verticalAlign: 'middle' }} /></span>}
        <div style={{ flex: 1 }} />
        <button className="isl-icon-btn h-6 w-6" aria-label="删除分镜" onClick={onDelete}><Trash2 size={13} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        {field('情绪/表情', 'emotion', '开心、悲伤...')}
        {field('动作', 'action', '角色在做什么')}
        {field('场景', 'scene', '室内/室外')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
        {field('台词', 'dialogue', '角色说的话')}
        {field('音效', 'sfx', '背景音乐/音效')}
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--wf-muted)' }}>生图 Prompt（英文，覆盖自动推断）</span>
        <textarea
          value={shot.promptOverride || ''}
          placeholder="A close-up shot of..."
          onChange={event => onChange({ promptOverride: event.target.value })}
          rows={2}
          style={{ width: '100%', resize: 'vertical', border: '1px solid var(--wf-border)', borderRadius: 4, padding: '4px 6px', background: 'var(--wf-bg)', color: 'var(--wf-text)', fontSize: 12, outline: 'none', lineHeight: 1.4 }}
        />
      </label>
    </div>
  );
}
