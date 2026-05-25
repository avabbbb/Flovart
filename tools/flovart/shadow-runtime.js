import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

const SHADOW_STATE_FILE = process.env.FLOVART_SHADOW_STATE_FILE
  || join(process.env.LOCALAPPDATA || process.cwd(), 'Flovart', 'shadow-runtime-state.json');

function ensureParentDir(filePath) {
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}

function createEmptyState() {
  return {
    version: 1,
    updatedAt: Date.now(),
    selectedElementIds: [],
    zoom: 1,
    panOffset: { x: 0, y: 0 },
    elements: [],
    jobs: [],
    provider: {
      configured: { image: false, video: false, text: false },
      selectedModels: {
        image: 'flux-schnell',
        video: 'kling-v2',
        text: 'gpt-4.1-mini',
      },
      availableModels: { image: [], video: [], text: [] },
      providers: [],
    },
    workflow: {
      nodes: [
        { id: 'image_1', kind: 'imageGen', x: 240, y: 180, config: { label: 'Image' } },
        { id: 'video_1', kind: 'videoGen', x: 680, y: 180, config: { label: 'Video' } },
      ],
      edges: [
        { id: 'edge_1', fromNode: 'image_1', fromPort: 'image', toNode: 'video_1', toPort: 'image' },
      ],
      groups: [],
      viewport: { x: -120, y: -80, scale: 0.86 },
      selectedNodeIds: [],
      runs: [],
    },
  };
}

function loadState() {
  try {
    if (!existsSync(SHADOW_STATE_FILE)) return createEmptyState();
    const parsed = JSON.parse(readFileSync(SHADOW_STATE_FILE, 'utf8'));
    return {
    ...createEmptyState(),
    ...parsed,
    provider: {
      ...createEmptyState().provider,
      ...(parsed.provider || {}),
    },
    workflow: {
      ...createEmptyState().workflow,
      ...(parsed.workflow || {}),
    },
  };
  } catch {
    return createEmptyState();
  }
}

function saveState(state) {
  ensureParentDir(SHADOW_STATE_FILE);
  state.updatedAt = Date.now();
  writeFileSync(SHADOW_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function inferTargetType(type) {
  if (type === 'image' || type === 'video') return type;
  return 'text';
}

function compilePromptReferences(rawText, elements) {
  const tokenRegex = /@([a-zA-Z0-9_\u4e00-\u9fa5-]+)/g;
  const resolvedReferences = [];

  for (const match of rawText.matchAll(tokenRegex)) {
    const token = match[0];
    const targetName = match[1];
    const target = elements.find((element) => element.name?.trim() === targetName.trim());
    if (!target) continue;
    if (resolvedReferences.some((item) => item.targetElementId === target.id)) continue;
    resolvedReferences.push({
      token,
      targetElementId: target.id,
      targetType: inferTargetType(target.type),
    });
  }

  return resolvedReferences;
}

function ensureGenerationState(element, state) {
  if (element.generationState) return element.generationState;
  return {
    promptPayload: { rawText: '', resolvedReferences: [] },
    provider: 'openrouter',
    modelId: element.type === 'video' ? state.provider.selectedModels.video : state.provider.selectedModels.image,
    status: 'idle',
  };
}

function createShadowElement(input, state) {
  const width = Number.isFinite(input.width) ? input.width : input.type === 'text' ? 220 : input.type === 'video' ? 240 : 180;
  const height = Number.isFinite(input.height) ? input.height : input.type === 'text' ? 96 : input.type === 'video' ? 140 : 180;
  const next = {
    id: input.id || randomUUID(),
    type: input.type,
    name: input.name,
    x: Number.isFinite(input.x) ? input.x : 0,
    y: Number.isFinite(input.y) ? input.y : 0,
    width,
    height,
    ...(input.type === 'text'
      ? { text: '', fontSize: 24, fontColor: '#F8FAFC' }
      : { href: input.href || '', mimeType: input.mimeType || (input.type === 'video' ? 'video/mp4' : 'image/png') }),
  };

  if (input.type === 'image' || input.type === 'video') {
    next.generationState = ensureGenerationState(next, state);
  }

  state.elements.push(next);
  state.selectedElementIds = [next.id];
  saveState(state);
  return { ok: true, id: next.id, element: next, shadow: true };
}

function updateShadowPrompt(input, state) {
  const element = state.elements.find((item) => item.id === input.elementId);
  if (!element || (element.type !== 'image' && element.type !== 'video')) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: `media element not found (${input.elementId})` } };
  }

  const generationState = ensureGenerationState(element, state);
  element.generationState = {
    ...generationState,
    modelId: input.modelId || generationState.modelId,
    error: undefined,
    promptPayload: {
      rawText: input.textPrompt,
      resolvedReferences: compilePromptReferences(input.textPrompt, state.elements),
    },
  };
  saveState(state);
  return { ok: true, elementId: element.id, generationState: element.generationState, shadow: true };
}

