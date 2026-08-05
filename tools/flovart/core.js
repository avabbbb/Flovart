import { CANONICAL_COMMAND_REGISTRY } from './registry.js';

export const COMMAND_REGISTRY = CANONICAL_COMMAND_REGISTRY;

export const COMMANDS = Object.keys(COMMAND_REGISTRY);

export const COMMAND_ALIASES = {
  flovart_workflow_project_list: 'workflow.project.list',
  flovart_workflow_project_create: 'workflow.project.create',
  flovart_workflow_project_use: 'workflow.project.use',
  flovart_workflow_project_delete: 'workflow.project.delete',
  flovart_workflow_inspect: 'workflow.inspect',
  flovart_workflow_node_create: 'workflow.node.create',
  flovart_workflow_node_create_connected: 'workflow.node.create-connected',
  flovart_workflow_node_update: 'workflow.node.update',
  flovart_workflow_node_delete: 'workflow.node.delete',
  flovart_workflow_node_move: 'workflow.node.move',
  flovart_workflow_node_resize: 'workflow.node.resize',
  flovart_workflow_node_tool: 'workflow.node.tool',
  flovart_workflow_connect: 'workflow.connect',
  flovart_workflow_disconnect: 'workflow.disconnect',
  flovart_workflow_select: 'workflow.select',
  flovart_workflow_viewport_set: 'workflow.viewport.set',
  flovart_workflow_node_run: 'workflow.node.run',
  flovart_workflow_node_stop: 'workflow.node.stop',
  gen: 'generate.image',
  flovart_generate_image: 'generate.image',
  flovart_generate_video: 'generate.video',
  models: 'models.list',
  doctor: 'doctor',
  preferences: 'preferences.manage',
  prefs: 'preferences.manage',
  inspire: 'inspiration.search',
  enhance: 'prompt.enhance',
  plan: 'batch.plan',
};

function getCommandAliases(command) {
  return Object.entries(COMMAND_ALIASES)
    .filter(([, target]) => target === command)
    .map(([alias]) => alias);
}

export const QUICK_COMMANDS = [
  'status',
  'provider.status',
  'workflow.inspect',
  'workflow.project.list',
  'asset.list',
  'models.list',
  'doctor',
  'preferences.manage',
  'inspiration.search',
  'setup',
];

export const HELP_TEXT = [
  'Flovart Agent Bridge exposes deterministic tools for external agents.',
  'Claude Code/Codex/OpenCode should do planning and call these commands with explicit arguments.',
  '',
  'Commands:',
  'help                                            Show this help',
  'setup                                           Show CLI file-bridge setup steps',
  'init --host codex|claude|opencode|cursor|windsurf|vscode|all [--dry-run]',
  'doctor                                          Diagnose CLI setup + Seedance Workflow readiness',
  'command.list                                    List machine-readable atomic command metadata',
  'command.schema --command <name>                 Show one command schema',
  'inspiration.search --query <term>               Search curated inspiration prompts',
  'inspiration.get --id <id>                       Show one inspiration prompt',
  'prompt.enhance --prompt <text> [--style cinematic --mode image]',
  'batch.plan --prompt <text> [--count 4]          Build a batch generation plan',
  'preferences.manage --action get|set|reset|add-favorite',
  'models.list --purpose image|video|all           List agent-facing model IDs',
  'model search --type image --query flux           Search model IDs',
  'status                                          Inspect runtime status',
  'provider.status                                 Inspect provider/model configuration',
  'provider.begin-setup --provider <id> --purpose image|video|both',
  'provider.select-model --image-model flovart:<id> --video-model flovart:<id>',
  'provider.test                                   Check configured provider readiness',
  'workflow.project.list                           List Workflow projects',
  'workflow.inspect [--project-id <id>]             Inspect a Workflow graph',
  'workflow.node.create --type image|video|text|audio|config',
  'workflow.node.update --node-id <id> --patch-json <json>',
  'workflow.node.run --node-id <id>                 Run one Workflow node',
  'asset.list                                      List local generated media assets',
  'generate.image --prompt <prompt>                Generate one image',
  'generate.images-batch --file shots.json         Trigger multiple image generations',
  'generate.video --prompt <prompt> [--source-image-ids id1,id2] [--source-video-ids id3] [--slots-json <json>]',
  'video.status --job-id <id>                      Query video job status',
  'export.project                                  Export project metadata when supported',
  '',
  'This CLI does not understand natural language. The external agent is the planner.',
].join('\n');

