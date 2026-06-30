import { Play } from 'lucide-react';
import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';
import { extractMentions } from '../CanvasMentionExtension';
import type { MentionItem } from '../MentionList';
import RichPromptEditor from '../RichPromptEditor';
import type { GenerationCapability, GenerationMode } from '../../services/generationCapabilities';
import { getModelCapabilities, isSeedanceModel } from '../../services/modelTemplateRegistry';
import { getVoicesByProvider } from '../../services/voiceCatalog';
import { modelRefModelId } from '../../utils/modelRefs';
import type { WorkflowNode, WorkflowNodeMetadata } from './types';
import type { StudioMediaItem } from '../studio/StudioMediaBrowser';
import { CAMERA_MOVEMENTS, CAMERA_OPTIONS, STYLE_PRESETS } from './constants';
import { SeedanceSlotPicker } from './SeedanceSlotPicker';

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
  const modelCapabilities = useMemo(() => getModelCapabilities(config.modelId, config.mode === 'image' ? 'image' : config.mode === 'video' ? 'video' : undefined), [config.modelId, config.mode]);
  const isSeedance = useMemo(() => isSeedanceModel(config.modelId), [config.modelId]);
  const minimaxVoices = useMemo(() => getVoicesByProvider('minimax'), []);
  const openaiVoices = useMemo(() => getVoicesByProvider('openai'), []);
  const groupedStyles = useMemo(() => {
    const groups: Record<string, typeof STYLE_PRESETS> = {};
    for (const style of STYLE_PRESETS) {
      (groups[style.category] ||= []).push(style);
    }
    return groups;
  }, []);
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
      {modelCapabilities && (modelCapabilities.maxReferences || modelCapabilities.complianceCheck || modelCapabilities.promptOptimization || modelCapabilities.supportsReferenceImage || modelCapabilities.supportsMaskEdit) && (
        <div className="workflow-config__badges" aria-label="模型能力">
          {modelCapabilities.maxReferences ? <span className="workflow-badge workflow-badge--ref" title={modelCapabilities.notes || `最多 ${modelCapabilities.maxReferences} 个参考输入`}>{modelCapabilities.maxReferences} refs</span> : null}
          {modelCapabilities.complianceCheck ? <span className="workflow-badge workflow-badge--compliance" title="生成前自动合规校验">合规</span> : null}
          {modelCapabilities.promptOptimization ? <span className="workflow-badge workflow-badge--prompt-opt" title="生成前自动 prompt 优化">prompt优化</span> : null}
          {modelCapabilities.supportsReferenceImage ? <span className="workflow-badge workflow-badge--ref-edit" title="支持参考图编辑">参考图编辑</span> : null}
          {modelCapabilities.supportsMaskEdit ? <span className="workflow-badge workflow-badge--mask" title="支持 mask 局部重绘">mask重绘</span> : null}
        </div>
      )}
      {isSeedance && config.mode === 'video' && (
        <p className="workflow-config__hint">Seedance 支持 12 槽位参考输入（9 图 + 3 视频 + 3 音频），请在下方"参考输入"区域配置。</p>
      )}
      {isSeedance && config.mode === 'video' && nodes && (
        <SeedanceSlotPicker
          nodes={nodes}
          value={config.seedanceRefs || { imageRefs: [], videoRefs: [], audioRefs: [] }}
          onChange={refs => updateConfig({ seedanceRefs: refs })}
        />
      )}
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
        <div className="workflow-config__row"><label>音色</label><select aria-label="音色" value={config.audioVoice || ''} onChange={event => updateConfig({ audioVoice: event.target.value || undefined })}><option value="">默认</option><optgroup label="MiniMax Speech 2.8">{minimaxVoices.map(voice => <option key={voice.id} value={voice.voiceId}>{voice.name}</option>)}</optgroup><optgroup label="OpenAI TTS">{openaiVoices.map(voice => <option key={voice.id} value={voice.voiceId}>{voice.name}</option>)}</optgroup></select></div>
        <div className="workflow-config__row"><label>格式</label><select aria-label="格式" value={config.audioFormat || 'mp3'} onChange={event => updateConfig({ audioFormat: event.target.value })}><option value="mp3">MP3</option><option value="wav">WAV</option><option value="aac">AAC</option><option value="flac">FLAC</option></select></div>
        <div className="workflow-config__row"><label>语速</label><input aria-label="语速" type="number" min="0.25" max="4" step="0.05" value={config.audioSpeed || '1'} onChange={event => updateConfig({ audioSpeed: event.target.value })} /></div>
        <textarea value={config.audioInstructions || ''} placeholder="音频风格、情绪和发音说明" onChange={event => updateConfig({ audioInstructions: event.target.value })} />
      </>}
      {config.mode !== 'text' && <div className="workflow-config__row"><label>数量</label><select aria-label="数量" value={config.count || 1} onChange={event => updateConfig({ count: Number(event.target.value) })}>{[1, 2, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></div>}
      {config.mode === 'image' && <div className="workflow-config__row"><label>风格</label><select aria-label="风格" value={config.styleId || ''} onChange={event => updateConfig({ styleId: event.target.value || undefined })}><option value="">无</option>{Object.entries(groupedStyles).map(([category, styles]) => <optgroup key={category} label={category}>{styles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</optgroup>)}</select></div>}
      {config.mode === 'image' && <>
        <div className="workflow-config__row"><label>相机</label><select aria-label="相机" value={config.camera?.camera || ''} onChange={event => updateConfig({ camera: { ...config.camera, camera: event.target.value || undefined } })}><option value="">无</option>{CAMERA_OPTIONS.cameras.map(value => <option key={value}>{value}</option>)}</select></div>
        <div className="workflow-config__row"><label>镜头</label><select aria-label="镜头" value={config.camera?.lens || ''} onChange={event => updateConfig({ camera: { ...config.camera, lens: event.target.value || undefined } })}><option value="">无</option>{CAMERA_OPTIONS.lenses.map(value => <option key={value}>{value}</option>)}</select></div>
        <div className="workflow-config__row"><label>焦距</label><select aria-label="焦距" value={config.camera?.focalLength || ''} onChange={event => updateConfig({ camera: { ...config.camera, focalLength: event.target.value || undefined } })}><option value="">无</option>{CAMERA_OPTIONS.focalLengths.map(value => <option key={value}>{value}</option>)}</select></div>
        <div className="workflow-config__row"><label>光圈</label><select aria-label="光圈" value={config.camera?.aperture || ''} onChange={event => updateConfig({ camera: { ...config.camera, aperture: event.target.value || undefined } })}><option value="">无</option>{CAMERA_OPTIONS.apertures.map(value => <option key={value}>{value}</option>)}</select></div>
      </>}
      {config.mode === 'video' && <div className="workflow-config__row"><label>运镜</label><select aria-label="运镜" value={config.cameraMovement || ''} onChange={event => updateConfig({ cameraMovement: event.target.value || undefined })}><option value="">无</option>{CAMERA_MOVEMENTS.map(movement => <option key={movement.id} value={movement.id}>{movement.name}</option>)}</select></div>}
      {config.mode === 'video' && config.cameraMovement === '' && <div className="workflow-config__row"><label>自定义运镜</label><input aria-label="自定义运镜" value={config.customMovement || ''} placeholder="英文运镜描述" onChange={event => updateConfig({ customMovement: event.target.value || undefined })} /></div>}
      {node.metadata.error && <p className="workflow-config__error">{node.metadata.error}</p>}
      {status === 'loading' && <p role="status">生成中{node.metadata.progress === undefined ? '' : ` · ${Math.round(node.metadata.progress)}%`}</p>}
      {audioUnsupported && <p className="workflow-config__error">音频生成暂未支持</p>}
      <button type="button" onClick={status === 'loading' && onStop ? onStop : onRun} disabled={audioUnsupported || status === 'loading' && !onStop}>
        <Play size={13} />{audioUnsupported ? '暂不支持' : status === 'loading' ? '停止' : status === 'error' ? '重试' : '生成'}
      </button>
    </div>
  );
}
