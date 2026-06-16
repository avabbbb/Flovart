import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

export const SHADOW_STATE_FILE = process.env.FLOVART_SHADOW_STATE_FILE
  || join(process.env.LOCALAPPDATA || process.cwd(), 'Flovart', 'shadow-runtime-state.json');

export const FLOVART_CONTEXT_FILE = process.env.FLOVART_CONTEXT_FILE
  || join(process.cwd(), '.flovart', 'project.json');

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
    projects: [],
    groups: [],
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
  };
}

export function loadShadowState() {
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
  };
  } catch {
    return createEmptyState();
  }
}

export function saveShadowState(state) {
  ensureParentDir(SHADOW_STATE_FILE);
  state.updatedAt = Date.now();
  writeFileSync(SHADOW_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function readContext() {
  try {
    if (!existsSync(FLOVART_CONTEXT_FILE)) return {};
    return JSON.parse(readFileSync(FLOVART_CONTEXT_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeContext(patch = {}) {
  const current = readContext();
  const next = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  if (patch.projectUuid === null) delete next.projectUuid;
  if (patch.groupNodeKey === null) delete next.groupNodeKey;
  ensureParentDir(FLOVART_CONTEXT_FILE);
  writeFileSync(FLOVART_CONTEXT_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function activeContext() {
  return readContext();
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
  const context = activeContext();
  const width = Number.isFinite(input.width) ? input.width : input.type === 'text' ? 220 : input.type === 'video' ? 240 : 180;
  const height = Number.isFinite(input.height) ? input.height : input.type === 'text' ? 96 : input.type === 'video' ? 140 : 180;
  const next = {
    id: input.id || randomUUID(),
    type: input.type,
    name: input.name,
    projectUuid: input.projectUuid || context.projectUuid,
    groupNodeKey: input.groupNodeKey || context.groupNodeKey,
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
  saveShadowState(state);
  return { ok: true, id: next.id, element: next, shadow: true };
}

function summarizeProject(project, state) {
  const context = activeContext();
  const projectUuid = project?.projectUuid || context.projectUuid;
  const groups = state.groups.filter((group) => !projectUuid || group.projectUuid === projectUuid);
  const elements = state.elements.filter((element) => !projectUuid || element.projectUuid === projectUuid);
  return {
    ok: true,
    shadow: true,
    project: project || state.projects.find((item) => item.projectUuid === projectUuid) || null,
    context,
    groupCount: groups.length,
    elementCount: elements.length,
    mediaCount: elements.filter((item) => item.type === 'image' || item.type === 'video').length,
  };
}

function createShadowProject(input = {}, state) {
  const projectUuid = input.projectUuid || input.uuid || randomUUID();
  const now = Date.now();
  const project = {
    projectUuid,
    name: input.name || `Flovart Project ${state.projects.length + 1}`,
    description: input.description || '',
    createdAt: now,
    updatedAt: now,
  };
  state.projects = state.projects.filter((item) => item.projectUuid !== projectUuid);
  state.projects.push(project);
  saveShadowState(state);
  const shouldUse = input.use !== false && input.use !== 'false';
  const context = shouldUse ? writeContext({ projectUuid, groupNodeKey: null }) : activeContext();
  return { ok: true, shadow: true, project, context };
}

function listShadowProjects(state) {
  return { ok: true, shadow: true, projects: state.projects, context: activeContext() };
}

function useShadowProject(input = {}, state) {
  const projectUuid = input.projectUuid || input.uuid || input.id;
  if (!projectUuid) return { ok: false, error: { code: 'BAD_REQUEST', message: 'projectUuid is required' } };
  let project = state.projects.find((item) => item.projectUuid === projectUuid);
  if (!project && input.create !== false) {
    project = {
      projectUuid,
      name: input.name || projectUuid,
      description: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.projects.push(project);
    saveShadowState(state);
  }
  if (!project) return { ok: false, error: { code: 'NOT_FOUND', message: `project not found (${projectUuid})` } };
  const context = writeContext({ projectUuid, groupNodeKey: null });
  return { ok: true, shadow: true, project, context };
}

function unuseShadowProject() {
  const context = writeContext({ projectUuid: null, groupNodeKey: null });
  return { ok: true, shadow: true, context };
}

function createShadowGroup(input = {}, state) {
  const context = activeContext();
  const projectUuid = input.projectUuid || context.projectUuid;
  const groupNodeKey = input.groupNodeKey || input.key || input.id || `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const group = {
    groupNodeKey,
    projectUuid,
    name: input.name || groupNodeKey,
    x: Number.isFinite(Number(input.x)) ? Number(input.x) : 0,
    y: Number.isFinite(Number(input.y)) ? Number(input.y) : 0,
    createdAt: now,
    updatedAt: now,
  };
  state.groups = state.groups.filter((item) => item.groupNodeKey !== groupNodeKey);
  state.groups.push(group);
  saveShadowState(state);
  const shouldUse = input.use !== false && input.use !== 'false';
  const nextContext = shouldUse ? writeContext({ projectUuid, groupNodeKey }) : context;
  return { ok: true, shadow: true, group, context: nextContext };
}

function listShadowGroups(state) {
  const context = activeContext();
  const groups = state.groups.filter((group) => !context.projectUuid || group.projectUuid === context.projectUuid);
  return { ok: true, shadow: true, groups, context };
}

function useShadowGroup(input = {}, state) {
  const context = activeContext();
  const groupNodeKey = input.groupNodeKey || input.key || input.id || input.name;
  if (!groupNodeKey) return { ok: false, error: { code: 'BAD_REQUEST', message: 'groupNodeKey is required' } };
  const group = state.groups.find((item) => item.groupNodeKey === groupNodeKey || item.name === groupNodeKey);
  if (!group) return { ok: false, error: { code: 'NOT_FOUND', message: `group not found (${groupNodeKey})` } };
  const nextContext = writeContext({ projectUuid: group.projectUuid || context.projectUuid, groupNodeKey: group.groupNodeKey });
  return { ok: true, shadow: true, group, context: nextContext };
}

function unuseShadowGroup() {
  const context = writeContext({ groupNodeKey: null });
  return { ok: true, shadow: true, context };
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
  saveShadowState(state);
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
  saveShadowState(state);
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
  saveShadowState(state);
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
  saveShadowState(state);
  return { ok: true, shadow: true, id, element: state.elements[index] };
}

function removeShadowElement(id, state) {
  const before = state.elements.length;
  state.elements = state.elements.filter((item) => item.id !== id && item.parentId !== id);
  state.selectedElementIds = state.selectedElementIds.filter((item) => item !== id);
  saveShadowState(state);
  return { ok: before !== state.elements.length, shadow: true, id, removed: before - state.elements.length };
}

function selectShadowElements(ids, state) {
  const available = new Set(state.elements.map((item) => item.id));
  state.selectedElementIds = (Array.isArray(ids) ? ids : []).filter((id) => available.has(id));
  saveShadowState(state);
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
    projects: state.projects,
    groups: state.groups,
    context: activeContext(),
  };
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
  saveShadowState(state);
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
      const state = loadShadowState();
      return {
        ok: true,
        runtime: 'flovart-shadow-runtime',
        shadow: true,
        mediaElements: state.elements.filter((item) => item.type === 'image' || item.type === 'video').length,
        jobs: state.jobs.length,
        provider: state.provider,
        stateFile: SHADOW_STATE_FILE,
      };
    },
    provider: {
      status: async () => ({ ok: true, shadow: true, ...loadShadowState().provider }),
      beginSetup: async (input = {}) => ({
        ok: true,
        shadow: true,
        status: 'waiting_for_user',
        provider: input.provider || 'custom',
        purpose: input.purpose || 'both',
        message: 'Shadow runtime cannot collect API keys. Open Flovart UI to complete setup.',
      }),
      selectModel: async (input = {}) => {
        const state = loadShadowState();
        state.provider.selectedModels = {
          image: input.imageModel || state.provider.selectedModels.image,
          video: input.videoModel || state.provider.selectedModels.video,
          text: input.textModel || state.provider.selectedModels.text,
        };
        saveShadowState(state);
        return { ok: true, shadow: true, selectedModels: state.provider.selectedModels };
      },
      test: async (input = {}) => {
        const state = loadShadowState();
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
    project: {
      create: async (input = {}) => createShadowProject(input, loadShadowState()),
      list: async () => listShadowProjects(loadShadowState()),
      use: async (input = {}) => useShadowProject(input, loadShadowState()),
      unuse: async () => unuseShadowProject(),
      summary: async () => summarizeProject(null, loadShadowState()),
    },
    group: {
      create: async (input = {}) => createShadowGroup(input, loadShadowState()),
      list: async () => listShadowGroups(loadShadowState()),
      use: async (input = {}) => useShadowGroup(input, loadShadowState()),
      unuse: async () => unuseShadowGroup(),
      summary: async () => ({ ok: true, shadow: true, context: activeContext(), groups: loadShadowState().groups }),
    },
    canvas: {
      inspect: async () => inspectShadowCanvas(loadShadowState()),
      listMedia: async () => loadShadowState().elements.filter((item) => item.type === 'image' || item.type === 'video'),
      addImage: async (input) => createShadowElement({ ...input, type: 'image' }, loadShadowState()),
      addVideo: async (input) => createShadowElement({ ...input, type: 'video' }, loadShadowState()),
      addElement: async (input) => createShadowElement(input, loadShadowState()),
      getElements: async () => loadShadowState().elements,
      updateElement: async (id, updates) => updateShadowElement(id, updates, loadShadowState()),
      removeElement: async (id) => removeShadowElement(id, loadShadowState()),
      select: async (ids) => selectShadowElements(ids, loadShadowState()),
      clearMedia: async () => {
        const state = loadShadowState();
        state.elements = state.elements.filter((item) => item.type !== 'image' && item.type !== 'video');
        saveShadowState(state);
        return { ok: true, shadow: true };
      },
      clear: async () => {
        const state = createEmptyState();
        saveShadowState(state);
        return { ok: true, shadow: true };
      },
    },
    element: {
      create: async (input) => createShadowElement(input, loadShadowState()),
      updatePrompt: async (input) => updateShadowPrompt(input, loadShadowState()),
      assignSlot: async (input) => assignShadowSlot(input, loadShadowState()),
      ignite: async (input) => igniteShadowElement(input, loadShadowState()),
      watch: async (input) => watchShadowElement(input, loadShadowState()),
    },
    assets: {
      list: async () => [],
    },
    generate: {
      image: async (input = {}) => createShadowGeneration(input, 'image', loadShadowState()),
      imagesBatch: async (input = {}) => {
        const items = Array.isArray(input.items) ? input.items : [];
        const results = items.map((item, index) => ({
          clientShotId: item.clientShotId,
          ...createShadowGeneration({ ...item, name: item.clientShotId ? `Shot ${item.clientShotId}` : `Shot ${index + 1}` }, 'image', loadShadowState()),
        }));
        return { ok: true, shadow: true, items: results };
      },
      video: async (input = {}) => createShadowGeneration(input, 'video', loadShadowState()),
      videoStatus: async (input) => loadShadowState().jobs.find((item) => item.jobId === input.jobId) || null,
    },
    export: {
      project: async () => {
        const state = loadShadowState();
        return {
          ok: true,
          shadow: true,
          context: activeContext(),
          projects: state.projects,
          groups: state.groups,
          mediaElements: state.elements.filter((item) => item.type === 'image' || item.type === 'video'),
          assets: [],
        };
      },
    },
  };
}