export const SETUP_TEXT = [
  'Flovart Agent Toolkit setup:',
  '1. npx flovart-cli install',
  '2. npx flovart-cli start',
  '3. Enter provider credentials only in the local Flovart Runtime/WebUI',
  '4. npx flovart-cli status --json',
  '5. npx flovart-cli generate.image --prompt <prompt> --json',
  '',
  'Source contributors use `npx flovart-cli start --source --all --open`.',
  'Never paste API keys into AI agent transcripts.',
].join('\n');

export function formatValue(value) {
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value, null, 2);
    return json.length > 2200 ? `${json.slice(0, 2200)}\n...truncated` : json;
  } catch {
    return String(value);
  }
}

export function createLine(kind, content, meta) {
  return { kind, content, meta };
}

export function createFlovartSession(initial = {}) {
  return {
    id: initial.id || `flovart-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    lastTool: initial.lastTool || '',
    isDark: !!initial.isDark,
  };
}

export function parseCliArgs(argv = []) {
  const result = { _: [] };
  const setOption = (key, value) => {
    if (key === 's' || key === 'set' || key === 'u' || key === 'update') {
      const existing = result[key];
      result[key] = existing === undefined ? [value] : Array.isArray(existing) ? [...existing, value] : [existing, value];
      return;
    }
    result[key] = value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('-') && !token.startsWith('--') && token.length > 1) {
      const raw = token.slice(1);
      const eq = raw.indexOf('=');
      if (eq >= 0) {
        setOption(raw.slice(0, eq), raw.slice(eq + 1));
        continue;
      }

      const next = argv[index + 1];
      if (!next || next.startsWith('-')) {
        setOption(raw, true);
        continue;
      }

      setOption(raw, next);
      index += 1;
      continue;
    }

    if (!token.startsWith('--')) {
      result._.push(token);
      continue;
    }

    const raw = token.slice(2);
    const eq = raw.indexOf('=');
    if (eq >= 0) {
      setOption(raw.slice(0, eq), raw.slice(eq + 1));
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      setOption(raw, true);
      continue;
    }

    setOption(raw, next);
    index += 1;
  }
  return result;
}

export function normalizeCommandName(name = '') {
  const trimmed = String(name).trim();
  if (COMMAND_REGISTRY[trimmed]) return trimmed;
  if (COMMAND_ALIASES[trimmed]) return COMMAND_ALIASES[trimmed];
  const dotted = trimmed.replace(/-/g, '.');
  if (COMMAND_REGISTRY[dotted]) return dotted;
  if (COMMAND_ALIASES[dotted]) return COMMAND_ALIASES[dotted];
  return dotted;
}

function findRegisteredCommand(name = '') {
  const direct = String(name || '').trim();
  if (COMMAND_REGISTRY[direct]) return direct;

  const normalized = normalizeCommandName(direct);
  if (COMMAND_REGISTRY[normalized]) return normalized;

  const equivalent = COMMANDS.find((command) => normalizeCommandName(command) === normalized);
  return equivalent || normalized;
}

function parseJsonOption(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseListOption(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  const parsed = parseJsonOption(value, null);
  if (Array.isArray(parsed)) return parsed;
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function updatePayloadFromArgs(args = {}) {
  const explicit = args.updates || parseJsonOption(args['updates-json'] || args.updatesJson, null);
  if (explicit && typeof explicit === 'object' && !Array.isArray(explicit)) return explicit;

  const blocked = new Set(['_', 'id', 'updates', 'updates-json', 'updatesJson', 'json']);
  const updates = {};
  for (const [key, value] of Object.entries(args)) {
    if (blocked.has(key) || value === undefined) continue;
    if (['x', 'y', 'width', 'height', 'fontSize', 'durationSec'].includes(key)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) updates[key] = numeric;
      continue;
    }
    updates[key] = value;
  }
  return updates;
}

function coerceScalar(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (typeof value === 'string' && value.trim() !== '' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function pairsToObject(values) {
  const list = Array.isArray(values) ? values : values === undefined ? [] : [values];
  const output = {};
  for (const item of list) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      Object.assign(output, item);
      continue;
    }
    const text = String(item || '');
    const eq = text.indexOf('=');
    if (eq < 0) continue;
    output[text.slice(0, eq)] = coerceScalar(text.slice(eq + 1));
  }
  return output;
}

function commandSubcommand(args, fallback = 'list') {
  return String(args._?.[0] || args.subcommand || fallback).trim();
}

function argId(args, name = 'id') {
  return args.id || args.key || args.uuid || args[name] || args._?.[0];
}

function nodeIdArg(args) {
  return args.id || args.node || args.n || args['node-id'] || args.nodeId || args._?.[0];
}

function nodeTypeArg(args) {
  return args.type || args.t || 'image';
}

function nodeNameArg(args) {
  return args.name || args.n || args.label;
}

function buildNodeUpdates(args = {}) {
  return {
    set: {
      ...pairsToObject(args.s),
      ...pairsToObject(args.set),
      ...parseJsonOption(args['set-json'] || args.setJson, {}),
    },
    update: {
      ...pairsToObject(args.u),
      ...pairsToObject(args.update),
      ...parseJsonOption(args['update-json'] || args.updateJson, {}),
    },
  };
}

const IMAGE_SHORTCUTS = [
  {
    id: 'product-hero',
    label: 'product-hero',
    prompt: 'premium product hero image, clean commercial composition, controlled studio lighting, polished reflections, exact product identity, production-ready finish',
  },
  {
    id: 'character-board',
    label: 'character-board',
    prompt: 'character consistency reference board, same identity across poses, clear face, outfit, proportions, neutral background, production concept art',
  },
  {
    id: 'cinematic-keyframe',
    label: 'cinematic-keyframe',
    prompt: 'cinematic keyframe, clear subject action, motivated lighting, layered depth, stable composition, film still quality',
  },
  {
    id: 'scene-establishing',
    label: 'scene-establishing',
    prompt: 'wide establishing scene, readable layout, layered environment design, strong focal path, atmospheric depth, cinematic worldbuilding',
  },
];

function splitStoryboardScript(script, count) {
  const lines = String(script || '')
    .split(/\r?\n|[。！？.!?]/)
    .map((line) => line.trim())
    .filter(Boolean);
  const desired = Math.max(1, Math.min(Number(count || lines.length || 6), 24));
  if (lines.length >= desired) return lines.slice(0, desired);
  const base = lines.length ? lines : ['Storyboard shot'];
  return Array.from({ length: desired }, (_, index) => base[index % base.length]);
}

function required(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required argument: --${name}`);
  }
  return value;
}

