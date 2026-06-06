export const COMMAND_REGISTRY = {
  help: { summary: 'Show human-readable command help.', args: {} },
  setup: { summary: 'Show CLI file-bridge setup steps.', args: {} },
  'command.list': { summary: 'List machine-readable atomic command metadata.', args: {} },
  'command.schema': { summary: 'Return one atomic command schema.', args: { command: 'string?' } },
  init: { summary: 'Write CLI helper config for a supported host.', args: { host: 'project|opencode|claude|cursor|windsurf|roo|vscode|all', projectDir: 'string?', dryRun: 'boolean?' } },
  doctor: { summary: 'Diagnose local Flovart CLI file-bridge setup without exposing secrets.', args: { projectDir: 'string?' } },
  'inspiration.search': { summary: 'Search curated Flovart prompt inspirations.', args: { query: 'string?', category: 'string?', limit: 'number?' } },
  'inspiration.get': { summary: 'Return one curated inspiration entry by ID.', args: { id: 'string' } },
  'prompt.enhance': { summary: 'Enhance a brief image/video prompt using Flovart agent preferences.', args: { prompt: 'string', style: 'string?', aspectRatio: 'string?', mode: 'image|video?' } },
  'batch.plan': { summary: 'Create a deterministic multi-shot generation plan from one brief.', args: { prompt: 'string', count: 'number?', aspectRatio: 'string?' } },
  'workflow.plan-video': { summary: 'Create a deterministic multi-shot video workflow graph from one brief.', args: { prompt: 'string', count: 'number?', aspectRatio: 'string?', durationSec: 'number?', imageModel: 'string?', videoModel: 'string?' } },
  'preferences.manage': { summary: 'Get, set, reset, or add favorite agent preferences.', args: { action: 'get|set|reset|add-favorite', style: 'string?', aspectRatio: 'string?', prompt: 'string?' } },
  'models.list': { summary: 'List agent-facing image/video model IDs routed through Flovart browser providers.', args: { purpose: 'image|video|all?' } },
  project: { summary: 'Show active Flovart project context summary.', args: {} },
  'project.create': { summary: 'Create a local Flovart project context.', args: { name: 'string?', projectUuid: 'string?', use: 'boolean?' } },
  'project.list': { summary: 'List local Flovart project contexts.', args: {} },
  'project.use': { summary: 'Use a Flovart project UUID and write .flovart/project.json context.', args: { projectUuid: 'string' } },
  'project.unuse': { summary: 'Clear active Flovart project context.', args: {} },
  group: { summary: 'Show active Flovart group context summary.', args: {} },
  'group.create': { summary: 'Create a local canvas group context.', args: { name: 'string?', groupNodeKey: 'string?', use: 'boolean?' } },
  'group.list': { summary: 'List local canvas groups in the active project.', args: {} },
  'group.use': { summary: 'Use a group context and write .flovart/project.json groupNodeKey.', args: { groupNodeKey: 'string' } },
  'group.unuse': { summary: 'Clear active group context.', args: {} },
  node: { summary: 'List canvas nodes or dispatch node subcommands.', args: { subcommand: 'create|list|delete|update|run?' } },
  'node.create': { summary: 'Create one canvas node with LibTV-style -t, -s, and -u options.', args: { type: 'image|video|text', name: 'string?', set: 'key=value[]?', update: 'key=value[]?', run: 'boolean?' } },
  'node.list': { summary: 'List canvas nodes, optionally filtered by type or active group.', args: { type: 'string?', all: 'boolean?' } },
  'node.delete': { summary: 'Delete one canvas node.', args: { id: 'string' } },
  'node.update': { summary: 'Patch one canvas node with -s generation params and -u data attrs.', args: { id: 'string', set: 'key=value[]?', update: 'key=value[]?' } },
  'node.run': { summary: 'Run or queue one media node generation.', args: { id: 'string' } },
  upload: { summary: 'Upload a local image or video into the active Flovart canvas context.', args: { path: 'string', type: 'image|video?', name: 'string?' } },
  model: { summary: 'List or inspect agent-facing model metadata.', args: { modelKey: 'string?' } },
  'model.search': { summary: 'Search agent-facing model IDs by capability and query.', args: { type: 'image|video|all?', query: 'string?' } },
  'image.shortcut.list': { summary: 'List deterministic image prompt shortcuts.', args: {} },
  'image.shortcut': { summary: 'Apply one image prompt shortcut to a canvas node.', args: { label: 'string', node: 'string', run: 'boolean?' } },
  'script.storyboard': { summary: 'Create storyboard image nodes from script text or a script node.', args: { script: 'string?', scriptNode: 'string?', count: 'number?', group: 'string?' } },
  status: { summary: 'Inspect runtime, provider, and media status.', args: {} },
  'provider.status': { summary: 'Inspect provider/model configuration without exposing keys.', args: {} },
  'provider.begin-setup': { summary: 'Open provider setup in the browser UI.', args: { provider: 'string?', purpose: 'image|video|both?' } },
  'provider.select-model': { summary: 'Select configured image/video/text model IDs.', args: { imageModel: 'string?', videoModel: 'string?', textModel: 'string?' } },
  'provider.test': { summary: 'Check provider readiness.', args: { purpose: 'image|video|both?' } },
  'element.create': { summary: 'Create one canvas element.', args: { id: 'string?', type: 'image|video|text', name: 'string?', x: 'number?', y: 'number?', width: 'number?', height: 'number?', href: 'string?', mimeType: 'string?' } },
  'element.update-prompt': { summary: 'Update one media prompt and hydrate @ references.', args: { elementId: 'string', textPrompt: 'string', modelId: 'string?' } },
  'element.assign-slot': { summary: 'Assign a referenced element to an explicit generation slot role.', args: { elementId: 'string', targetElementId: 'string', slotRole: 'first_frame|style_ref|control_net|unassigned' } },
  'element.ignite': { summary: 'Queue generation for one media element and return a job ID.', args: { elementId: 'string' } },
  'element.watch': { summary: 'Wait for one element to reach success/error.', args: { elementId: 'string', timeoutMs: 'number?' } },
  'canvas.inspect': { summary: 'Inspect full canvas, selection, viewport, media, and jobs.', args: {} },
  'canvas.list-media': { summary: 'List image/video elements only.', args: {} },
  'canvas.add-image': { summary: 'Add one image media element.', args: { href: 'string', mimeType: 'string?', name: 'string?', x: 'number?', y: 'number?', width: 'number?', height: 'number?' } },
  'canvas.add-video': { summary: 'Add one video media element.', args: { href: 'string', mimeType: 'string?', name: 'string?', x: 'number?', y: 'number?', width: 'number?', height: 'number?' } },
  'canvas.upload-image': { summary: 'Read a local image file and add it as a canvas media element.', args: { path: 'string', name: 'string?', x: 'number?', y: 'number?', width: 'number?', height: 'number?' } },
  'canvas.upload-video': { summary: 'Read a local video file and add it as a canvas media element.', args: { path: 'string', name: 'string?', x: 'number?', y: 'number?', width: 'number?', height: 'number?' } },
  'canvas.update-element': { summary: 'Patch one existing element with explicit JSON updates.', args: { id: 'string', updates: 'object' } },
  'canvas.remove-element': { summary: 'Remove one element by ID.', args: { id: 'string' } },
  'canvas.select': { summary: 'Replace current selection with explicit element IDs.', args: { ids: 'string[]' } },
  'canvas.clear-media': { summary: 'Remove image/video elements only.', args: {} },
  'workflow.inspect': { summary: 'Inspect current workflow graph, node configs, run state, and selected nodes.', args: {} },
  'workflow.load': { summary: 'Replace the current workflow graph with explicit nodes, edges, groups, and viewport.', args: { workflow: 'object', nodes: 'array?', edges: 'array?', groups: 'array?', viewport: 'object?' } },
  'workflow.update-node': { summary: 'Patch one workflow node config.', args: { nodeId: 'string', config: 'object' } },
  'workflow.run': { summary: 'Run the current workflow, a single node, or all downstream nodes from one node.', args: { scope: 'workflow|node|from-here?', nodeId: 'string?' } },
  'asset.list': { summary: 'List local generated media assets/history.', args: {} },
  'generate.image': { summary: 'Generate one image from an explicit prompt.', args: { prompt: 'string', aspectRatio: 'string?', placeOnCanvas: 'boolean?' } },
  'generate.images-batch': { summary: 'Generate multiple images from explicit prompt items.', args: { items: 'array', placeOnCanvas: 'boolean?', layout: 'string?' } },
  'generate.video': { summary: 'Generate one video from prompt and optional source image IDs.', args: { prompt: 'string', sourceImageIds: 'string[]?', durationSec: 'number?', aspectRatio: 'string?' } },
  'video.status': { summary: 'Query a video/runtime job status.', args: { jobId: 'string' } },
  'export.project': { summary: 'Export project metadata.', args: { format: 'json?' } },
};

