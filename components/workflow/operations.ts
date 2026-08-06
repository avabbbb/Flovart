import { canonicalize } from 'json-canonicalize';
import { createWorkflowNode } from './constants';
import {
  getWorkflowOperationCapability,
  parseWorkflowOperationParameters,
  validateWorkflowOperationInputBindings,
} from './operationRegistry';
import type {
  WorkflowConnection,
  WorkflowExecutionPromptSnapshot,
  WorkflowNode,
  WorkflowOperationCapabilityId,
  WorkflowOperationInputBinding,
  WorkflowOperationInputRole,
  WorkflowOperationRecipe,
  WorkflowOperationTake,
  WorkflowPoint,
  WorkflowProject,
  WorkflowNodeMetadata,
  WorkflowRichPromptDocument,
} from './types';

const textEncoder = new TextEncoder();

export interface WorkflowOperationRecipeInput {
  capabilityId: WorkflowOperationCapabilityId;
  prompt?: string;
  richTextDocument?: WorkflowRichPromptDocument;
  parameters?: Record<string, unknown>;
  productModelId?: string;
  inputBindings?: WorkflowOperationInputBinding[];
  now?: string;
}

export interface WorkflowOperationTakeInput {
  id: string;
  snapshotId: string;
  renderedPrompt?: string;
  routeId?: string;
  now?: string;
}

function recipeHashSource(recipe: Pick<WorkflowOperationRecipe, 'capabilityId' | 'version' | 'promptDocument' | 'parameters' | 'productModelId' | 'inputBindings'>) {
  return canonicalize({
    capabilityId: recipe.capabilityId,
    version: recipe.version,
    promptDocument: recipe.promptDocument,
    parameters: recipe.parameters,
    productModelId: recipe.productModelId,
    inputBindings: [...recipe.inputBindings]
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map(({ id, sourceNodeId, role, order }) => ({ id, sourceNodeId, role, order })),
  });
}