function mediaElementFromArgs(args, type) {
  const width = args.width ? Number(args.width) : undefined;
  const height = args.height ? Number(args.height) : undefined;
  return {
    id: args.id,
    type,
    href: required(args.href, 'href'),
    mimeType: args['mime-type'] || args.mimeType || (type === 'image' ? 'image/png' : 'video/mp4'),
    name: args.name || (type === 'image' ? 'Agent Image' : 'Agent Video'),
    x: args.x ? Number(args.x) : undefined,
    y: args.y ? Number(args.y) : undefined,
    width,
    height,
  };
}

async function loadAgentKit() {
  const isNodeRuntime = typeof process !== 'undefined' && !!process.versions?.node;
  if (!isNodeRuntime && typeof window !== 'undefined') {
    return {
      initCliHost: () => ({ ok: false, error: { code: 'UNSUPPORTED_RUNTIME', message: 'CLI host init is only available in the Node CLI runtime.' } }),
      searchInspiration: () => ({ ok: false, error: { code: 'UNSUPPORTED_RUNTIME', message: 'Inspiration search is only available in the Node CLI runtime.' } }),
      getInspiration: () => ({ ok: false, error: { code: 'UNSUPPORTED_RUNTIME', message: 'Inspiration lookup is only available in the Node CLI runtime.' } }),
      enhancePrompt: () => ({ ok: false, error: { code: 'UNSUPPORTED_RUNTIME', message: 'Prompt enhancement is only available in the Node CLI runtime.' } }),
      planBatchGeneration: () => ({ ok: false, error: { code: 'UNSUPPORTED_RUNTIME', message: 'Batch planning is only available in the Node CLI runtime.' } }),
      prepareMediaUpload: () => ({ ok: false, error: { code: 'UNSUPPORTED_RUNTIME', message: 'Local media upload is only available in the Node CLI runtime.' } }),
      manageAgentPreferences: () => ({ ok: false, error: { code: 'UNSUPPORTED_RUNTIME', message: 'Agent preferences are only available in the Node CLI runtime.' } }),
      listAgentModels: () => ({ ok: false, error: { code: 'UNSUPPORTED_RUNTIME', message: 'Agent model listing is only available in the Node CLI runtime.' } }),
      diagnoseAgentSetup: () => ({ ok: false, error: { code: 'UNSUPPORTED_RUNTIME', message: 'Agent setup diagnostics are only available in the Node CLI runtime.' } }),
    };
  }
  const specifier = './agent-kit.js';
  return await import(/* @vite-ignore */ specifier);
}

