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
    workflowProjects: [],
    activeWorkflowProjectId: null,
    groups: [],
    jobs: [],
    provider: {
      configured: { image: false, video: false, text: false },
      selectedModels: {
        image: 'flux-schnell',
        video: 'doubao-seedance-2.0',
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
    const empty = createEmptyState();
    const provider = {
      ...empty.provider,
      ...(parsed.provider || {}),
      selectedModels: {
        ...empty.provider.selectedModels,
        ...(parsed.provider?.selectedModels || {}),
      },
    };
    if (
      provider.selectedModels.video === 'kling-v2'
      && !provider.configured?.video
      && (!Array.isArray(provider.providers) || provider.providers.length === 0)
    ) {
      provider.selectedModels.video = 'doubao-seedance-2.0';
    }
    return {
      ...empty,
      ...parsed,
      provider,
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

function buildProviderReadiness(provider = {}, purpose = 'both') {
  const configured = provider.configured || {};
  const selectedModels = provider.selectedModels || {};
  const include = (target) => purpose === 'both' || purpose === 'all' || purpose === target;
  const checks = [];

  if (include('image')) {
    checks.push({
      id: 'image.providerConfigured',
      purpose: 'image',
      ok: !!configured.image,
      model: selectedModels.image,
      message: configured.image ? 'Image provider configured.' : 'Image provider credential missing.',
      nextAction: configured.image ? undefined : 'provider.begin-setup --purpose image',
    });
  }

  if (include('video')) {
    const videoModel = String(selectedModels.video || '');
    const seedanceReady = videoModel.toLowerCase().includes('seedance');
    checks.push({
      id: 'video.providerConfigured',
      purpose: 'video',
      ok: !!configured.video,
      model: videoModel,
      message: configured.video ? 'Video provider configured.' : 'Video provider credential missing.',
      nextAction: configured.video ? undefined : 'provider.begin-setup --provider volcengine --purpose video',
    });
    checks.push({
      id: 'video.seedance2Model',
      purpose: 'video',
      ok: seedanceReady,
      model: videoModel,
      message: seedanceReady ? 'Seedance 2.0 model is selected.' : 'Selected video model is not a Seedance 2.0 model.',
      expectedModels: ['doubao-seedance-2.0', 'seedance-2.0', 'dreamina-seedance-2-0-260128', 'doubao-seedance-2-0-260128'],
      slots: { image: 9, video: 3, audio: 3 },
      durationSec: { min: 4, max: 15 },
      resolutions: ['480p', '720p', '1080p'],
      nextAction: seedanceReady ? undefined : 'provider.select-model --video-model doubao-seedance-2.0',
    });
  }

  if (include('text')) {
    checks.push({
      id: 'text.providerConfigured',
      purpose: 'text',
      ok: !!configured.text,
      model: selectedModels.text,
      message: configured.text ? 'Text provider configured.' : 'Text provider credential missing.',
      nextAction: configured.text ? undefined : 'provider.begin-setup --purpose text',
    });
  }

  return checks;
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

function createShadowWorkflowProject(title = '未命名工作流') {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), title, nodes: [], connections: [], selectedNodeIds: [],
    viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'dots',
    agentSessions: [], activeAgentSessionId: null, createdAt: now, updatedAt: now,
  };
}

function shadowWorkflowNode(type, args) {
  const spec = {
    image: ['图片', 340, 240, { status: 'idle' }],
    text: ['文本', 340, 220, { content: '', status: 'idle' }],
    video: ['视频', 420, 236, { status: 'idle' }],
    audio: ['音频', 380, 168, { status: 'idle' }],
    config: ['生成配置', 360, 260, { prompt: '', status: 'idle', config: { mode: 'image' } }],
  }[type];
  if (!spec) return null;
  return {
    id: args.id || randomUUID(), type, title: args.title || spec[0],
    position: { x: Number(args.x ?? 0), y: Number(args.y ?? 0) },
    width: Number(args.width || spec[1]), height: Number(args.height || spec[2]),
    metadata: { ...spec[3], ...(args.metadata || {}) },
  };
}

function shadowWorkflowCreatesCycle(project, fromNodeId, toNodeId) {
  const outgoing = new Map();
  [...project.connections, { fromNodeId, toNodeId }].forEach(connection => outgoing.set(connection.fromNodeId, [...(outgoing.get(connection.fromNodeId) || []), connection.toNodeId]));
  const pending = [toNodeId];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (current === fromNodeId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(outgoing.get(current) || []));
  }
  return false;
}

function dispatchShadowWorkflow(envelope, state) {
  const { command, args = {} } = envelope;
  const done = (result) => ({ ok: true, commandId: envelope.id, result: { shadow: true, ...result } });
  const fail = (code, message) => ({ ok: false, commandId: envelope.id, error: { code, message } });

  if (command === 'workflow.project.list') {
    return done({ projects: state.workflowProjects.map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt })) });
  }
  if (command === 'workflow.project.create') {
    const project = createShadowWorkflowProject(args.title);
    state.workflowProjects.unshift(project);
    state.activeWorkflowProjectId = project.id;
    saveShadowState(state);
    return done({ projectId: project.id });
  }

  const projectId = args.projectId || state.activeWorkflowProjectId;
  const project = state.workflowProjects.find(item => item.id === projectId);
  if (command === 'workflow.project.use') {
    if (!project) return fail('NOT_FOUND', `Workflow project not found (${projectId})`);
    state.activeWorkflowProjectId = project.id;
    saveShadowState(state);
    return done({ projectId: project.id });
  }
  if (command === 'workflow.project.delete') {
    if (!project) return fail('NOT_FOUND', `Workflow project not found (${projectId})`);
    state.workflowProjects = state.workflowProjects.filter(item => item.id !== project.id);
    if (state.activeWorkflowProjectId === project.id) state.activeWorkflowProjectId = state.workflowProjects[0]?.id || null;
    saveShadowState(state);
    return done({ projectId: project.id });
  }
  if (!project) return fail('NOT_FOUND', 'No active Workflow project.');
  if (command === 'workflow.inspect') {
    const redact = value => {
      if (Array.isArray(value)) return value.map(redact);
      if (!value || typeof value !== 'object') return typeof value === 'string' && /^(?:data:|blob:|file:|[a-z]:\\|\\\\)/i.test(value) ? '[media]' : value;
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, /(?:api.?key|authorization|token|secret|password|storage.?key|file.?path|local.?path|data.?url)/i.test(key) ? '[redacted]' : /^(?:href|poster|src|url)$/i.test(key) && child ? '[media]' : redact(child)]));
    };
    return done(redact(project));
  }
  if (command === 'workflow.node.run' || command === 'workflow.node.stop') {
    return fail('BROWSER_REQUIRED', 'Workflow provider generation requires an open Flovart browser tab.');
  }

  const nodeId = args.nodeId || args.id;
  if (command === 'workflow.node.create' || command === 'workflow.node.create-connected') {
    const node = shadowWorkflowNode(args.type || 'text', args);
    if (!node) return fail('BAD_REQUEST', `Unsupported Workflow node type (${args.type})`);
    if (project.nodes.some(item => item.id === node.id)) return fail('BAD_REQUEST', `Workflow node ID already exists (${node.id})`);
    if (command === 'workflow.node.create-connected') {
      const fromNodeId = args.fromNodeId || args.from;
      if (!project.nodes.some(item => item.id === fromNodeId)) return fail('BAD_REQUEST', 'Workflow source node not found.');
      project.connections.push({ id: randomUUID(), fromNodeId, toNodeId: node.id });
    }
    project.nodes.push(node);
    project.selectedNodeIds = [node.id];
  } else if (command === 'workflow.node.update') {
    const node = project.nodes.find(item => item.id === nodeId);
    if (!node) return fail('NOT_FOUND', `Workflow node not found (${nodeId})`);
    const patch = args.patch || args.updates || {};
    if (patch.id) return fail('BAD_REQUEST', 'Workflow node ID cannot be changed.');
    Object.assign(node, patch, { metadata: { ...node.metadata, ...(patch.metadata || {}) } });
  } else if (command === 'workflow.node.delete') {
    if (!project.nodes.some(item => item.id === nodeId)) return fail('NOT_FOUND', `Workflow node not found (${nodeId})`);
    project.nodes = project.nodes.filter(item => item.id !== nodeId);
    project.connections = project.connections.filter(item => item.fromNodeId !== nodeId && item.toNodeId !== nodeId);
    project.selectedNodeIds = project.selectedNodeIds.filter(id => id !== nodeId);
  } else if (command === 'workflow.node.move') {
    const node = project.nodes.find(item => item.id === nodeId);
    if (!node) return fail('NOT_FOUND', `Workflow node not found (${nodeId})`);
    node.position = { x: Number(args.x), y: Number(args.y) };
  } else if (command === 'workflow.node.resize') {
    const node = project.nodes.find(item => item.id === nodeId);
    if (!node) return fail('NOT_FOUND', `Workflow node not found (${nodeId})`);
    node.width = Number(args.width);
    node.height = Number(args.height);
  } else if (command === 'workflow.connect') {
    const fromNodeId = args.fromNodeId || args.from;
    const toNodeId = args.toNodeId || args.to;
    const fromNode = project.nodes.find(item => item.id === fromNodeId);
    const toNode = project.nodes.find(item => item.id === toNodeId);
    const valid = fromNodeId !== toNodeId
      && fromNode && toNode
      && !(fromNode.type === 'config' && toNode.type === 'config')
      && !project.connections.some(item => item.fromNodeId === fromNodeId && item.toNodeId === toNodeId)
      && !shadowWorkflowCreatesCycle(project, fromNodeId, toNodeId);
    if (!valid) return fail('BAD_REQUEST', 'Invalid or duplicate Workflow connection.');
    project.connections.push({ id: args.id || randomUUID(), fromNodeId, toNodeId });
  } else if (command === 'workflow.disconnect') {
    if (!project.connections.some(item => item.id === (args.connectionId || args.id))) return fail('NOT_FOUND', 'Workflow connection not found.');
    project.connections = project.connections.filter(item => item.id !== (args.connectionId || args.id));
  } else if (command === 'workflow.select') {
    const ids = Array.isArray(args.ids) ? args.ids : [nodeId].filter(Boolean);
    project.selectedNodeIds = ids.filter(id => project.nodes.some(node => node.id === id));
  } else if (command === 'workflow.viewport.set') {
    project.viewport = { x: Number(args.x || 0), y: Number(args.y || 0), k: Number(args.k || args.zoom || 1) };
  } else {
    return fail('UNKNOWN_COMMAND', `Unknown Workflow command (${command})`);
  }

  project.updatedAt = new Date().toISOString();
  saveShadowState(state);
  return done({ projectId: project.id, nodeId });
}

export function createShadowRuntimeFacade() {
  return {
    _version: 'shadow-runtime',
    workflow: {
      dispatch: async envelope => dispatchShadowWorkflow(envelope, loadShadowState()),
    },
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
      status: async () => {
        const provider = loadShadowState().provider;
        const readiness = buildProviderReadiness(provider, 'both');
        return { ok: true, shadow: true, ...provider, readiness, nextActions: readiness.filter(item => !item.ok && item.nextAction).map(item => item.nextAction) };
      },
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
        const readiness = buildProviderReadiness(state.provider, purpose);
        return {
          ok: readiness.length ? readiness.every(item => item.ok) : false,
          purpose,
          checks,
          readiness,
          nextActions: readiness.filter(item => !item.ok && item.nextAction).map(item => item.nextAction),
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