function assignShadowSlot(input, state) {
  const element = state.elements.find((item) => item.id === input.elementId);
  const source = state.elements.find((item) => item.id === input.targetElementId);
  if (!element || (element.type !== 'image' && element.type !== 'video')) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: `target media element not found (${input.elementId})` } };
  }
  if (!source) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: `source element not found (${input.targetElementId})` } };
  }

  const generationState = ensureGenerationState(element, state);
  const token = `@${source.name || source.id}`;
  const rawText = generationState.promptPayload.rawText.includes(token)
    ? generationState.promptPayload.rawText
    : `${generationState.promptPayload.rawText}${generationState.promptPayload.rawText ? '\n' : ''}${token}`;
  const existing = generationState.promptPayload.resolvedReferences.filter((item) => item.targetElementId !== source.id);

  element.generationState = {
    ...generationState,
    promptPayload: {
      rawText,
      resolvedReferences: [
        ...existing,
        {
          token,
          targetElementId: source.id,
          targetType: inferTargetType(source.type),
          slotRole: input.slotRole,
        },
      ],
    },
  };
  saveState(state);
  return { ok: true, elementId: element.id, targetElementId: source.id, slotRole: input.slotRole, shadow: true };
}

function igniteShadowElement(input, state) {
  const element = state.elements.find((item) => item.id === input.elementId);
  if (!element || (element.type !== 'image' && element.type !== 'video')) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: `media element not found (${input.elementId})` } };
  }

  const generationState = ensureGenerationState(element, state);
  element.generationState = {
    ...generationState,
    status: 'queued',
    progress: 8,
    error: undefined,
  };

  const jobId = `shadow_job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  state.jobs.unshift({
    jobId,
    elementId: element.id,
    command: 'element.ignite',
    status: 'queued',
    progress: { pct: 8, stage: 'shadow-queued' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  saveState(state);
  return {
    ok: true,
    id: element.id,
    jobId,
    status: 'queued',
    shadow: true,
    message: 'Runtime UI unavailable. Task stored in shadow runtime and ready to rehydrate later.',
  };
}

function watchShadowElement(input, state) {
  const element = state.elements.find((item) => item.id === input.elementId);
  if (!element || (element.type !== 'image' && element.type !== 'video')) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: `media element not found (${input.elementId})` } };
  }

  const generationState = ensureGenerationState(element, state);
  return {
    ok: generationState.status === 'success',
    shadow: true,
    elementId: element.id,
    status: generationState.status,
    progress: generationState.progress,
    error: generationState.error,
    message: 'Shadow runtime cannot complete provider jobs without the browser UI.',
  };
}

function updateShadowElement(id, updates, state) {
  const index = state.elements.findIndex((item) => item.id === id);
  if (index < 0) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: `element not found (${id})` } };
  }

  const current = state.elements[index];
  const blocked = new Set(['id', 'type']);
  const safeUpdates = Object.fromEntries(
    Object.entries(updates || {}).filter(([key]) => !blocked.has(key)),
  );
  state.elements[index] = { ...current, ...safeUpdates };
  saveState(state);
  return { ok: true, shadow: true, id, element: state.elements[index] };
}

function removeShadowElement(id, state) {
  const before = state.elements.length;
  state.elements = state.elements.filter((item) => item.id !== id && item.parentId !== id);
  state.selectedElementIds = state.selectedElementIds.filter((item) => item !== id);
  saveState(state);
  return { ok: before !== state.elements.length, shadow: true, id, removed: before - state.elements.length };
}

function selectShadowElements(ids, state) {
  const available = new Set(state.elements.map((item) => item.id));
  state.selectedElementIds = (Array.isArray(ids) ? ids : []).filter((id) => available.has(id));
  saveState(state);
  return { ok: true, shadow: true, selectedElementIds: state.selectedElementIds };
}

function inspectShadowCanvas(state) {
  return {
    ok: true,
    shadow: true,
    selectedElementIds: state.selectedElementIds,
    zoom: state.zoom,
    panOffset: state.panOffset,
    elements: state.elements,
    media: state.elements.filter((item) => item.type === 'image' || item.type === 'video'),
    jobs: state.jobs,
  };
}

function runShadowWorkflow(input, state) {
  const scope = input.scope || 'workflow';
  const nodeId = input.nodeId;
  const jobId = `shadow_workflow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const nodes = scope === 'workflow'
    ? state.workflow.nodes
    : state.workflow.nodes.filter((node) => node.id === nodeId || scope === 'from-here');
  state.workflow.runs.unshift({
    jobId,
    scope,
    nodeId,
    status: 'queued',
    nodeCount: nodes.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  state.jobs.unshift({
    jobId,
    command: 'workflow.run',
    status: 'queued',
    progress: { pct: 8, stage: 'shadow-queued' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  saveState(state);
  return {
    ok: true,
    shadow: true,
    accepted: true,
    jobId,
    scope,
    nodeId,
    nodeCount: nodes.length,
    message: 'Runtime UI unavailable. Workflow run stored in shadow runtime and ready to execute in Flovart UI.',
  };
}

function inspectShadowWorkflow(state) {
  return { ok: true, shadow: true, ...state.workflow };
}

function loadShadowWorkflow(input, state) {
  const workflow = input.workflow || input;
  if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges)) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: 'workflow.nodes and workflow.edges are required' } };
  }
  state.workflow = {
    nodes: workflow.nodes,
    edges: workflow.edges,
    groups: Array.isArray(workflow.groups) ? workflow.groups : [],
    viewport: workflow.viewport || { x: -120, y: -80, scale: 0.86 },
    selectedNodeIds: [],
    runs: state.workflow.runs || [],
    name: workflow.name,
  };
  saveState(state);
  return { ok: true, shadow: true, nodeCount: state.workflow.nodes.length, edgeCount: state.workflow.edges.length, workflow: state.workflow };
}