export async function executeFlovartCommand(commandName, args = {}, runtime = {}) {
  const command = normalizeCommandName(commandName);

  if (command.startsWith('workflow.')) {
    if (!runtime.workflow?.dispatch) return { ok: false, error: { code: 'WORKFLOW_UNAVAILABLE', message: 'Workflow dispatcher unavailable.' } };
    const workflowArgs = {
      ...args,
      projectId: args.projectId || args['project-id'],
      nodeId: args.nodeId || args['node-id'],
      fromNodeId: args.fromNodeId || args['from-node-id'],
      toNodeId: args.toNodeId || args['to-node-id'],
      connectionId: args.connectionId || args['connection-id'],
      idempotencyKey: args.idempotencyKey || args['idempotency-key'],
      metadata: parseJsonOption(args.metadata ?? args.metadataJson ?? args['metadata-json'], undefined),
      patch: parseJsonOption(args.patch ?? args.patchJson ?? args['patch-json'], undefined),
      ids: Array.isArray(args.ids) ? args.ids : parseListOption(args.ids),
    };
    return await runtime.workflow.dispatch({
      id: args.commandId || `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      command,
      args: workflowArgs,
      source: 'cli',
      idempotencyKey: workflowArgs.idempotencyKey,
    });
  }

  switch (command) {
    case 'help':
      return { ok: true, text: HELP_TEXT, commands: COMMANDS, registry: COMMAND_REGISTRY };
    case 'setup':
      return { ok: true, text: SETUP_TEXT };
    case 'init': {
      const { initCliHost } = await loadAgentKit();
      return initCliHost({
        host: args.host || args._?.[0] || 'project',
        projectDir: args['project-dir'] || args.projectDir,
        dryRun: args['dry-run'] || args.dryRun,
      });
    }
    case 'doctor': {
      const { diagnoseAgentSetup } = await loadAgentKit();
      return diagnoseAgentSetup({
        projectDir: args['project-dir'] || args.projectDir,
      });
    }
    case 'command.list':
      return { ok: true, commands: COMMAND_REGISTRY, aliases: COMMAND_ALIASES };
    case 'command.schema': {
      const requested = args.command || args.name;
      if (!requested) return { ok: true, commands: COMMAND_REGISTRY, aliases: COMMAND_ALIASES };
      const commandKey = findRegisteredCommand(requested);
      const schema = COMMAND_REGISTRY[commandKey];
      return schema
        ? { ok: true, command: commandKey, schema: { ...schema, aliases: getCommandAliases(commandKey) } }
        : { ok: false, error: { code: 'UNKNOWN_COMMAND', message: `Unknown Flovart command: ${requested}` } };
    }
    case 'inspiration.search': {
      const { searchInspiration } = await loadAgentKit();
      return searchInspiration({ query: args.query || args._?.join(' '), category: args.category, limit: args.limit ? Number(args.limit) : undefined });
    }
    case 'inspiration.get': {
      const { getInspiration } = await loadAgentKit();
      return getInspiration({ id: required(args.id || args._?.[0], 'id') });
    }
    case 'prompt.enhance': {
      const { enhancePrompt } = await loadAgentKit();
      return enhancePrompt({
        prompt: required(args.prompt || args._?.join(' '), 'prompt'),
        style: args.style,
        aspectRatio: args['aspect-ratio'] || args.aspectRatio,
        mode: args.mode,
        styleNotes: args['style-notes'] || args.styleNotes,
      });
    }
    case 'batch.plan': {
      const { planBatchGeneration } = await loadAgentKit();
      return planBatchGeneration({
        prompt: required(args.prompt || args._?.join(' '), 'prompt'),
        count: args.count ? Number(args.count) : undefined,
        aspectRatio: args['aspect-ratio'] || args.aspectRatio,
      });
    }
    case 'preferences.manage': {
      const { manageAgentPreferences } = await loadAgentKit();
      return manageAgentPreferences({
        action: args.action || args._?.[0] || 'get',
        style: args.style,
        aspectRatio: args['aspect-ratio'] || args.aspectRatio,
        imageModel: args['image-model'] || args.imageModel,
        videoModel: args['video-model'] || args.videoModel,
        styleNotes: args['style-notes'] || args.styleNotes,
        prompt: args.prompt,
        title: args.title,
      });
    }
    case 'models.list': {
      const { listAgentModels } = await loadAgentKit();
      return listAgentModels({ purpose: args.purpose || args._?.[0] || 'all' });
    }
    case 'model':
    case 'model.search': {
      const { listAgentModels } = await loadAgentKit();
      const subcommand = command === 'model' ? commandSubcommand(args, 'list') : 'search';
      const requestedType = args.type || args.t || args.purpose || (subcommand === 'search' ? 'all' : args._?.[0]) || 'all';
      const query = String(args.query || args.q || (command === 'model.search' ? args._?.join(' ') : '') || '').toLowerCase();
      const listed = listAgentModels({ purpose: requestedType === 'text' ? 'all' : requestedType });
      const allModels = Object.entries(listed.models || {}).flatMap(([type, models]) => (models || []).map((model) => ({ ...model, type })));
      if (subcommand !== 'search' && subcommand !== 'list' && subcommand !== 'all' && subcommand !== 'image' && subcommand !== 'video') {
        const found = allModels.find((model) => model.id === subcommand);
        return found ? { ok: true, model: found } : { ok: false, error: { code: 'NOT_FOUND', message: `model not found: ${subcommand}` } };
      }
      const models = allModels.filter((model) => (!query || [model.id, model.label, model.type].join(' ').toLowerCase().includes(query)));
      return { ok: true, query, type: requestedType, models };
    }
    case 'runtime.status':
      return await runtime.runtime?.status?.() || {
        ok: false,
        error: {
          code: 'RUNTIME_UNAVAILABLE',
          message: 'Desktop Production Runtime is not connected.',
        },
      };
    case 'status':
      return await runtime.status?.() || {
        ok: true,
        runtime: runtime._version || 'unknown',
        providers: await runtime.provider?.status?.(),
      };
    case 'provider.status':
      return await runtime.provider?.status?.() || { ok: false, error: 'provider.status unavailable' };
    case 'provider.begin.setup':
    case 'provider.begin-setup':
      return await runtime.provider?.beginSetup?.({
        provider: args.provider || 'custom',
        purpose: args.purpose || 'both',
      });
    case 'provider.select.model':
    case 'provider.select-model':
      return await runtime.provider?.selectModel?.({
        imageModel: args['image-model'] || args.imageModel,
        videoModel: args['video-model'] || args.videoModel,
        textModel: args['text-model'] || args.textModel,
      });
    case 'provider.test':
      return await runtime.provider?.test?.({ purpose: args.purpose || 'both' });
    case 'asset.list':
      return await runtime.assets?.list?.();
    case 'generate.image':
      return await runtime.generate?.image?.({
        prompt: required(args.prompt, 'prompt'),
        projectId: args.projectId || args['project-id'],
        targetNodeId: args.targetNodeId || args['target-node-id'],
        aspectRatio: args['aspect-ratio'] || args.aspectRatio,
      });
    case 'generate.images.batch':
    case 'generate.images-batch': {
      const items = args.items || parseJsonOption(args.itemsJson, null);
      return await runtime.generate?.imagesBatch?.({
        items: required(items, 'items'),
        projectId: args.projectId || args['project-id'],
      });
    }
    case 'generate.video':
      return await runtime.generate?.video?.({
        prompt: required(args.prompt, 'prompt'),
        sourceImageIds: parseListOption(args['source-image-ids'] || args.sourceImageIds),
        sourceVideoIds: parseListOption(args['source-video-ids'] || args.sourceVideoIds),
        slots: args.slots || parseJsonOption(args.slotsJson || args['slots-json'], undefined),
        durationSec: parseOptionalNumber(args.durationSec ?? args['duration-sec'] ?? args.duration),
        aspectRatio: args['aspect-ratio'] || args.aspectRatio,
        resolution: args.resolution,
        generateAudio: parseOptionalBoolean(args.generateAudio ?? args['generate-audio']),
        watermark: parseOptionalBoolean(args.watermark),
        seed: parseOptionalNumber(args.seed),
      });
    case 'video.status':
      return await runtime.generate?.videoStatus?.({ jobId: required(args['job-id'] || args.jobId, 'job-id') });
    case 'export.project':
      return await runtime.export?.project?.({ format: args.format || 'json' });
    default:
      throw new Error(`Unknown Flovart command: ${commandName}`);
  }
}

export function planFlovartInput(rawInput, session = createFlovartSession()) {
  const parts = String(rawInput || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const command = parts[0];
  const args = parseCliArgs(parts.slice(1));
  session.lastTool = command;
  return {
    title: command,
    steps: [`Run deterministic Flovart tool: ${command}`],
    run: async ({ runtime }) => executeFlovartCommand(command, args, runtime),
  };
}