export const COMMANDS = Object.keys(COMMAND_REGISTRY);

export const QUICK_COMMANDS = [
  'status',
  'provider.status',
  'canvas.inspect',
  'canvas.list-media',
  'asset.list',
  'models.list',
  'project',
  'project.list',
  'group.list',
  'node.list',
  'doctor',
  'preferences.manage',
  'inspiration.search',
  'setup',
];

export const HELP_TEXT = [
  'Flovart Agent Bridge exposes deterministic tools for external agents.',
  'Claude Code/Codex/OpenCode should do planning and call these commands with explicit arguments.',
  '',
  'Atomic aliases:',
  'inspect                                         Alias of canvas.inspect',
  'create <type> <name> <x> <y>                   Alias of element.create',
  'update-prompt <id> <text>                      Alias of element.update-prompt',
  'assign-slot <id> <targetId> <role>             Alias of element.assign-slot',
  'ignite <id>                                    Alias of element.ignite',
  'watch <id>                                     Alias of element.watch',
  '',
  'Commands:',
  'help                                            Show this help',
  'setup                                           Show CLI file-bridge setup steps',
  'init --host opencode|claude|cursor|windsurf|roo|vscode|all [--dry-run]',
  'doctor                                          Diagnose local CLI file-bridge setup',
  'command.list                                    List machine-readable atomic command metadata',
  'command.schema --command <name>                 Show one command schema',
  'inspiration.search --query <term>               Search curated inspiration prompts',
  'inspiration.get --id <id>                       Show one inspiration prompt',
  'prompt.enhance --prompt <text> [--style cinematic --mode image]',
  'batch.plan --prompt <text> [--count 4]          Build a batch generation plan',
  'preferences.manage --action get|set|reset|add-favorite',
  'models.list --purpose image|video|all           List agent-facing model IDs',
  'project create|list|use|unuse                    Manage local project context',
  'group create|list|use|unuse                      Manage local group context',
  'node create|list|update|delete|run               LibTV-style canvas node operations',
  'upload --path <file> [--type image|video]        Upload local media into canvas',
  'model search --type image --query flux           Search model IDs',
  'image.shortcut list                              List image shortcut prompts',
  'script.storyboard --script <text> --count 6      Create storyboard image nodes',
  'status                                          Inspect runtime status',
  'provider.status                                 Inspect provider/model configuration',
  'provider.begin-setup --provider <id> --purpose image|video|both',
  'provider.select-model --image-model <id> --video-model <id>',
  'provider.test                                   Check configured provider readiness',
  'element.create --type image|video|text --name <name> [--x 0 --y 0]',
  'element.update-prompt --element-id <id> --text-prompt <prompt>',
  'element.assign-slot --element-id <id> --target-element-id <id> --slot-role <role>',
  'element.ignite --element-id <id>                Run the selected media element in place',
  'element.watch --element-id <id>                 Wait for element terminal generation state',
  'canvas.inspect                                  Inspect canvas, selection, and viewport state',
  'canvas.list-media                               List image/video elements only',
  'canvas.add-image --href <data-or-url> --mime-type image/png [--name <name>]',
  'canvas.add-video --href <blob-or-url> --mime-type video/mp4 [--name <name>]',
  'canvas.update-element --id <id> --updates-json <json>',
  'canvas.remove-element --id <id>',
  'canvas.select --ids id1,id2',
  'canvas.clear-media                              Remove image/video elements only',
  'asset.list                                      List local generated media assets',
  'generate.image --prompt <prompt>                Generate one image',
  'generate.images-batch --file shots.json         Trigger multiple image generations',
  'generate.video --prompt <prompt> [--source-image-ids id1,id2]',
  'video.status --job-id <id>                      Query video job status',
  'export.project                                  Export project metadata when supported',
  '',
  'This CLI does not understand natural language. The external agent is the planner.',
].join('\n');