function updateShadowWorkflowNode(nodeId, config, state) {
  const index = state.workflow.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return { ok: false, error: { code: 'BAD_REQUEST', message: `workflow node not found (${nodeId})` } };
  state.workflow.nodes[index] = {
    ...state.workflow.nodes[index],
    config: {
      ...(state.workflow.nodes[index].config || {}),
      ...(config || {}),
    },
  };
  state.workflow.selectedNodeIds = [nodeId];
  saveState(state);
  return { ok: true, shadow: true, node: state.workflow.nodes[index] };
}

function createShadowGeneration(input, type, state) {
  const jobId = `shadow_gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const element = createShadowElement({
    type,
    name: input.name || (type === 'video' ? 'Shadow Video' : 'Shadow Image'),
    x: input.x,
    y: input.y,
    width: type === 'video' ? 960 : 1024,
    height: type === 'video' ? 540 : 1024,
    href: '',
    mimeType: type === 'video' ? 'video/mp4' : 'image/png',
  }, state).element;

  element.generationState = {
    ...ensureGenerationState(element, state),
    status: 'queued',
    progress: 8,
    promptPayload: {
      rawText: input.prompt || '',
      resolvedReferences: [],
    },
  };
  state.jobs.unshift({
    jobId,
    elementId: element.id,
    command: type === 'video' ? 'generate.video' : 'generate.image',
    status: 'queued',
    progress: { pct: 8, stage: 'shadow-queued' },
    prompt: input.prompt || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  saveState(state);
  return {
    ok: true,
    shadow: true,
    accepted: true,
    jobId,
    id: element.id,
    canvasElementId: element.id,
    prompt: input.prompt || '',
    message: 'Runtime UI unavailable. Generation request stored in shadow runtime; open Flovart browser UI to execute provider jobs.',
  };
}

export function createShadowRuntimeFacade() {
  return {
    _version: 'shadow-runtime',
    status: async () => {
      const state = loadState();
      return {
        ok: true,
        runtime: 'flovart-shadow-runtime',
        shadow: true,
        mediaElements: state.elements.filter((item) => item.type === 'image' || item.type === 'video').length,
        jobs: state.jobs.length,
        provider: state.provider,
        workflow: {
          nodes: state.workflow.nodes.length,
          edges: state.workflow.edges.length,
          runs: state.workflow.runs.length,
        },
        stateFile: SHADOW_STATE_FILE,
      };
    },
    provider: {
      status: async () => ({ ok: true, shadow: true, ...loadState().provider }),
      beginSetup: async (input = {}) => ({
        ok: true,
        shadow: true,
        status: 'waiting_for_user',
        provider: input.provider || 'custom',
        purpose: input.purpose || 'both',
        message: 'Shadow runtime cannot collect API keys. Open Flovart UI to complete setup.',
      }),
      selectModel: async (input = {}) => {
        const state = loadState();
        state.provider.selectedModels = {
          image: input.imageModel || state.provider.selectedModels.image,
          video: input.videoModel || state.provider.selectedModels.video,
          text: input.textModel || state.provider.selectedModels.text,
        };
        saveState(state);
        return { ok: true, shadow: true, selectedModels: state.provider.selectedModels };
      },
      test: async (input = {}) => {
        const state = loadState();
        const purpose = input.purpose || 'both';
        const checks = state.provider.configured;
        return {
          ok: purpose === 'both' ? checks.image && checks.video : checks[purpose],
          purpose,
          checks,
          shadow: true,
        };
      },
    },
    canvas: {
      inspect: async () => inspectShadowCanvas(loadState()),
      listMedia: async () => loadState().elements.filter((item) => item.type === 'image' || item.type === 'video'),
      addImage: async (input) => createShadowElement({ ...input, type: 'image' }, loadState()),
      addVideo: async (input) => createShadowElement({ ...input, type: 'video' }, loadState()),
      addElement: async (input) => createShadowElement(input, loadState()),
      getElements: async () => loadState().elements,
      updateElement: async (id, updates) => updateShadowElement(id, updates, loadState()),
      removeElement: async (id) => removeShadowElement(id, loadState()),
      select: async (ids) => selectShadowElements(ids, loadState()),
      clearMedia: async () => {
        const state = loadState();
        state.elements = state.elements.filter((item) => item.type !== 'image' && item.type !== 'video');
        saveState(state);
        return { ok: true, shadow: true };
      },
      clear: async () => {
        const state = createEmptyState();
        saveState(state);
        return { ok: true, shadow: true };
      },
    },
    element: {
      create: async (input) => createShadowElement(input, loadState()),
      updatePrompt: async (input) => updateShadowPrompt(input, loadState()),
      assignSlot: async (input) => assignShadowSlot(input, loadState()),
      ignite: async (input) => igniteShadowElement(input, loadState()),
      watch: async (input) => watchShadowElement(input, loadState()),
    },
    workflow: {
      inspect: async () => inspectShadowWorkflow(loadState()),
      load: async (input) => loadShadowWorkflow(input, loadState()),
      updateNode: async (nodeId, config) => updateShadowWorkflowNode(nodeId, config, loadState()),
      run: async (input = {}) => runShadowWorkflow(input, loadState()),
    },
    assets: {
      list: async () => [],
    },
    generate: {
      image: async (input = {}) => createShadowGeneration(input, 'image', loadState()),
      imagesBatch: async (input = {}) => {
        const items = Array.isArray(input.items) ? input.items : [];
        const results = items.map((item, index) => ({
          clientShotId: item.clientShotId,
          ...createShadowGeneration({ ...item, name: item.clientShotId ? `Shot ${item.clientShotId}` : `Shot ${index + 1}` }, 'image', loadState()),
        }));
        return { ok: true, shadow: true, items: results };
      },
      video: async (input = {}) => createShadowGeneration(input, 'video', loadState()),
      videoStatus: async (input) => loadState().jobs.find((item) => item.jobId === input.jobId) || null,
    },
    export: {
      project: async () => {
        const state = loadState();
        return {
          ok: true,
          shadow: true,
          mediaElements: state.elements.filter((item) => item.type === 'image' || item.type === 'video'),
          assets: [],
        };
      },
    },
  };
}
