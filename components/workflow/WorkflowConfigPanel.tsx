import { Play } from 'lucide-react';
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { extractMentions } from '../CanvasMentionExtension';
import type { MentionItem } from '../MentionList';
import RichPromptEditor from '../RichPromptEditor';
import type { GenerationCapability, GenerationMode } from '../../services/generationCapabilities';
import { modelRefModelId } from '../../utils/modelRefs';
import type { WorkflowNode, WorkflowNodeMetadata } from './types';
import type { StudioMediaItem } from '../studio/StudioMediaBrowser';

type CapabilityResolver = (mode: GenerationMode, modelId?: string) => GenerationCapability;

export interface WorkflowSharedMedia extends StudioMediaItem {}

const emptyCapability: CapabilityResolver = mode => ({
  mode,
  models: [],
  aspectRatios: [],
  resolutions: [],
  durations: [],
  supportsReferences: [],
});

const CapabilityContext = createContext<CapabilityResolver>(emptyCapability);
const SharedMediaContext = createContext<WorkflowSharedMedia[]>([]);

export function WorkflowGenerationCapabilitiesProvider({ resolve, sharedMedia = [], children }: { resolve?: CapabilityResolver; sharedMedia?: WorkflowSharedMedia[]; children: ReactNode }) {
  return <CapabilityContext.Provider value={resolve || emptyCapability}><SharedMediaContext.Provider value={sharedMedia}>{children}</SharedMediaContext.Provider></CapabilityContext.Provider>;
}

export const useWorkflowSharedMedia = () => useContext(SharedMediaContext);

