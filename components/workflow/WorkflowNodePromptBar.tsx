import { BookOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AssetFolder, AssetLibrary, UserApiKey, GenerationMode, PromptEnhanceMode, PromptEnhanceResult } from '../../types';
import { PromptBar } from '../PromptBar';
import { extractMentions, type MentionData } from '../MediaMentionExtension';
import type { AssetSuggestion } from '../MentionList';
import type { ReferencePickerWorkflowItem } from '../studio/AssetReferencePicker';
import { resolveWorkflowDefaultModel } from '../../services/workflowPromptPolicy';
import { getWorkflowOperationCapability, parseWorkflowOperationParameters, type WorkflowOperationCapability } from './operationRegistry';
import { createPromptIntent, type PromptIntent, type PromptIntentAction } from './promptIntent';
import {
  filterWorkflowInputIds,
  getOrderedImageReferences,
  getWorkflowInputNodes,
  resolveWorkflowMentionIds,
  toImageReferenceChips,
  toWorkflowMentionItems,
} from './references';
import type { WorkflowConnection, WorkflowGenerationConfig, WorkflowNode, WorkflowNodeMetadata } from './types';
import { promptAssetFromQuickPrompt } from '../../services/promptAsset';

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

export function WorkflowNodePromptBar({ node, nodes, connections = [], t, theme, language, userApiKeys, dynamicModelOptions, onOpenSettings, onEnhancePrompt, isEnhancingPrompt, onChange, onPromptIntent, onRun, onStop, focusSignal, onDisconnectReference, onReorderReference, assetFolders, assetItems, assetLibrary, onSelectAsset, onSelectWorkflowReference, onAddReferenceFiles, onResolvePastedMentions, onPasteUnresolvedMentions, skillEnabled, width = 880 }: {
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
  /** PromptBar 的稳定业务输出，不携带 Provider wire 字段或凭据。 */
  onPromptIntent?: (intent: PromptIntent) => void;
  onRun: () => void;
  onStop?: () => void;
  focusSignal?: number;
    /** 断开当前节点到指定上游节点的连线（由 Workflow 层执行 applyOps delete_connections） */
  onDisconnectReference?: (fromNodeId: string) => void;
  /** 拖拽排序 chip 时以新的节点顺序重排连接（由 Workflow 层执行 reorder_connections op） */
  onReorderReference?: (nextIds: string[]) => void;
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
  const availableProductModelIds = generationMode === 'video'
    ? dynamicModelOptions?.video || []
    : dynamicModelOptions?.image || [];
  const defaultMappedModelId = resolveWorkflowDefaultModel({
    mode: generationMode,
    localOperation: operationCapability?.executor === 'local-transform',
    modelIds: availableProductModelIds,
    userApiKeys,
  });
  const mentionItems = toWorkflowMentionItems([
    ...getOrderedImageReferences(node, nodes, connections),
    ...getWorkflowInputNodes(node, nodes, connections).filter(item => item.type === 'text'),
  ]);
  const keepConnectedMentions = (plainText: string, ids: string[]) => {
    const resolved = filterWorkflowInputIds(resolveWorkflowMentionIds(plainText, ids, mentionItems), node.id, connections);
    const operationInputIds = node.metadata.operation?.recipe.inputBindings.map(binding => binding.sourceNodeId) || [];
    return [...new Set([...operationInputIds, ...resolved])];
  };
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
  const documentMentionIds = node.metadata.richTextDocument ? extractMentions(node.metadata.richTextDocument).map(item => item.id) : [];
  const referenceChips = toImageReferenceChips(orderedImageRefs, keepConnectedMentions(node.metadata.prompt || '', documentMentionIds));
  const lastPromptIntentRef = useRef<PromptIntent | null>(null);

  const promptMention = (id: string) => {
    const item = [...mentionItems, ...referenceItems, ...(assetItems || []).map(asset => ({
      id: `asset:${asset.id}`,
      label: asset.name,
      thumbnail: asset.thumbnail,
      elementType: asset.elementType,
      assetId: asset.id,
      sourceType: 'assetLibrary',
    }))].find(candidate => {
      const assetId = 'assetId' in candidate ? candidate.assetId : undefined;
      return candidate.id === id || assetId === id || `asset:${assetId}` === id;
    });
    const assetId = item && 'assetId' in item ? item.assetId : undefined;
    const sourceType = item && 'sourceType' in item ? item.sourceType : undefined;
    return { id, label: item?.label, elementType: item?.elementType, assetId, sourceType };
  };
  const emitPromptIntent = (text: string, ids: string[], requestedAction: PromptIntentAction = 'edit') => {
    const intent = createPromptIntent({ targetNodeId: node.id, text, mentions: ids.map(promptMention), requestedAction });
    lastPromptIntentRef.current = intent;
    onPromptIntent?.(intent);
  };

  const handleReorder = (nextIds: string[]) => {
    emitPromptIntent(node.metadata.prompt || '', nextIds, 'reorder_reference');
    onReorderReference?.(nextIds);
  };

  const handleRemoveReference = (fromNodeId: string) => {
    const remaining = keepConnectedMentions(node.metadata.prompt || '', documentMentionIds).filter(id => id !== fromNodeId);
    emitPromptIntent(node.metadata.prompt || '', remaining, 'remove_reference');
    onDisconnectReference?.(fromNodeId);
  };

  const handlePromptInput = (plainText: string, document: Record<string, unknown>, mentionedElementIds: string[]) => {
    const mentionIds = keepConnectedMentions(plainText, mentionedElementIds);
    emitPromptIntent(plainText, mentionIds);
    onChange({ prompt: plainText, richTextDocument: document as typeof node.metadata.richTextDocument });
  };
  const latestPromptIntent = () => {
    const previous = lastPromptIntentRef.current?.targetNodeId === node.id ? lastPromptIntentRef.current : undefined;
    return {
      text: previous?.text ?? node.metadata.prompt ?? '',
      ids: previous
        ? previous.mentions.map(mention => mention.id || mention.assetId).filter((id): id is string => Boolean(id))
        : keepConnectedMentions(node.metadata.prompt || '', documentMentionIds),
    };
  };
  const handleGenerate = () => {
    const current = latestPromptIntent();
    emitPromptIntent(current.text, current.ids, 'generate');
    onRun();
  };
  const handleStop = onStop ? () => {
    const current = latestPromptIntent();
    emitPromptIntent(current.text, current.ids, 'stop');
    onStop();
  } : undefined;
  const handleSelectAsset = (assetId: string) => {
    const selected = onSelectAsset?.(assetId);
    if (selected) {
      const current = latestPromptIntent();
      emitPromptIntent(current.text, [...current.ids, selected], 'add_reference');
    }
    return selected;
  };
  const handleSelectWorkflowReference = (nodeId: string) => {
    const selected = onSelectWorkflowReference?.(nodeId);
    if (selected) {
      const current = latestPromptIntent();
      emitPromptIntent(current.text, [...current.ids, selected], 'add_reference');
    }
    return selected;
  };
  const handleAddReferenceFiles = async (files: File[]) => {
    const current = latestPromptIntent();
    emitPromptIntent(current.text, current.ids, 'add_reference');
    await onAddReferenceFiles?.(files);
  };

  const patchConfig = (patch: Partial<WorkflowGenerationConfig>) => onChange({ config: { ...config, ...patch } });

  useEffect(() => {
    if (config.modelId || !defaultMappedModelId) return;
    patchConfig({ modelId: defaultMappedModelId });
  // The model is filled once; subsequent user selection remains authoritative.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.modelId, defaultMappedModelId]);
  const translatedPrompts = t('quickPrompts');
  const prompts = Array.isArray(translatedPrompts) ? translatedPrompts.filter((item): item is { name: string; value: string } => Boolean(item) && typeof item.name === 'string' && typeof item.value === 'string') : [];
  const promptAssets = prompts.map((item, index) => promptAssetFromQuickPrompt({ id: `quick:${index}`, title: item.name, text: item.value, modality: generationMode === 'keyframe' ? 'image' : generationMode }));
  const providerUsageLabel = [
    node.metadata.generationActualCost !== undefined
      ? `${node.metadata.generationCurrency === 'CNY' ? '¥' : '$'}${node.metadata.generationActualCost.toFixed(node.metadata.generationActualCost < 1 ? 3 : 2)}`
      : undefined,
    node.metadata.generationActualTokens !== undefined ? `${node.metadata.generationActualTokens.toLocaleString()} Token` : undefined,
  ].filter(Boolean).join(' · ') || undefined;

  return (
    <div data-workflow-overlay data-testid="workflow-node-prompt-bar" data-language={language} className="inline-prompt-bar workflow-node-prompt" style={{ ['--workflow-node-prompt-width' as string]: `${width}px` }} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      {operationCapability && <WorkflowOperationParameterPanel
        capability={operationCapability}
        parameters={node.metadata.operation?.recipe.parameters || {}}
        onChange={operationParameters => patchConfig({ operationParameters })}
      />}
      {prompts.length > 0 && <button type="button" className="workflow-node-prompt__library-button" aria-label="提示词库" title="提示词库" onClick={() => setLibraryOpen(open => !open)}><BookOpen size={15} /></button>}
      {libraryOpen && <div className="workflow-node-prompt__library" role="menu" aria-label="提示词库">{promptAssets.map(asset => <button type="button" role="menuitem" key={asset.id} onClick={() => { emitPromptIntent(asset.text, [], 'edit'); onChange({ prompt: asset.text, richTextDocument: undefined }); setLibraryOpen(false); }}><strong>{asset.title}</strong><span>{asset.text}</span></button>)}</div>}
      <PromptBar
        t={t}
        theme={theme}
        language={language}
        compactMode
        prompt={node.metadata.prompt || ''}
        promptDocument={node.metadata.richTextDocument}
        setPrompt={prompt => handlePromptInput(prompt, { type: 'doc', content: prompt ? [{ type: 'paragraph', content: [{ type: 'text', text: prompt }] }] : [] }, [])}
        onPromptInputChange={({ plainText, document }) => {
          const sameDocument = !node.metadata.richTextDocument
            || JSON.stringify(document) === JSON.stringify(node.metadata.richTextDocument);
          if (plainText === (node.metadata.prompt || '') && sameDocument) return;
          handlePromptInput(plainText, document, extractMentions(document).map(item => item.id));
        }}
        onResolvePastedMentions={onResolvePastedMentions}
        onPasteUnresolvedMentions={onPasteUnresolvedMentions}
        mentionItems={mentionItems}
        referenceItems={referenceItems}
        imageReferenceChips={referenceChips}
        onImageReferenceReorder={handleReorder}
        onImageReferenceRemove={onDisconnectReference ? handleRemoveReference : undefined}
        onGenerate={handleGenerate}
        onStop={handleStop}
        onRetry={node.metadata.status === 'error' ? handleGenerate : undefined}
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
        onSelectWorkflowReference={onSelectWorkflowReference ? handleSelectWorkflowReference : undefined}
        onAddReferenceFiles={onAddReferenceFiles ? handleAddReferenceFiles : undefined}
        onSelectAsset={onSelectAsset ? handleSelectAsset : undefined}
        skillEnabled={skillEnabled}
      />
    </div>
  );
}
