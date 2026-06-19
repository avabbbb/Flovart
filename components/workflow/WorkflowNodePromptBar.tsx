import type { ModelPreference, UserApiKey, GenerationMode } from '../../types';
import { PromptBar, type MentionItem } from '../PromptBar';
import type { WorkflowGenerationConfig, WorkflowNode, WorkflowNodeMetadata } from './types';

export interface WorkflowModelOptions {
  text: string[];
  image: string[];
  video: string[];
}

const modeFor = (node: WorkflowNode, config?: WorkflowGenerationConfig): GenerationMode => {
  const mode = config?.mode || (node.type === 'text' ? 'text' : node.type === 'video' ? 'video' : 'image');
  return mode === 'text' || mode === 'video' ? mode : 'image';
};

export function WorkflowNodePromptBar({ node, nodes, t, theme, language, userApiKeys, modelPreference, dynamicModelOptions, onOpenSettings, onChange, onRun, onStop, focusSignal }: {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  t: (key: string, ...args: any[]) => string;
  theme: 'light' | 'dark';
  language: 'en' | 'zho';
  userApiKeys: UserApiKey[];
  modelPreference: ModelPreference;
  dynamicModelOptions: WorkflowModelOptions;
  onOpenSettings?: () => void;
  onChange: (metadata: WorkflowNodeMetadata) => void;
  onRun: () => void;
  onStop?: () => void;
  focusSignal?: number;
}) {
  const config = node.metadata.config || { mode: node.type === 'text' ? 'text' : node.type === 'video' ? 'video' : 'image' };
  const generationMode = modeFor(node, config);
  const mentionItems: MentionItem[] = nodes.filter(item => item.id !== node.id).map(item => ({
    id: item.id,
    label: item.title,
    thumbnail: item.metadata.href || '',
    elementType: item.type,
    description: item.metadata.content?.trim().slice(0, 36) || item.type,
  }));
  const patchConfig = (patch: Partial<WorkflowGenerationConfig>) => onChange({ config: { ...config, ...patch } });

  return (
    <div data-workflow-overlay data-testid="workflow-node-prompt-bar" data-language={language} className="inline-prompt-bar" style={{ width: 720 }} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      <PromptBar
        t={t}
        theme={theme}
        compactMode
        prompt={node.metadata.prompt || ''}
        promptDocument={node.metadata.richTextDocument}
        setPrompt={prompt => onChange({ prompt, richTextDocument: undefined, mentionedNodeIds: [] })}
        onPromptInputChange={({ plainText, document, mentionedElementIds }) => onChange({ prompt: plainText, richTextDocument: document as typeof node.metadata.richTextDocument, mentionedNodeIds: mentionedElementIds })}
        mentionItems={mentionItems}
        onGenerate={onRun}
        onStop={onStop}
        onRetry={node.metadata.status === 'error' ? onRun : undefined}
        error={node.metadata.error || null}
        progressStage={node.metadata.progress === undefined ? undefined : `${Math.round(node.metadata.progress)}%`}
        isLoading={node.metadata.status === 'loading'}
        isSelectionActive={false}
        selectedElementCount={1}
        userEffects={[]}
        onAddUserEffect={() => undefined}
        onDeleteUserEffect={() => undefined}
        generationMode={generationMode}
        setGenerationMode={mode => patchConfig({ mode: mode === 'text' ? 'text' : mode === 'video' ? 'video' : 'image', modelId: undefined })}
        modeOptions={['text', 'image', 'video']}
        videoAspectRatio={(config.aspectRatio as any) || '16:9'}
        setVideoAspectRatio={aspectRatio => patchConfig({ aspectRatio })}
        videoDurationSec={config.durationSec}
        onVideoDurationSecChange={durationSec => patchConfig({ durationSec })}
        videoResolution={config.resolution}
        onVideoResolutionChange={resolution => patchConfig({ resolution })}
        videoGenerateAudio={config.generateAudio}
        onVideoGenerateAudioChange={generateAudio => patchConfig({ generateAudio })}
        videoWatermark={config.watermark}
        onVideoWatermarkChange={watermark => patchConfig({ watermark })}
        selectedTextModel={generationMode === 'text' ? (config.modelId || modelPreference.textModel) : undefined}
        selectedImageModel={generationMode === 'image' ? (config.modelId || modelPreference.imageModel) : undefined}
        selectedVideoModel={generationMode === 'video' ? (config.modelId || modelPreference.videoModel) : undefined}
        textModelOptions={dynamicModelOptions.text}
        imageModelOptions={dynamicModelOptions.image}
        videoModelOptions={dynamicModelOptions.video}
        onTextModelChange={modelId => patchConfig({ modelId })}
        onImageModelChange={modelId => patchConfig({ modelId })}
        onVideoModelChange={modelId => patchConfig({ modelId })}
        apiConfigs={userApiKeys}
        userApiKeys={userApiKeys}
        onOpenSettings={onOpenSettings}
        batchCount={config.count || 1}
        onBatchCountChange={count => patchConfig({ count })}
        allowVideoBatch
        focusSignal={focusSignal}
        variant="inline"
        shellClassName="inline-prompt-bar-shell"
        popoverDirection="down"
      />
    </div>
  );
}
