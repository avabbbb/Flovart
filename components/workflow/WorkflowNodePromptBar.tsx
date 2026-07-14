import { BookOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ModelPreference, UserApiKey, GenerationMode, PromptEnhanceMode, PromptEnhanceResult } from '../../types';
import { PromptBar } from '../PromptBar';
import {
  applyImageReferenceOrder,
  filterWorkflowInputIds,
  getOrderedImageReferences,
  getWorkflowInputNodes,
  reconcileImageReferenceOrder,
  toImageReferenceChips,
  toWorkflowMentionItems,
} from './references';
import type { WorkflowConnection, WorkflowGenerationConfig, WorkflowNode, WorkflowNodeMetadata } from './types';

export interface WorkflowModelOptions {
  text: string[];
  image: string[];
  video: string[];
}

const modeFor = (node: WorkflowNode, config?: WorkflowGenerationConfig): GenerationMode => {
  const mode = config?.mode || (node.type === 'text' ? 'text' : node.type === 'video' ? 'video' : 'image');
  return mode === 'text' || mode === 'video' ? mode : 'image';
};

export function WorkflowNodePromptBar({ node, nodes, connections = [], t, theme, language, userApiKeys, modelPreference, dynamicModelOptions, onOpenSettings, onEnhancePrompt, isEnhancingPrompt, onChange, onRun, onStop, focusSignal, onDisconnectReference }: {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  connections?: WorkflowConnection[];
  t: (key: string, ...args: any[]) => string;
  theme: 'light' | 'dark';
  language: 'en' | 'zho';
  userApiKeys: UserApiKey[];
  modelPreference: ModelPreference;
  dynamicModelOptions: WorkflowModelOptions;
  onOpenSettings?: () => void;
  onEnhancePrompt?: (payload: { prompt: string; mode: PromptEnhanceMode; stylePreset?: string }) => Promise<PromptEnhanceResult>;
  isEnhancingPrompt?: boolean;
  onChange: (metadata: WorkflowNodeMetadata) => void;
  onRun: () => void;
  onStop?: () => void;
  focusSignal?: number;
  /** 断开当前节点到指定上游节点的连线（由画布层执行 applyOps delete_connections） */
  onDisconnectReference?: (fromNodeId: string) => void;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const config = node.metadata.config || { mode: node.type === 'text' ? 'text' : node.type === 'video' ? 'video' : 'image' };
  const generationMode = modeFor(node, config);
  const mentionItems = toWorkflowMentionItems(getWorkflowInputNodes(node, nodes, connections));
  const orderedImageRefs = getOrderedImageReferences(node, nodes, connections);
  const referenceChips = toImageReferenceChips(orderedImageRefs, node.metadata.mentionedNodeIds);
  const reconciledOrder = reconcileImageReferenceOrder(node.metadata.imageReferenceOrder, orderedImageRefs);
  const currentOrder = node.metadata.imageReferenceOrder || [];
  const orderDrifted = reconciledOrder.length !== currentOrder.length || reconciledOrder.some((id, i) => id !== currentOrder[i]);

  // 连线增删或顺序失效时，自动同步 imageReferenceOrder 到节点 metadata（新增节点追加在尾部，断开的 id 被剔除）
  useEffect(() => {
    if (!orderDrifted) return;
    onChange({ imageReferenceOrder: reconciledOrder });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderDrifted, reconciledOrder.join('|')]);

  const handleReorder = (nextIds: string[]) => {
    const next = applyImageReferenceOrder(node.metadata.imageReferenceOrder, nextIds, orderedImageRefs);
    if (next) onChange({ imageReferenceOrder: next });
  };

  const handleRemoveReference = (fromNodeId: string) => {
    const remainingOrder = (node.metadata.imageReferenceOrder || orderedImageRefs.map(item => item.id)).filter(id => id !== fromNodeId);
    const remainingMentions = (node.metadata.mentionedNodeIds || []).filter(id => id !== fromNodeId);
    onChange({ imageReferenceOrder: remainingOrder, mentionedNodeIds: remainingMentions });
    onDisconnectReference?.(fromNodeId);
  };

  const patchConfig = (patch: Partial<WorkflowGenerationConfig>) => onChange({ config: { ...config, ...patch } });
  const keepConnectedMentions = (ids: string[]) => filterWorkflowInputIds(ids, node.id, connections);
  const translatedPrompts = t('quickPrompts');
  const prompts = Array.isArray(translatedPrompts) ? translatedPrompts.filter((item): item is { name: string; value: string } => Boolean(item) && typeof item.name === 'string' && typeof item.value === 'string') : [];

  return (
    <div data-workflow-overlay data-testid="workflow-node-prompt-bar" data-language={language} className="inline-prompt-bar workflow-node-prompt" style={{ width: 720 }} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      {prompts.length > 0 && <button type="button" className="workflow-node-prompt__library-button" aria-label="提示词库" title="提示词库" onClick={() => setLibraryOpen(open => !open)}><BookOpen size={15} /></button>}
      {libraryOpen && <div className="workflow-node-prompt__library" role="menu" aria-label="提示词库">{prompts.map((item, index) => <button type="button" role="menuitem" key={`${item.name}-${index}`} onClick={() => { onChange({ prompt: item.value, richTextDocument: undefined, mentionedNodeIds: [] }); setLibraryOpen(false); }}><strong>{item.name}</strong><span>{item.value}</span></button>)}</div>}
      <PromptBar
        t={t}
        theme={theme}
        compactMode
        prompt={node.metadata.prompt || ''}
        promptDocument={node.metadata.richTextDocument}
        setPrompt={prompt => onChange({ prompt, richTextDocument: undefined, mentionedNodeIds: [] })}
        onPromptInputChange={({ plainText, document, mentionedElementIds }) => onChange({ prompt: plainText, richTextDocument: document as typeof node.metadata.richTextDocument, mentionedNodeIds: keepConnectedMentions(mentionedElementIds) })}
        mentionItems={mentionItems}
        imageReferenceChips={referenceChips}
        onImageReferenceReorder={handleReorder}
        onImageReferenceRemove={onDisconnectReference ? handleRemoveReference : undefined}
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
        modeOptions={node.type === 'video' ? ['video'] : node.type === 'text' ? ['text'] : ['image']}
        videoAspectRatio={(config.aspectRatio as any) || '16:9'}
        setVideoAspectRatio={aspectRatio => patchConfig({ aspectRatio })}
        imageAspectRatio={(config.aspectRatio as any) || '1:1'}
        setImageAspectRatio={aspectRatio => patchConfig({ aspectRatio })}
        videoDurationSec={config.durationSec}
        onVideoDurationSecChange={durationSec => patchConfig({ durationSec })}
        videoResolution={config.resolution}
        onVideoResolutionChange={resolution => patchConfig({ resolution })}
        videoGenerateAudio={config.generateAudio}
        onVideoGenerateAudioChange={generateAudio => patchConfig({ generateAudio })}
        videoWatermark={config.watermark}
        onVideoWatermarkChange={watermark => patchConfig({ watermark })}
        generationSubmode={config.submode}
        onGenerationSubmodeChange={submode => patchConfig({ submode })}
        generationQuality={config.quality}
        onGenerationQualityChange={quality => patchConfig({ quality })}
        webSearchEnabled={config.webSearch}
        onWebSearchToggle={webSearch => patchConfig({ webSearch })}
        realPersonCheckEnabled={config.realPersonCheck !== false}
        onRealPersonCheckToggle={realPersonCheck => patchConfig({ realPersonCheck })}
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
        onEnhancePrompt={onEnhancePrompt}
        isEnhancingPrompt={isEnhancingPrompt}
        isAutoEnhanceEnabled={Boolean(config.enhancePrompt)}
        onAutoEnhanceToggle={() => patchConfig({ enhancePrompt: !config.enhancePrompt })}
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
