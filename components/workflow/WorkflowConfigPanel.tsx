import { Play } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import type { GenerationCapability, GenerationMode } from '../../services/generationCapabilities';
import { modelRefModelId } from '../../utils/modelRefs';
import type { WorkflowNode, WorkflowNodeMetadata } from './types';

type CapabilityResolver = (mode: GenerationMode, modelId?: string) => GenerationCapability;

export interface WorkflowSharedMedia {
  id: string;
  name: string;
  href: string;
  mimeType: string;
  type: 'image' | 'video';
}

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

export function WorkflowConfigPanel({ node, onChange, onRun }: {
  node: WorkflowNode;
  onChange: (metadata: WorkflowNodeMetadata) => void;
  onRun: () => void;
}) {
  const resolve = useContext(CapabilityContext);
  const config = node.metadata.config || { mode: 'image' as const };
  const capability = resolve(config.mode, config.modelId);
  const updateConfig = (patch: Partial<typeof config>) => onChange({ config: { ...config, ...patch } });
  const status = node.metadata.status || 'idle';
  const audioUnsupported = config.mode === 'audio';

  return (
    <div className="workflow-config" onPointerDown={event => event.stopPropagation()}>
      <div className="workflow-config__row">
        <label>类型</label>
        <select value={config.mode} onChange={event => {
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
        <select disabled={audioUnsupported} value={config.modelId || ''} onChange={event => updateConfig({ modelId: event.target.value || undefined })}>
          <option value="">跟随全局模型</option>
          {capability.models.map(model => <option key={model} value={model}>{modelRefModelId(model)}</option>)}
        </select>
      </div>
      <textarea
        value={node.metadata.prompt || ''}
        placeholder="输入提示词；上游文本会自动合并"
        onChange={event => onChange({ prompt: event.target.value })}
      />
      {capability.aspectRatios.length > 0 && (
        <div className="workflow-config__row">
          <label>比例</label>
          <select value={config.aspectRatio || capability.aspectRatios[0]} onChange={event => updateConfig({ aspectRatio: event.target.value })}>
            {capability.aspectRatios.map(value => <option key={value}>{value}</option>)}
          </select>
        </div>
      )}
      {capability.resolutions.length > 0 && (
        <div className="workflow-config__row">
          <label>清晰度</label>
          <select value={config.resolution || capability.resolutions[0]} onChange={event => updateConfig({ resolution: event.target.value })}>
            {capability.resolutions.map(value => <option key={value}>{value}</option>)}
          </select>
        </div>
      )}
      {capability.durations.length > 0 && (
        <div className="workflow-config__row">
          <label>时长</label>
          <select value={config.durationSec || capability.durations[0]} onChange={event => updateConfig({ durationSec: Number(event.target.value) })}>
            {capability.durations.map(value => <option key={value} value={value}>{value} 秒</option>)}
          </select>
        </div>
      )}
      {node.metadata.error && <p className="workflow-config__error">{node.metadata.error}</p>}
      {audioUnsupported && <p className="workflow-config__error">音频生成暂未支持</p>}
      <button type="button" onClick={onRun} disabled={audioUnsupported || status === 'loading'}>
        <Play size={13} />{audioUnsupported ? '暂不支持' : status === 'loading' ? '生成中...' : '生成'}
      </button>
    </div>
  );
}