export function WorkflowConfigPanel({ node, nodes, onChange, onRun, onStop }: {
  node: WorkflowNode;
  nodes?: WorkflowNode[];
  onChange: (metadata: WorkflowNodeMetadata) => void;
  onRun: () => void;
  onStop?: () => void;
}) {
  const resolve = useContext(CapabilityContext);
  const config = node.metadata.config || { mode: 'image' as const };
  const capability = resolve(config.mode, config.modelId);
  const updateConfig = (patch: Partial<typeof config>) => onChange({ config: { ...config, ...patch } });
  const status = node.metadata.status || 'idle';
  const audioUnsupported = config.mode === 'audio';
  const mentionItems: MentionItem[] = (nodes || []).filter(item => item.id !== node.id).map(item => ({
    id: item.id,
    label: item.title,
    thumbnail: item.metadata.href || '',
    elementType: item.type,
    description: item.metadata.content?.trim().slice(0, 36) || item.type,
  }));

  return (
    <div data-workflow-overlay data-testid="workflow-config-panel" className="workflow-config" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      <div className="workflow-config__row">
        <label>类型</label>
        <select aria-label="类型" value={config.mode} onChange={event => {
          const mode = event.target.value as GenerationMode;
          updateConfig({ mode, modelId: resolve(mode).models[0] });
        }}>
          <option value="text">文本</option>
          <option value="image">图片</option>
          <option value="video">视频</option>
          <option value="audio">音频（暂不支持）</option>
        </select>
      </div>
      <div className="workflow-config__row">
        <label>模型</label>
        <select aria-label="模型" disabled={audioUnsupported} value={config.modelId || ''} onChange={event => updateConfig({ modelId: event.target.value || undefined })}>
          <option value="">跟随全局模型</option>
          {capability.models.map(model => <option key={model} value={model}>{modelRefModelId(model)}</option>)}
        </select>
      </div>
      {nodes ? <div className="workflow-config__composer" style={{ '--prompt-editor-color': 'var(--wf-text)', '--prompt-editor-placeholder': 'var(--wf-muted)', '--prompt-editor-min-height': '72px', '--prompt-editor-max-height': '140px', '--prompt-editor-padding': '7px' } as CSSProperties}>
        <RichPromptEditor
          canvasItems={mentionItems}
          initialText={node.metadata.prompt || ''}
          initialDocument={node.metadata.richTextDocument}
          placeholder="输入提示词，按 @ 引用节点"
          onSubmit={onRun}
          onTextChange={(prompt, richTextDocument) => onChange({ prompt, richTextDocument, mentionedNodeIds: extractMentions(richTextDocument).map(item => item.id) })}
        />
      </div> : <textarea value={node.metadata.prompt || ''} placeholder="输入提示词；上游文本会自动合并" onChange={event => onChange({ prompt: event.target.value })} />}
      {capability.aspectRatios.length > 0 && (
        <div className="workflow-config__row">
          <label>比例</label>
          <select aria-label="比例" value={config.aspectRatio || capability.aspectRatios[0]} onChange={event => updateConfig({ aspectRatio: event.target.value })}>
            {capability.aspectRatios.map(value => <option key={value}>{value}</option>)}
          </select>
        </div>
      )}
      {capability.resolutions.length > 0 && (
        <div className="workflow-config__row">
          <label>清晰度</label>
          <select aria-label="清晰度" value={config.resolution || capability.resolutions[0]} onChange={event => updateConfig({ resolution: event.target.value })}>
            {capability.resolutions.map(value => <option key={value}>{value}</option>)}
          </select>
        </div>
      )}
      {capability.durations.length > 0 && (
        <div className="workflow-config__row">
          <label>时长</label>
          <select aria-label="时长" value={config.durationSec || capability.durations[0]} onChange={event => updateConfig({ durationSec: Number(event.target.value) })}>
            {capability.durations.map(value => <option key={value} value={value}>{value} 秒</option>)}
          </select>
        </div>
      )}
      {config.mode === 'video' && <>
        <label className="workflow-config__check"><input type="checkbox" checked={Boolean(config.generateAudio)} onChange={event => updateConfig({ generateAudio: event.target.checked })} />生成音频</label>
        <label className="workflow-config__check"><input type="checkbox" checked={Boolean(config.watermark)} onChange={event => updateConfig({ watermark: event.target.checked })} />添加水印</label>
      </>}
      {config.mode === 'audio' && <>
        <div className="workflow-config__row"><label>音色</label><input aria-label="音色" value={config.audioVoice || ''} placeholder="例如 alloy" onChange={event => updateConfig({ audioVoice: event.target.value })} /></div>
        <div className="workflow-config__row"><label>格式</label><select aria-label="格式" value={config.audioFormat || 'mp3'} onChange={event => updateConfig({ audioFormat: event.target.value })}><option value="mp3">MP3</option><option value="wav">WAV</option><option value="aac">AAC</option><option value="flac">FLAC</option></select></div>
        <div className="workflow-config__row"><label>语速</label><input aria-label="语速" type="number" min="0.25" max="4" step="0.05" value={config.audioSpeed || '1'} onChange={event => updateConfig({ audioSpeed: event.target.value })} /></div>
        <textarea value={config.audioInstructions || ''} placeholder="音频风格、情绪和发音说明" onChange={event => updateConfig({ audioInstructions: event.target.value })} />
      </>}
      {config.mode !== 'text' && <div className="workflow-config__row"><label>数量</label><select aria-label="数量" value={config.count || 1} onChange={event => updateConfig({ count: Number(event.target.value) })}>{[1, 2, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></div>}
      {node.metadata.error && <p className="workflow-config__error">{node.metadata.error}</p>}
      {status === 'loading' && <p role="status">生成中{node.metadata.progress === undefined ? '' : ` · ${Math.round(node.metadata.progress)}%`}</p>}
      {audioUnsupported && <p className="workflow-config__error">音频生成暂未支持</p>}
      <button type="button" onClick={status === 'loading' && onStop ? onStop : onRun} disabled={audioUnsupported || status === 'loading' && !onStop}>
        <Play size={13} />{audioUnsupported ? '暂不支持' : status === 'loading' ? '停止' : status === 'error' ? '重试' : '生成'}
      </button>
    </div>
  );
}
