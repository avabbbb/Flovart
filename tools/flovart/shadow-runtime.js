import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

export const SHADOW_STATE_FILE = process.env.FLOVART_SHADOW_STATE_FILE
  || join(process.env.LOCALAPPDATA || process.cwd(), 'Flovart', 'shadow-runtime-state.json');

function createProviderState() {
  return {
    configured: { image: false, video: false, text: false },
    selectedModels: {
      image: 'flovart:gpt-image-2',
      video: 'flovart:seedance-2',
      text: 'gemini-3-flash-preview',
    },
    availableModels: { image: [], video: [], text: [] },
    providers: [],
  };
}

function createEmptyState() {
  return {
    version: 2,
    updatedAt: Date.now(),
    workflowProjects: [],
    activeWorkflowProjectId: null,
    jobs: [],
    provider: createProviderState(),
  };
}

function ensureParentDir(filePath) {
  const parent = dirname(filePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
}

export function loadShadowState() {
  try {
    if (!existsSync(SHADOW_STATE_FILE)) return createEmptyState();
    const parsed = JSON.parse(readFileSync(SHADOW_STATE_FILE, 'utf8'));
    const empty = createEmptyState();
    const provider = {
      ...empty.provider,
      ...(parsed.provider || {}),
      configured: { ...empty.provider.configured, ...(parsed.provider?.configured || {}) },
      selectedModels: { ...empty.provider.selectedModels, ...(parsed.provider?.selectedModels || {}) },
      availableModels: { ...empty.provider.availableModels, ...(parsed.provider?.availableModels || {}) },
      providers: Array.isArray(parsed.provider?.providers) ? parsed.provider.providers : [],
    };
    if (
      provider.selectedModels.video === 'kling-v2'
      && !provider.configured.video
      && provider.providers.length === 0
    ) {
      provider.selectedModels.video = 'flovart:seedance-2';
    }
    const workflowProjects = Array.isArray(parsed.workflowProjects) ? parsed.workflowProjects : [];
    const activeWorkflowProjectId = workflowProjects.some(project => project.id === parsed.activeWorkflowProjectId)
      ? parsed.activeWorkflowProjectId
      : workflowProjects[0]?.id || null;
    return {
      ...empty,
      workflowProjects,
      activeWorkflowProjectId,
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      provider,
    };
  } catch {
    return createEmptyState();
  }
}

export function saveShadowState(state) {
  ensureParentDir(SHADOW_STATE_FILE);
  const persisted = {
    version: 2,
    updatedAt: Date.now(),
    workflowProjects: state.workflowProjects,
    activeWorkflowProjectId: state.activeWorkflowProjectId,
    jobs: state.jobs,
    provider: state.provider,
  };
  writeFileSync(SHADOW_STATE_FILE, JSON.stringify(persisted, null, 2), 'utf8');
}

function buildProviderReadiness(provider = {}, purpose = 'both') {
  const configured = provider.configured || {};
  const selectedModels = provider.selectedModels || {};
  const include = target => purpose === 'both' || purpose === 'all' || purpose === target;
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
      expectedProductModelIds: ['flovart:seedance-2', 'flovart:seedance-2-fast'],
      slots: { image: 9, video: 3, audio: 3 },
      durationSec: { min: 4, max: 15 },
      resolutions: ['480p', '720p', '1080p'],
      nextAction: seedanceReady ? undefined : 'provider.select-model --video-model flovart:seedance-2',
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

function createWorkflowProject(title = '未命名工作流') {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title,
    nodes: [],
    connections: [],
    selectedNodeIds: [],
    viewport: { x: 0, y: 0, k: 1 },
    backgroundMode: 'dots',
    agentSessions: [],
    activeAgentSessionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createWorkflowNode(type, args) {
  const spec = {
    image: ['图片', 340, 240, { status: 'idle' }],
    text: ['文本', 340, 220, { content: '', status: 'idle' }],
    video: ['视频', 420, 236, { status: 'idle' }],
    audio: ['音频', 380, 168, { status: 'idle' }],
    config: ['生成配置', 360, 260, { prompt: '', status: 'idle', config: { mode: 'image' } }],
  }[type];
  if (!spec) return null;
  return {
    id: args.id || randomUUID(),
    type,
    title: args.title || spec[0],
    position: { x: Number(args.x ?? 0), y: Number(args.y ?? 0) },
    width: Number(args.width || spec[1]),
    height: Number(args.height || spec[2]),
    metadata: { ...spec[3], ...(args.metadata || {}) },
  };
}

function createsCycle(project, fromNodeId, toNodeId) {
  const outgoing = new Map();
  [...project.connections, { fromNodeId, toNodeId }].forEach(connection => {
    outgoing.set(connection.fromNodeId, [...(outgoing.get(connection.fromNodeId) || []), connection.toNodeId]);
  });
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

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && /^(?:data:|blob:|file:|[a-z]:\\|\\\\)/i.test(value) ? '[media]' : value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    /(?:api.?key|authorization|token|secret|password|storage.?key|file.?path|local.?path|data.?url)/i.test(key)
      ? '[redacted]'
      : /^(?:href|poster|src|url)$/i.test(key) && child ? '[media]' : redact(child),
  ]));
}

