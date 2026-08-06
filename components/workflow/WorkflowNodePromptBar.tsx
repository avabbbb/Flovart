import { BookOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AssetFolder, AssetLibrary, UserApiKey, GenerationMode, PromptEnhanceMode, PromptEnhanceResult } from '../../types';
import { PromptBar } from '../PromptBar';
import type { MentionData } from '../MediaMentionExtension';
import type { AssetSuggestion } from '../MentionList';
import type { ReferencePickerWorkflowItem } from '../studio/AssetReferencePicker';
import { resolveProductModelRoute } from '../../services/productModelCatalog';
import { getWorkflowOperationCapability, parseWorkflowOperationParameters, type WorkflowOperationCapability } from './operationRegistry';
import {
  applyImageReferenceOrder,
  filterWorkflowInputIds,
  getOrderedImageReferences,
  getWorkflowInputNodes,
  reconcileImageReferenceOrder,
  resolveWorkflowMentionIds,
  toImageReferenceChips,
  toWorkflowMentionItems,
} from './references';
import type { WorkflowConnection, WorkflowGenerationConfig, WorkflowNode, WorkflowNodeMetadata } from './types';

export interface WorkflowModelOptions {
  text: string[];
  image: string[];
  video: string[];
}

function WorkflowOperationParameterPanel({ capability, parameters, onChange }: {
  capability: WorkflowOperationCapability;
  parameters: Record<string, unknown>;
  onChange: (parameters: Record<string, unknown>) => void;
}) {
  if (!capability.parameterControls?.length) return null;
  const update = (key: string, value: unknown) => {
    try {
      onChange(parseWorkflowOperationParameters(capability.id, { ...parameters, [key]: value }));
    } catch {
      // Keep the last valid Recipe while the user is editing a cross-field constraint.
    }
  };
  return <div className="workflow-operation-parameters" role="group" aria-label={`${capability.label}参数`} data-testid="workflow-operation-parameters">
    {capability.parameterControls.map(control => <label key={control.key}>
      <span>{control.label}</span>
      {control.kind === 'select'
        ? <select aria-label={control.label} value={String(parameters[control.key] ?? '')} onChange={event => update(control.key, event.target.value)}>
            {control.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        : <span className="workflow-operation-parameters__number">
            <input
              aria-label={control.label}
              type="number"
              min={control.min}
              max={control.max}
              step={control.step}
              value={Number(parameters[control.key] || 0) * (control.scale || 1)}
              onChange={event => update(control.key, Number(event.target.value) / (control.scale || 1))}
            />
            {control.suffix && <small>{control.suffix}</small>}
          </span>}
    </label>)}
  </div>;
}

const modeFor = (node: WorkflowNode, config?: WorkflowGenerationConfig): GenerationMode => {
  const mode = config?.mode || (node.type === 'text' ? 'text' : node.type === 'video' ? 'video' : 'image');
  return mode === 'text' || mode === 'video' ? mode : 'image';
};

export function WorkflowNodePromptBar({ node, nodes, connections = [], t, theme, language, userApiKeys, dynamicModelOptions, onOpenSettings, onEnhancePrompt, isEnhancingPrompt, onChange, onRun, onStop, focusSignal, onDisconnectReference, assetFolders, assetItems, assetLibrary, onSelectAsset, onSelectWorkflowReference, onAddReferenceFiles, onResolvePastedMentions, onPasteUnresolvedMentions, skillEnabled, width = 880 }: {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  connections?: WorkflowConnection[];
  t: (key: string, ...args: any[]) => string;
  theme: 'light' | 'dark';
  language: 'en' | 'zho';
  userApiKeys: UserApiKey[];
  dynamicModelOptions: WorkflowModelOptions;
  onOpenSettings?: () => void;
  onEnhancePrompt?: (payload: { prompt: string; mode: PromptEnhanceMode; stylePreset?: string }) => Promise<PromptEnhanceResult>;
  isEnhancingPrompt?: boolean;
  onChange: (metadata: Partial<WorkflowNodeMetadata>) => void;
  onRun: () => void;
  onStop?: () => void;
  focusSignal?: number;
    /** 断开当前节点到指定上游节点的连线（由 Workflow 层执行 applyOps delete_connections） */
  onDisconnectReference?: (fromNodeId: string) => void;
  /** 个人素材库根文件夹（扁平数组，parentId=null 表示根级） */
  assetFolders?: AssetFolder[];
  /** 个人素材库条目（轻量索引，不含原图 dataUrl） */
  assetItems?: AssetSuggestion[];
  assetLibrary?: AssetLibrary;
  /** 选择素材时调用，返回新节点 id（或复用已存在节点 id）；未提供则禁用素材选择 */
  onSelectAsset?: (assetId: string) => string | undefined;
    onSelectWorkflowReference?: (nodeId: string) => string | undefined;
  onAddReferenceFiles?: (files: File[]) => void | Promise<void>;
  onResolvePastedMentions?: (mentions: MentionData[]) => Array<MentionData | null>;
  onPasteUnresolvedMentions?: (labels: string[]) => void;
  /** Skill 分区是否可用；本轮默认 false 仅显示占位 */
  skillEnabled?: boolean;
    /** 根据工作流可用宽度收缩，保持底栏单行展示 */
  width?: number;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const operationCapability = node.metadata.operation ? getWorkflowOperationCapability(node.metadata.operation.capabilityId) : undefined;
  const isLocalOperation = operationCapability?.executor === 'local-transform';
  const config = node.metadata.config || { mode: node.type === 'text' ? 'text' : node.type === 'video' ? 'video' : 'image' };
  const generationMode = modeFor(node, config);
  const productMode = operationCapability?.id === 'image.upscale@1'
    ? 'image-to-image'
    : config.submode || (generationMode === 'video' ? 'text-to-video' : 'text-to-image');
  const availableProductModelIds = generationMode === 'video'
    ? dynamicModelOptions?.video || []
    : dynamicModelOptions?.image || [];
  const defaultMappedModelId = generationMode === 'text'
    || operationCapability?.executor === 'local-transform'
    ? undefined
    : availableProductModelIds.find(modelId => Boolean(resolveProductModelRoute(modelId, productMode, userApiKeys)));
  const mentionItems = toWorkflowMentionItems([
    ...getOrderedImageReferences(node, nodes, connections),
    ...getWorkflowInputNodes(node, nodes, connections).filter(item => item.type === 'text'),
  ]);
  const allowedReferenceTypes = operationCapability
    ? new Set(operationCapability.inputRoles.flatMap(input => input.nodeTypes))
    : null;
  const referenceItems: ReferencePickerWorkflowItem[] = nodes.filter(item => item.id !== node.id
    && item.isVisible !== false
    && (item.type === 'image' || item.type === 'video')
    && (!allowedReferenceTypes || allowedReferenceTypes.has(item.type))).map(item => ({
    id: item.id,
    label: item.title,
    elementType: item.type as 'image' | 'video',
    thumbnail: item.metadata.href,
    storageKey: item.metadata.storageKey,
    description: item.metadata.content?.trim().slice(0, 36) || item.type,
  }));
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

  useEffect(() => {
    if (config.modelId || !defaultMappedModelId) return;
    patchConfig({ modelId: defaultMappedModelId });
  // The model is filled once; subsequent user selection remains authoritative.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.modelId, defaultMappedModelId]);
  const keepConnectedMentions = (plainText: string, ids: string[]) => {
    const resolved = filterWorkflowInputIds(resolveWorkflowMentionIds(plainText, ids, mentionItems), node.id, connections);
    const operationInputIds = node.metadata.operation?.recipe.inputBindings.map(binding => binding.sourceNodeId) || [];
    return [...new Set([...operationInputIds, ...resolved])];
  };
  const translatedPrompts = t('quickPrompts');
  const prompts = Array.isArray(translatedPrompts) ? translatedPrompts.filter((item): item is { name: string; value: string } => Boolean(item) && typeof item.name === 'string' && typeof item.value === 'string') : [];
  const providerUsageLabel = [
    node.metadata.generationActualCost !== undefined
      ? `${node.metadata.generationCurrency === 'CNY' ? '¥' : '$'}${node.metadata.generationActualCost.toFixed(node.metadata.generationActualCost < 1 ? 3 : 2)}`
      : undefined,
    node.metadata.generationActualTokens !== undefined ? `${node.metadata.generationActualTokens.toLocaleString()} Token` : undefined,
  ].filter(Boolean).join(' · ') || undefined;

  return (
    <div data-workflow-overlay data-testid="workflow-node-prompt-bar" data-language={language} className="inline-prompt-bar workflow-node-prompt" style={{ width, maxWidth: 'calc(100vw - 16px)' }} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      {operationCapability && <WorkflowOperationParameterPanel
        capability={operationCapability}
        parameters={node.metadata.operation?.recipe.parameters || {}}
        onChange={operationParameters => patchConfig({ operationParameters })}
      />}
      {prompts.length > 0 && <button type="button" className="workflow-node-prompt__library-button" aria-label="提示词库" title="提示词库" onClick={() => setLibraryOpen(open => !open)}><BookOpen size={15} /></button>}
      {libraryOpen && <div className="workflow-node-prompt__library" role="menu" aria-label="提示词库">{prompts.map((item, index) => <button type="button" role="menuitem" key={`${item.name}-${index}`} onClick={() => { onChange({ prompt: item.value, richTextDocument: undefined }); setLibraryOpen(false); }}><strong>{item.name}</strong><span>{item.value}</span></button>)}</div>}
      <PromptBar
        t={t}
        theme={theme}
        language={language}
        compactMode
        prompt={node.metadata.prompt || ''}
        promptDocument={node.metadata.richTextDocument}
        setPrompt={prompt => onChange({ prompt, richTextDocument: undefined, mentionedNodeIds: keepConnectedMentions(prompt, []) })}
        onPromptInputChange={({ plainText, document, mentionedElementIds }) => {
          const mentionedNodeIds = keepConnectedMentions(plainText, mentionedElementIds);
          const currentMentionIds = node.metadata.mentionedNodeIds || [];
          const sameMentions = mentionedNodeIds.length === currentMentionIds.length
            && mentionedNodeIds.every((id, index) => id === currentMentionIds[index]);
          const sameDocument = !node.metadata.richTextDocument
            || JSON.stringify(document) === JSON.stringify(node.metadata.richTextDocument);
          if (plainText === (node.metadata.prompt || '') && sameMentions && sameDocument) return;
          onChange({ prompt: plainText, richTextDocument: document as typeof node.metadata.richTextDocument, mentionedNodeIds });
        }}
        onResolvePastedMentions={onResolvePastedMentions}
        onPasteUnresolvedMentions={onPasteUnresolvedMentions}
        mentionItems={mentionItems}
        referenceItems={referenceItems}
        imageReferenceChips={referenceChips}
        onImageReferenceReorder={handleReorder}
        onImageReferenceRemove={onDisconnectReference ? handleRemoveReference : undefined}
        onGenerate={onRun}
        onStop={onStop}
        onRetry={node.metadata.status === 'error' ? onRun : undefined}
        error={node.metadata.error || null}
        progressStage={node.metadata.generationMessage || (node.metadata.progress === undefined ? undefined : `${Math.round(node.metadata.progress)}%`)}
        providerUsageLabel={providerUsageLabel}
        runWithoutPrompt={Boolean(operationCapability && !operationCapability.promptRequired)}
        providerOptional={isLocalOperation}
        hideGenerationOptions={isLocalOperation}
        runLabel={operationCapability ? '运行' : undefined}
        isLoading={node.metadata.status === 'loading'}
        isSelectionActive={false}
        selectedElementCount={1}
        userEffects={[]}
        onAddUserEffect={() => undefined}
        onDeleteUserEffect={() => undefined}
        generationMode={generationMode}
        setGenerationMode={mode => patchConfig({ mode: mode === 'text' ? 'text' : mode === 'video' ? 'video' : 'image', modelId: undefined })}
        modeOptions={operationCapability
          ? [operationCapability.mediaType === 'video' ? 'video' : 'image']
          : node.type === 'video' ? ['video'] : node.type === 'text' ? ['text'] : ['image']}
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
        preserveReferenceAspectRatio={config.preserveReferenceAspectRatio === true}
        onPreserveReferenceAspectRatioChange={enabled => patchConfig({ preserveReferenceAspectRatio: enabled })}
        selectedTextModel={undefined}
        selectedImageModel={generationMode === 'image' ? config.modelId : undefined}
        selectedVideoModel={generationMode === 'video' ? config.modelId : undefined}
        textModelOptions={[]}
        imageModelOptions={dynamicModelOptions.image}
        videoModelOptions={dynamicModelOptions.video}
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
        popoverDirection="auto"
        assetFolders={assetFolders}
        assetItems={assetItems}
        assetLibrary={assetLibrary}
            onSelectWorkflowReference={onSelectWorkflowReference}
        onAddReferenceFiles={onAddReferenceFiles}
        onSelectAsset={onSelectAsset}
        skillEnabled={skillEnabled}
      />
    </div>
  );
}