export const SETUP_TEXT = [
  'Flovart CLI file bridge setup:',
  '1. npm run dev',
  '2. Open the Flovart browser app from the dev server when a command needs provider execution',
  '3. npx flovart-cli status --json',
  '4. npx flovart-cli generate.image --prompt <prompt> --json',
  '',
  'API keys must be entered in the Flovart browser UI only. Do not paste secrets into AI agent transcripts.',
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
  const normalized = String(name).trim().replace(/-/g, '.');
  const aliases = {
    inspect: 'canvas.inspect',
    create: 'element.create',
    'update.prompt': 'element.update-prompt',
    'assign.slot': 'element.assign-slot',
    ignite: 'element.ignite',
    watch: 'element.watch',
    remove: 'canvas.remove-element',
    select: 'canvas.select',
    gen: 'generate.image',
    models: 'models.list',
    doctor: 'doctor',
    preferences: 'preferences.manage',
    prefs: 'preferences.manage',
    inspire: 'inspiration.search',
    enhance: 'prompt.enhance',
    plan: 'batch.plan',
  };
  return aliases[normalized] || normalized;
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
  return value.split(',').map(item => item.trim()).filter(Boolean);
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
      planVideoWorkflow: () => ({ ok: false, error: { code: 'UNSUPPORTED_RUNTIME', message: 'Workflow planning is only available in the Node CLI runtime.' } }),
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
      return { ok: true, commands: COMMAND_REGISTRY };
    case 'command.schema': {
      const requested = args.command || args.name;
      if (!requested) return { ok: true, commands: COMMAND_REGISTRY };
      const commandKey = findRegisteredCommand(requested);
      const schema = COMMAND_REGISTRY[commandKey];
      return schema
        ? { ok: true, command: commandKey, schema }
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
    case 'workflow.plan.video':
    case 'workflow.plan-video': {
      const { planVideoWorkflow } = await loadAgentKit();
      return planVideoWorkflow({
        prompt: required(args.prompt || args._?.join(' '), 'prompt'),
        count: args.count ? Number(args.count) : undefined,
        aspectRatio: args['aspect-ratio'] || args.aspectRatio,
        durationSec: args.duration ? Number(args.duration) : args['duration-sec'] ? Number(args['duration-sec']) : undefined,
        imageModel: args['image-model'] || args.imageModel,
        videoModel: args['video-model'] || args.videoModel,
        name: args.name,
        items: args.items || parseJsonOption(args.itemsJson, undefined),
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
    case 'project': {
      const subcommand = commandSubcommand(args, 'summary');
      if (subcommand === 'create') return await executeFlovartCommand('project.create', { ...args, _: args._?.slice(1) }, runtime);
      if (subcommand === 'list') return await executeFlovartCommand('project.list', args, runtime);
      if (subcommand === 'use') return await executeFlovartCommand('project.use', { ...args, projectUuid: args.projectUuid || args.uuid || args.p || args._?.[1] }, runtime);
      if (subcommand === 'unuse') return await executeFlovartCommand('project.unuse', args, runtime);
      return await runtime.project?.summary?.() || { ok: false, error: 'project unavailable' };
    }
    case 'project.create':
      return await runtime.project?.create?.({
        projectUuid: args['project-uuid'] || args.projectUuid || args.uuid || args.id,
        name: args.name || args.n || args._?.[0],
        description: args.description,
        use: args.use,
      }) || { ok: false, error: 'project.create unavailable' };
    case 'project.list':
      return await runtime.project?.list?.() || { ok: false, error: 'project.list unavailable' };
    case 'project.use':
      return await runtime.project?.use?.({
        projectUuid: required(args['project-uuid'] || args.projectUuid || args.uuid || args.id || args.p || args._?.[0], 'project-uuid'),
        name: args.name || args.n,
      }) || { ok: false, error: 'project.use unavailable' };
    case 'project.unuse':
      return await runtime.project?.unuse?.() || { ok: false, error: 'project.unuse unavailable' };
    case 'group': {
      const subcommand = commandSubcommand(args, 'summary');
      if (subcommand === 'create') return await executeFlovartCommand('group.create', { ...args, _: args._?.slice(1) }, runtime);
      if (subcommand === 'list') return await executeFlovartCommand('group.list', args, runtime);
      if (subcommand === 'use') return await executeFlovartCommand('group.use', { ...args, groupNodeKey: args.groupNodeKey || args.key || args.g || args._?.[1] }, runtime);
      if (subcommand === 'unuse') return await executeFlovartCommand('group.unuse', args, runtime);
      return await runtime.group?.summary?.() || { ok: false, error: 'group unavailable' };
    }
    case 'group.create':
      return await runtime.group?.create?.({
        groupNodeKey: args['group-node-key'] || args.groupNodeKey || args.key || args.id,
        projectUuid: args['project-uuid'] || args.projectUuid || args.p,
        name: args.name || args.n || args._?.[0],
        x: args.x,
        y: args.y,
        use: args.use,
      }) || { ok: false, error: 'group.create unavailable' };
    case 'group.list':
      return await runtime.group?.list?.() || { ok: false, error: 'group.list unavailable' };
    case 'group.use':
      return await runtime.group?.use?.({
        groupNodeKey: required(args['group-node-key'] || args.groupNodeKey || args.key || args.id || args.g || args._?.[0], 'group-node-key'),
      }) || { ok: false, error: 'group.use unavailable' };
    case 'group.unuse':
      return await runtime.group?.unuse?.() || { ok: false, error: 'group.unuse unavailable' };
    case 'node': {
      const subcommand = commandSubcommand(args, 'list');
      if (subcommand === 'create') return await executeFlovartCommand('node.create', { ...args, _: args._?.slice(1) }, runtime);
      if (subcommand === 'list') return await executeFlovartCommand('node.list', args, runtime);
      if (subcommand === 'delete' || subcommand === 'remove') return await executeFlovartCommand('node.delete', { ...args, id: args.id || args._?.[1] }, runtime);
      if (subcommand === 'update') return await executeFlovartCommand('node.update', { ...args, id: args.id || args._?.[1] }, runtime);
      if (subcommand === 'run') return await executeFlovartCommand('node.run', { ...args, id: args.id || args._?.[1] }, runtime);
      return await executeFlovartCommand('node.list', args, runtime);
    }
    case 'node.create': {
      const { set, update } = buildNodeUpdates(args);
      const type = nodeTypeArg(args);
      const created = await runtime.element?.create?.({
        id: args.id,
        type,
        name: nodeNameArg(args),
        x: args.x !== undefined ? Number(args.x) : undefined,
        y: args.y !== undefined ? Number(args.y) : undefined,
        width: args.width !== undefined ? Number(args.width) : undefined,
        height: args.height !== undefined ? Number(args.height) : undefined,
        href: args.href,
        mimeType: args.mimeType || args['mime-type'],
      });
      if (!created?.ok) return created || { ok: false, error: 'node.create unavailable' };
      let node = created.element;
      if (Object.keys(update).length > 0) {
        const patched = await runtime.canvas?.updateElement?.(created.id, update);
        if (patched?.ok) node = patched.element;
      }
      if ((set.prompt || set.model) && (type === 'image' || type === 'video')) {
        const prompted = await runtime.element?.updatePrompt?.({
          elementId: created.id,
          textPrompt: String(set.prompt || ''),
          modelId: set.model || set.modelId,
        });
        if (prompted?.ok) node = (await runtime.canvas?.inspect?.())?.elements?.find((item) => item.id === created.id) || node;
      }
      const run = args.run === true || args.run === 'true';
      const runResult = run ? await runtime.element?.ignite?.({ elementId: created.id }) : null;
      return { ok: true, shadow: created.shadow, id: created.id, node, run: runResult };
    }
    case 'node.list': {
      const inspected = await runtime.canvas?.inspect?.();
      if (!inspected?.ok) return inspected || { ok: false, error: 'node.list unavailable' };
      const context = inspected.context || {};
      const type = args.type || args.t;
      const showAll = args.all === true || args.all === 'true';
      const nodes = (inspected.elements || []).filter((node) => {
        if (type && node.type !== type) return false;
        if (!showAll && context.projectUuid && node.projectUuid && node.projectUuid !== context.projectUuid) return false;
        if (!showAll && context.groupNodeKey && node.groupNodeKey && node.groupNodeKey !== context.groupNodeKey) return false;
        return true;
      });
      return { ok: true, shadow: inspected.shadow, nodes, context };
    }
    case 'node.update': {
      const id = required(nodeIdArg(args), 'id');
      const { set, update } = buildNodeUpdates(args);
      const normalizedUpdate = { ...update };
      if (normalizedUpdate.content !== undefined && normalizedUpdate.text === undefined) normalizedUpdate.text = Array.isArray(normalizedUpdate.content) ? normalizedUpdate.content.join('\n') : String(normalizedUpdate.content);
      let patched = Object.keys(normalizedUpdate).length > 0
        ? await runtime.canvas?.updateElement?.(id, normalizedUpdate)
        : null;
      if (set.prompt !== undefined || set.model !== undefined || set.modelId !== undefined) {
        const prompted = await runtime.element?.updatePrompt?.({
          elementId: id,
          textPrompt: String(set.prompt || ''),
          modelId: set.model || set.modelId,
        });
        if (prompted?.ok) patched = { ok: true };
      }
      const inspected = await runtime.canvas?.inspect?.();
      const node = inspected?.elements?.find((item) => item.id === id);
      return node ? { ok: true, shadow: inspected.shadow, id, node } : (patched || { ok: false, error: { code: 'NOT_FOUND', message: `node not found (${id})` } });
    }
    case 'node.delete':
      return await runtime.canvas?.removeElement?.(required(nodeIdArg(args), 'id')) || { ok: false, error: 'node.delete unavailable' };
    case 'node.run':
      return await runtime.element?.ignite?.({ elementId: required(nodeIdArg(args), 'id') }) || { ok: false, error: 'node.run unavailable' };
    case 'upload': {
      const { prepareMediaUpload } = await loadAgentKit();
      const prepared = prepareMediaUpload({ ...args, path: args.path || args.file || args._?.[0], type: args.type || args.t, name: args.name || args.n });
      if (prepared.ok === false) return prepared;
      const result = prepared.type === 'video'
        ? await runtime.canvas?.addVideo?.(prepared.element)
        : await runtime.canvas?.addImage?.(prepared.element);
      return result ? { ...result, filePath: prepared.filePath, mediaType: prepared.type } : { ok: false, error: 'upload unavailable' };
    }
    case 'image.shortcut.list':
      return { ok: true, shortcuts: IMAGE_SHORTCUTS };
    case 'image.shortcut': {
      const label = args.label || args.shortcut || args._?.[0];
      if (label === 'list') return { ok: true, shortcuts: IMAGE_SHORTCUTS };
      const shortcut = IMAGE_SHORTCUTS.find((item) => item.id === label || item.label === label);
      if (!shortcut) return { ok: false, error: { code: 'NOT_FOUND', message: `image shortcut not found: ${label}` } };
      const id = required(nodeIdArg(args), 'node');
      const prompted = await runtime.element?.updatePrompt?.({ elementId: id, textPrompt: shortcut.prompt });
      if (!prompted?.ok) return prompted || { ok: false, error: 'image.shortcut unavailable' };
      const run = args.run === true || args.run === 'true';
      const runResult = run ? await runtime.element?.ignite?.({ elementId: id }) : null;
      const node = (await runtime.canvas?.inspect?.())?.elements?.find((item) => item.id === id);
      return { ok: true, shortcut, id, node, run: runResult };
    }
    case 'script.storyboard': {
      const scriptNodeId = args['script-node'] || args.scriptNode || args.node;
      let script = args.script || args.text;
      if (!script && scriptNodeId) {
        const inspected = await runtime.canvas?.inspect?.();
        script = inspected?.elements?.find((item) => item.id === scriptNodeId)?.text;
      }
      script = required(script, 'script');
      if (args.group && runtime.group?.create) await runtime.group.create({ name: args.group, use: true });
      const lines = splitStoryboardScript(script, args.count);
      const shots = [];
      for (let index = 0; index < lines.length; index += 1) {
        const name = `storyboard-${String(index + 1).padStart(2, '0')}`;
        const created = await executeFlovartCommand('node.create', {
          type: 'image',
          name,
          x: 840 + (index % 3) * 360,
          y: 120 + Math.floor(index / 3) * 240,
          width: 320,
          height: 180,
          s: [`prompt=Storyboard frame ${index + 1}: ${lines[index]}. Cinematic composition, clear action, production keyframe.`],
        }, runtime);
        shots.push(created.node);
      }
      return { ok: true, shadow: true, count: shots.length, shots };
    }
    case 'status':
      return await runtime.status?.() || {
        ok: true,
        runtime: runtime._version || 'unknown',
        mediaElements: await runtime.canvas?.listMedia?.(),
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
    case 'element.create': {
      const type = required(args.type, 'type');
      if (runtime.element?.create) {
        return await runtime.element.create({
          id: args.id,
          type,
          name: args.name,
          x: args.x !== undefined ? Number(args.x) : undefined,
          y: args.y !== undefined ? Number(args.y) : undefined,
          width: args.width !== undefined ? Number(args.width) : undefined,
          height: args.height !== undefined ? Number(args.height) : undefined,
          href: args.href,
          mimeType: args.mimeType || args['mime-type'],
        });
      }
      return await runtime.canvas?.addElement?.({
        id: args.id,
        type,
        name: args.name,
        x: args.x !== undefined ? Number(args.x) : undefined,
        y: args.y !== undefined ? Number(args.y) : undefined,
        width: args.width !== undefined ? Number(args.width) : undefined,
        height: args.height !== undefined ? Number(args.height) : undefined,
        href: args.href,
        mimeType: args.mimeType || args['mime-type'],
      });
    }
    case 'element.update.prompt':
    case 'element.update-prompt':
      return await runtime.element?.updatePrompt?.({
        elementId: required(args['element-id'] || args.elementId, 'element-id'),
        textPrompt: required(args['text-prompt'] || args.textPrompt, 'text-prompt'),
        modelId: args['model-id'] || args.modelId,
      }) || { ok: false, error: 'element.update-prompt unavailable' };
    case 'element.assign.slot':
    case 'element.assign-slot':
      return await runtime.element?.assignSlot?.({
        elementId: required(args['element-id'] || args.elementId, 'element-id'),
        targetElementId: required(args['target-element-id'] || args.targetElementId, 'target-element-id'),
        slotRole: required(args['slot-role'] || args.slotRole, 'slot-role'),
      }) || { ok: false, error: 'element.assign-slot unavailable' };
    case 'element.ignite':
      return await runtime.element?.ignite?.({
        elementId: required(args['element-id'] || args.elementId, 'element-id'),
      }) || { ok: false, error: 'element.ignite unavailable' };
    case 'element.watch':
      return await runtime.element?.watch?.({
        elementId: required(args['element-id'] || args.elementId, 'element-id'),
        timeoutMs: args.timeout ? Number(args.timeout) : undefined,
      }) || { ok: false, error: 'element.watch unavailable' };
    case 'canvas.inspect':
      return await runtime.canvas?.inspect?.() || {
        ok: true,
        elements: await runtime.canvas?.getElements?.(),
        media: await runtime.canvas?.listMedia?.(),
      };
    case 'canvas.list.media':
    case 'canvas.list-media':
      return await runtime.canvas?.listMedia?.();
    case 'canvas.add.image':
    case 'canvas.add-image':
      return await runtime.canvas?.addImage?.(mediaElementFromArgs(args, 'image'));
    case 'canvas.add.video':
    case 'canvas.add-video':
      return await runtime.canvas?.addVideo?.(mediaElementFromArgs(args, 'video'));
    case 'canvas.upload.image':
    case 'canvas.upload-image': {
      const { prepareMediaUpload } = await loadAgentKit();
      const prepared = prepareMediaUpload({ ...args, type: 'image', path: args.path || args.file || args.filePath || args._?.[0] });
      if (prepared.ok === false) return prepared;
      return await runtime.canvas?.addImage?.(prepared.element) || { ok: false, error: 'canvas.upload-image unavailable' };
    }
    case 'canvas.upload.video':
    case 'canvas.upload-video': {
      const { prepareMediaUpload } = await loadAgentKit();
      const prepared = prepareMediaUpload({ ...args, type: 'video', path: args.path || args.file || args.filePath || args._?.[0] });
      if (prepared.ok === false) return prepared;
      return await runtime.canvas?.addVideo?.(prepared.element) || { ok: false, error: 'canvas.upload-video unavailable' };
    }
    case 'canvas.update.element':
    case 'canvas.update-element':
      return await runtime.canvas?.updateElement?.(
        required(args.id, 'id'),
        updatePayloadFromArgs(args),
      ) || { ok: false, error: 'canvas.update-element unavailable' };
    case 'canvas.remove.element':
    case 'canvas.remove-element':
      return await runtime.canvas?.removeElement?.(required(args.id, 'id')) || { ok: false, error: 'canvas.remove-element unavailable' };
    case 'canvas.select':
      return await runtime.canvas?.select?.(parseListOption(args.ids || args['ids'])) || { ok: false, error: 'canvas.select unavailable' };
    case 'canvas.clear.media':
    case 'canvas.clear-media':
      return await runtime.canvas?.clearMedia?.();
    case 'workflow.inspect':
      return await runtime.workflow?.inspect?.() || { ok: false, error: 'workflow.inspect unavailable' };
    case 'workflow.load': {
      const workflow = args.workflow || parseJsonOption(args.workflowJson || args['workflow-json'], null) || {
        nodes: args.nodes || parseJsonOption(args.nodesJson || args['nodes-json'], []),
        edges: args.edges || parseJsonOption(args.edgesJson || args['edges-json'], []),
        groups: args.groups || parseJsonOption(args.groupsJson || args['groups-json'], []),
        viewport: args.viewport || parseJsonOption(args.viewportJson || args['viewport-json'], undefined),
      };
      return await runtime.workflow?.load?.(workflow) || { ok: false, error: 'workflow.load unavailable' };
    }
    case 'workflow.update.node':
    case 'workflow.update-node': {
      const config = args.config || parseJsonOption(args.configJson || args['config-json'], null) || updatePayloadFromArgs(args);
      return await runtime.workflow?.updateNode?.(required(args['node-id'] || args.nodeId || args.id, 'node-id'), config) || { ok: false, error: 'workflow.update-node unavailable' };
    }
    case 'workflow.run':
      return await runtime.workflow?.run?.({
        scope: args.scope || 'workflow',
        nodeId: args['node-id'] || args.nodeId || args.id,
      }) || { ok: false, error: 'workflow.run unavailable' };
    case 'asset.list':
      return await runtime.assets?.list?.();
    case 'generate.image':
      return await runtime.generate?.image?.({
        prompt: required(args.prompt, 'prompt'),
        aspectRatio: args['aspect-ratio'] || args.aspectRatio,
        placeOnCanvas: args['place-on-canvas'] !== 'false',
      });
    case 'generate.images.batch':
    case 'generate.images-batch': {
      const items = args.items || parseJsonOption(args.itemsJson, null);
      return await runtime.generate?.imagesBatch?.({
        items: required(items, 'items'),
        placeOnCanvas: args['place-on-canvas'] !== 'false',
        layout: args.layout || 'grid',
      });
    }
    case 'generate.video':
      return await runtime.generate?.video?.({
        prompt: required(args.prompt, 'prompt'),
        sourceImageIds: typeof args['source-image-ids'] === 'string' ? args['source-image-ids'].split(',').filter(Boolean) : [],
        durationSec: args.duration ? Number(args.duration) : undefined,
        aspectRatio: args['aspect-ratio'] || args.aspectRatio,
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