function dispatchShadowWorkflow(envelope, state) {
  const { command, args = {} } = envelope;
  const done = result => ({ ok: true, commandId: envelope.id, result: { shadow: true, ...result } });
  const fail = (code, message) => ({ ok: false, commandId: envelope.id, error: { code, message } });

  if (command === 'workflow.project.list') {
    return done({ projects: state.workflowProjects.map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt })) });
  }
  if (command === 'workflow.project.create') {
    const project = createWorkflowProject(args.title);
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
  if (command === 'workflow.inspect') return done(redact(project));
  if (command === 'workflow.node.run' || command === 'workflow.node.stop') {
    return fail('BROWSER_REQUIRED', 'Workflow provider generation requires an open Flovart browser tab.');
  }

  let nodeId = args.nodeId || args.id;
  let connectionId = null;
  if (command === 'workflow.node.create' || command === 'workflow.node.create-connected') {
    const node = createWorkflowNode(args.type || 'text', args);
    if (!node) return fail('BAD_REQUEST', `Unsupported Workflow node type (${args.type})`);
    if (project.nodes.some(item => item.id === node.id)) return fail('BAD_REQUEST', `Workflow node ID already exists (${node.id})`);
    if (command === 'workflow.node.create-connected') {
      const fromNodeId = args.fromNodeId || args.from;
      if (!project.nodes.some(item => item.id === fromNodeId)) return fail('BAD_REQUEST', 'Workflow source node not found.');
      connectionId = args.connectionId || randomUUID();
      project.connections.push({ id: connectionId, fromNodeId, toNodeId: node.id });
    }
    project.nodes.push(node);
    project.selectedNodeIds = [node.id];
    nodeId = node.id;
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
    const valid = fromNodeId !== toNodeId
      && project.nodes.some(item => item.id === fromNodeId)
      && project.nodes.some(item => item.id === toNodeId)
      && !project.connections.some(item => item.fromNodeId === fromNodeId && item.toNodeId === toNodeId)
      && !createsCycle(project, fromNodeId, toNodeId);
    if (!valid) return fail('BAD_REQUEST', 'Invalid or duplicate Workflow connection.');
    project.connections.push({ id: args.id || randomUUID(), fromNodeId, toNodeId });
  } else if (command === 'workflow.disconnect') {
    const id = args.connectionId || args.id;
    if (!project.connections.some(item => item.id === id)) return fail('NOT_FOUND', 'Workflow connection not found.');
    project.connections = project.connections.filter(item => item.id !== id);
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
  const result = { projectId: project.id, nodeId };
  if (connectionId) result.connectionId = connectionId;
  return done(result);
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
        workflowProjects: state.workflowProjects.length,
        activeWorkflowProjectId: state.activeWorkflowProjectId,
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
        const readiness = buildProviderReadiness(state.provider, purpose);
        return {
          ok: readiness.length ? readiness.every(item => item.ok) : false,
          purpose,
          checks: state.provider.configured,
          readiness,
          nextActions: readiness.filter(item => !item.ok && item.nextAction).map(item => item.nextAction),
          shadow: true,
        };
      },
    },
    assets: {
      list: async () => [],
    },
    generate: {
      videoStatus: async input => loadShadowState().jobs.find(item => item.jobId === input.jobId) || null,
    },
    export: {
      project: async input => {
        const state = loadShadowState();
        const projectId = input?.projectId || state.activeWorkflowProjectId;
        const project = state.workflowProjects.find(item => item.id === projectId) || null;
        return project
          ? { ok: true, shadow: true, project: redact(project) }
          : { ok: false, error: { code: 'NOT_FOUND', message: 'No active Workflow project.' } };
      },
    },
  };
}