export async function hashWorkflowOperationRecipe(recipe: Pick<WorkflowOperationRecipe, 'capabilityId' | 'version' | 'promptDocument' | 'parameters' | 'productModelId' | 'inputBindings'>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(recipeHashSource(recipe)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createWorkflowOperationInputBinding(
  id: string,
  sourceNodeId: string,
  role: WorkflowOperationInputRole,
  order: number,
): WorkflowOperationInputBinding {
  return { id, sourceNodeId, role, order, objectVersion: 1 };
}

export async function createWorkflowOperationRecipe(input: WorkflowOperationRecipeInput): Promise<WorkflowOperationRecipe> {
  const now = input.now || new Date().toISOString();
  const inputBindings = [...(input.inputBindings || [])].sort((left, right) => left.order - right.order);
  validateWorkflowOperationInputBindings(input.capabilityId, inputBindings);
  const recipe: WorkflowOperationRecipe = {
    capabilityId: input.capabilityId,
    version: 1,
    promptDocument: { text: input.prompt || '', richTextDocument: input.richTextDocument },
    parameters: parseWorkflowOperationParameters(input.capabilityId, input.parameters || {}),
    productModelId: input.productModelId,
    inputBindings,
    recipeHash: null,
    objectVersion: 1,
    updatedAt: now,
  };
  recipe.recipeHash = await hashWorkflowOperationRecipe(recipe);
  return recipe;
}

export async function createWorkflowOperationNode(input: WorkflowOperationRecipeInput & { id: string; position: WorkflowPoint }): Promise<WorkflowNode> {
  const recipe = await createWorkflowOperationRecipe(input);
  const capability = getWorkflowOperationCapability(input.capabilityId);
  const node = createWorkflowNode(input.id, 'operation', input.position, {
    prompt: recipe.promptDocument.text,
    richTextDocument: recipe.promptDocument.richTextDocument,
    mentionedNodeIds: recipe.inputBindings.map(binding => binding.sourceNodeId),
    imageReferenceOrder: recipe.inputBindings.filter(binding => binding.role !== 'prompt_context').map(binding => binding.sourceNodeId),
    config: { mode: 'image', modelId: recipe.productModelId, ...recipe.parameters },
    status: 'idle',
    operation: { capabilityId: input.capabilityId, recipe, takes: [] },
  });
  node.title = capability.label;
  node.objectVersion = 1;
  return node;
}

export function updateWorkflowOperationRecipe(
  node: WorkflowNode,
  patch: {
    prompt?: string;
    richTextDocument?: WorkflowRichPromptDocument;
    parameters?: Record<string, unknown>;
    productModelId?: string;
    inputBindings?: WorkflowOperationInputBinding[];
    now?: string;
  },
): WorkflowNode {
  const operation = node.metadata.operation;
  if (!operation) return node;
  const recipe = operation.recipe;
  const promptDocument = patch.prompt === undefined && patch.richTextDocument === undefined
    ? recipe.promptDocument
    : { text: patch.prompt ?? recipe.promptDocument.text, richTextDocument: patch.richTextDocument ?? recipe.promptDocument.richTextDocument };
  const parameters = patch.parameters ? parseWorkflowOperationParameters(operation.capabilityId, patch.parameters) : recipe.parameters;
  const inputBindings = patch.inputBindings ? [...patch.inputBindings].sort((left, right) => left.order - right.order) : recipe.inputBindings;
  validateWorkflowOperationInputBindings(operation.capabilityId, inputBindings);
  const nextRecipe: WorkflowOperationRecipe = {
    ...recipe,
    promptDocument,
    parameters,
    productModelId: patch.productModelId ?? recipe.productModelId,
    inputBindings,
    recipeHash: null,
    objectVersion: recipe.objectVersion + 1,
    updatedAt: patch.now || new Date().toISOString(),
  };
  return {
    ...node,
    objectVersion: (node.objectVersion || 0) + 1,
    metadata: {
      ...node.metadata,
      prompt: nextRecipe.promptDocument.text,
      richTextDocument: nextRecipe.promptDocument.richTextDocument,
      mentionedNodeIds: inputBindings.map(binding => binding.sourceNodeId),
      imageReferenceOrder: inputBindings.filter(binding => binding.role !== 'prompt_context').map(binding => binding.sourceNodeId),
      config: { ...node.metadata.config, ...parameters, mode: 'image', modelId: nextRecipe.productModelId },
      operation: { ...operation, recipe: nextRecipe },
    },
  };
}

export async function beginWorkflowOperationTake(node: WorkflowNode, input: WorkflowOperationTakeInput): Promise<{ node: WorkflowNode; take: WorkflowOperationTake }> {
  const operation = node.metadata.operation;
  if (!operation) throw new Error('节点不是 Workflow Operation');
  validateWorkflowOperationInputBindings(operation.capabilityId, operation.recipe.inputBindings, { requireMinimum: true });
  const recipeHash = await hashWorkflowOperationRecipe(operation.recipe);
  const recipe = { ...operation.recipe, recipeHash };
  const now = input.now || new Date().toISOString();
  const snapshot: WorkflowExecutionPromptSnapshot = {
    id: input.snapshotId,
    createdAt: now,
    compilerVersion: 'workflow-image-operation@1',
    renderedPrompt: input.renderedPrompt ?? recipe.promptDocument.text,
    richTextDocument: recipe.promptDocument.richTextDocument,
    parameters: structuredClone(recipe.parameters),
    productModelId: recipe.productModelId,
    inputBindings: recipe.inputBindings.map(binding => ({ ...binding })),
    recipeHash,
    routeId: input.routeId,
  };
  const take: WorkflowOperationTake = { id: input.id, status: 'running', recipeHash, createdAt: now, snapshot, outputNodeIds: [] };
  return {
    take,
    node: {
      ...node,
      metadata: {
        ...node.metadata,
        status: 'loading',
        error: undefined,
        operation: { ...operation, recipe, takes: [...operation.takes, take] },
      },
    },
  };
}

export function completeWorkflowOperationTake(
  node: WorkflowNode,
  takeId: string,
  outputNodeIds: string[],
  options: { error?: string; canceled?: boolean; providerTaskId?: string; usageRecordId?: string; now?: string } = {},
): WorkflowNode {
  const operation = node.metadata.operation;
  if (!operation) return node;
  const take = operation.takes.find(item => item.id === takeId);
  if (!take) return node;
  const outdated = !options.error && !options.canceled && operation.recipe.recipeHash !== take.recipeHash;
  const status = options.canceled ? 'canceled' : options.error ? 'error' : outdated ? 'outdated_recipe' : 'success';
  const completed = operation.takes.map(item => item.id === takeId ? {
    ...item,
    status,
    completedAt: options.now || new Date().toISOString(),
    outputNodeIds,
    providerTaskId: options.providerTaskId,
    usageRecordId: options.usageRecordId,
    error: options.error,
  } as WorkflowOperationTake : item);
  return {
    ...node,
    metadata: {
      ...node.metadata,
      status: options.error && !options.canceled ? 'error' : status === 'success' ? 'success' : 'idle',
      error: options.canceled ? undefined : options.error,
      operation: {
        ...operation,
        takes: completed,
        selectedTakeId: status === 'success' ? takeId : operation.selectedTakeId,
      },
    },
  };
}

export function workflowOperationInputConnections(node: WorkflowNode): WorkflowConnection[] {
  return (node.metadata.operation?.recipe.inputBindings || []).map(binding => ({
    id: binding.id,
    fromNodeId: binding.sourceNodeId,
    toNodeId: node.id,
    kind: 'operation-input',
    role: binding.role,
    order: binding.order,
  }));
}

function generationParameters(node: WorkflowNode): Record<string, unknown> {
  const config = node.metadata.config || { mode: 'image' as const };
  return {
    submode: config.submode === 'image-to-image' ? 'image-to-image' : 'text-to-image',
    aspectRatio: config.aspectRatio,
    preserveReferenceAspectRatio: config.preserveReferenceAspectRatio,
    resolution: config.resolution,
    quality: config.quality,
    count: config.count || 1,
    enhancePrompt: config.enhancePrompt,
    webSearch: config.webSearch,
    realPersonCheck: config.realPersonCheck,
  };
}

export function updateWorkflowOperationFromMetadata(
  node: WorkflowNode,
  patch: Partial<WorkflowNodeMetadata>,
  now?: string,
): WorkflowNode {
  const operation = node.metadata.operation;
  if (!operation) return { ...node, metadata: { ...node.metadata, ...patch, config: patch.config ? { ...node.metadata.config, ...patch.config } : node.metadata.config } };
  const config = patch.config ? { ...node.metadata.config, ...patch.config } : node.metadata.config;
  const inputBindings = patch.mentionedNodeIds === undefined && patch.imageReferenceOrder === undefined
    ? operation.recipe.inputBindings
    : (() => {
        const mentioned = patch.mentionedNodeIds ?? node.metadata.mentionedNodeIds ?? operation.recipe.inputBindings.map(binding => binding.sourceNodeId);
        const mentionedIds = new Set(mentioned);
        const mediaOrder = patch.imageReferenceOrder ?? node.metadata.imageReferenceOrder ?? operation.recipe.inputBindings
          .filter(binding => binding.role !== 'prompt_context')
          .map(binding => binding.sourceNodeId);
        const existing = new Map(operation.recipe.inputBindings.map(binding => [binding.sourceNodeId, binding]));
        const contexts = operation.recipe.inputBindings.filter(binding => binding.role === 'prompt_context'
          && (patch.mentionedNodeIds === undefined || mentionedIds.has(binding.sourceNodeId)));
        const orderedMediaIds = [...new Set([
          ...mediaOrder.filter(id => mentionedIds.has(id)),
          ...mentioned.filter(id => existing.get(id)?.role !== 'prompt_context'),
        ])];
        return [
          ...contexts,
          ...orderedMediaIds.map(sourceNodeId => existing.get(sourceNodeId)).filter((binding): binding is WorkflowOperationInputBinding => Boolean(binding)),
        ].map((binding, index) => ({ ...binding, order: index }));
      })();
  const parameters = operation.capabilityId === 'image.generate@1'
    ? compactRecord(generationParameters({ ...node, metadata: { ...node.metadata, config } }))
    : operation.recipe.parameters;
  const updated = updateWorkflowOperationRecipe(node, {
    prompt: patch.prompt,
    richTextDocument: patch.richTextDocument,
    parameters,
    productModelId: getWorkflowOperationCapability(operation.capabilityId).executor === 'local-transform'
      ? operation.recipe.productModelId
      : config?.modelId,
    inputBindings,
    now,
  });
  return {
    ...updated,
    metadata: {
      ...updated.metadata,
      ...patch,
      prompt: updated.metadata.operation?.recipe.promptDocument.text,
      richTextDocument: updated.metadata.operation?.recipe.promptDocument.richTextDocument,
      mentionedNodeIds: updated.metadata.operation?.recipe.inputBindings.map(binding => binding.sourceNodeId),
      imageReferenceOrder: updated.metadata.operation?.recipe.inputBindings.filter(binding => binding.role !== 'prompt_context').map(binding => binding.sourceNodeId),
      config: { ...updated.metadata.config, ...config },
      operation: updated.metadata.operation,
    },
  };
}

function compactRecord(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function hasMedia(node: WorkflowNode) {
  return Boolean(node.metadata.storageKey || node.metadata.href || node.metadata.artifactRef?.taskId);
}

export async function ensureWorkflowImageGenerateOperation(input: {
  project: WorkflowProject;
  nodeId: string;
  createId: () => string;
  now?: string;
}): Promise<{ project: WorkflowProject; operationNodeId: string; created: boolean }> {
  const source = input.project.nodes.find(node => node.id === input.nodeId);
  if (!source) throw new Error('图片生成节点不存在');
  if (source.type === 'operation') {
    if (source.metadata.operation?.capabilityId !== 'image.generate@1') throw new Error('该 Operation 不是图片生成步骤');
    return { project: input.project, operationNodeId: source.id, created: false };
  }
  const mode = source.metadata.config?.mode || (source.type === 'config' || source.type === 'image' ? 'image' : source.type);
  if (mode !== 'image') return { project: input.project, operationNodeId: source.id, created: false };

  const now = input.now || new Date().toISOString();
  const sourceHasMedia = source.type === 'image' && hasMedia(source);
  const operationId = sourceHasMedia ? input.createId() : source.id;
  const upstream = input.project.connections
    .filter(connection => connection.toNodeId === source.id)
    .map(connection => input.project.nodes.find(node => node.id === connection.fromNodeId))
    .filter((node): node is WorkflowNode => Boolean(node));
  const order = source.metadata.imageReferenceOrder || upstream.map(node => node.id);
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const candidates = sourceHasMedia ? [source] : upstream;
  const bindings = candidates
    .filter(node => node.type === 'image' || node.type === 'text')
    .sort((left, right) => (orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER))
    .map((node, index) => createWorkflowOperationInputBinding(
      input.createId(),
      node.id,
      node.type === 'text' ? 'prompt_context' : 'reference_image',
      index,
    ));
  const hasImageInput = bindings.some(binding => binding.role === 'reference_image');
  const operation = await createWorkflowOperationNode({
    id: operationId,
    capabilityId: 'image.generate@1',
    position: sourceHasMedia ? { x: source.position.x + source.width + 80, y: source.position.y } : source.position,
    prompt: source.metadata.prompt || '',
    richTextDocument: source.metadata.richTextDocument,
    parameters: compactRecord({ ...generationParameters(source), submode: sourceHasMedia || hasImageInput ? 'image-to-image' : generationParameters(source).submode }),
    productModelId: source.metadata.config?.modelId,
    inputBindings: bindings,
    now,
  });
  operation.metadata = {
    ...operation.metadata,
    config: { ...source.metadata.config, ...operation.metadata.config },
  };
  operation.objectVersion = (source.objectVersion || 0) + 1;

  const replacedNodes = sourceHasMedia
    ? [...input.project.nodes, operation]
    : input.project.nodes.map(node => node.id === source.id ? operation : node);
  const removedIncomingIds = new Set(sourceHasMedia ? [] : input.project.connections.filter(connection => connection.toNodeId === source.id).map(connection => connection.id));
  const connections = [
    ...input.project.connections.filter(connection => !removedIncomingIds.has(connection.id)),
    ...workflowOperationInputConnections(operation),
  ];
  return {
    operationNodeId: operation.id,
    created: true,
    project: {
      ...input.project,
      nodes: replacedNodes,
      connections,
      selectedNodeIds: [operation.id],
      draftVersion: (input.project.draftVersion || 1) + 1,
      updatedAt: now,
    },
  };
}
