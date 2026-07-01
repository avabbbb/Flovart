import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, basename, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = process.env.FLOVART_AGENT_CONFIG_DIR || join(process.env.APPDATA || process.env.HOME || homedir(), 'Flovart');
const PREFS_FILE = join(CONFIG_DIR, 'agent-preferences.json');

const SEEDANCE2_MODELS = ['doubao-seedance-2.0', 'seedance-2.0', 'dreamina-seedance-2-0-260128', 'doubao-seedance-2-0-260128'];
const SEEDANCE2_REQUIREMENTS = {
  provider: 'volcengine',
  models: SEEDANCE2_MODELS,
  slots: { image: 9, video: 3, audio: 3 },
  durationSec: { min: 4, max: 15 },
  resolutions: ['480p', '720p', '1080p'],
  videoAudioReferenceUrls: 'public-url-or-asset',
};

const STYLE_PRESETS = {
  cinematic: 'cinematic composition, expressive lighting, controlled contrast, production design details',
  product: 'premium product photography, clean surface, controlled reflections, commercial lighting',
  editorial: 'editorial art direction, strong composition, refined color palette, magazine-quality finish',
  anime: 'anime illustration, clean linework, expressive pose, polished color design',
  minimal: 'minimal composition, restrained palette, generous negative space, precise visual hierarchy',
};

const MIME_BY_EXTENSION = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

const INSPIRATION_LIBRARY = [
  {
    id: 'product-hero-luxury',
    category: 'Product & Brand',
    title: 'Luxury Product Hero',
    tags: ['product', 'commercial', 'luxury', 'studio'],
    prompt: 'A premium product hero shot on a polished stone plinth, controlled studio reflections, soft rim light, subtle atmospheric haze, elegant monochrome background, high-end commercial photography.',
  },
  {
    id: 'character-consistency-board',
    category: 'Character & Storyboard',
    title: 'Character Consistency Board',
    tags: ['character', 'storyboard', 'reference'],
    prompt: 'A clean character reference board showing the same character in three poses, consistent face, hairstyle, costume, proportions, neutral background, production-ready concept art.',
  },
  {
    id: 'cinematic-keyframe',
    category: 'Video Keyframe',
    title: 'Cinematic Keyframe',
    tags: ['cinematic', 'video', 'keyframe', 'lighting'],
    prompt: 'A cinematic keyframe with a clear foreground subject, layered depth, motivated practical lighting, atmospheric particles, strong silhouette, anamorphic framing, film still quality.',
  },
  {
    id: 'app-launch-visual',
    category: 'Marketing',
    title: 'App Launch Visual',
    tags: ['marketing', 'saas', 'launch', 'visual'],
    prompt: 'A bold launch campaign visual for an AI creative tool, abstract canvas interface forms, luminous gradients, crisp typography-safe negative space, premium SaaS brand direction.',
  },
  {
    id: 'environment-establishing-shot',
    category: 'Scene & Environment',
    title: 'Establishing Shot',
    tags: ['environment', 'scene', 'worldbuilding'],
    prompt: 'A wide establishing shot of a richly detailed environment, clear focal path, layered architecture, weather and atmosphere, believable scale, cinematic worldbuilding concept art.',
  },
  {
    id: 'social-poster-bold',
    category: 'Social Poster',
    title: 'Bold Social Poster',
    tags: ['poster', 'social', 'graphic'],
    prompt: 'A high-impact social poster composition with a strong central visual metaphor, bold color blocking, clean layout, readable empty space for headline text, modern graphic design style.',
  },
];

function ensureParent(filePath) {
  const parent = dirname(filePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureParent(filePath);
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function shadowStateFile() {
  return process.env.FLOVART_SHADOW_STATE_FILE
    || join(process.env.LOCALAPPDATA || process.cwd(), 'Flovart', 'shadow-runtime-state.json');
}

function readShadowStateSnapshot() {
  const file = shadowStateFile();
  const state = readJson(file, null);
  return { exists: existsSync(file), file, state };
}

function providerSnapshot(provider = {}) {
  const snapshot = {
    configured: { image: false, video: false, text: false, ...(provider.configured || {}) },
    selectedModels: {
      image: 'flux-schnell',
      video: 'doubao-seedance-2.0',
      text: 'gpt-4.1-mini',
      ...(provider.selectedModels || {}),
    },
    providers: Array.isArray(provider.providers) ? provider.providers : [],
  };
  if (snapshot.selectedModels.video === 'kling-v2' && !snapshot.configured.video && snapshot.providers.length === 0) {
    snapshot.selectedModels.video = 'doubao-seedance-2.0';
  }
  return snapshot;
}

function diagnoseSeedance2(provider) {
  const videoModel = String(provider.selectedModels.video || '');
  const normalizedModel = videoModel.toLowerCase();
  const modelOk = SEEDANCE2_MODELS.includes(normalizedModel) || normalizedModel.includes('seedance');
  const providerOk = !!provider.configured.video;
  const checks = [
    {
      id: 'video.providerConfigured',
      ok: providerOk,
      model: videoModel,
      message: providerOk ? 'Video provider credential is configured.' : 'Video provider credential is missing.',
      nextAction: providerOk ? undefined : 'provider.begin-setup --provider volcengine --purpose video',
    },
    {
      id: 'video.seedance2Model',
      ok: modelOk,
      model: videoModel,
      expectedModels: SEEDANCE2_MODELS,
      message: modelOk ? 'Seedance 2.0 model is selected.' : 'Selected video model is not a Seedance 2.0 model.',
      nextAction: modelOk ? undefined : 'provider.select-model --video-model doubao-seedance-2.0',
    },
    {
      id: 'seedance2.multimodalLimits',
      ok: true,
      slots: SEEDANCE2_REQUIREMENTS.slots,
      durationSec: SEEDANCE2_REQUIREMENTS.durationSec,
      resolutions: SEEDANCE2_REQUIREMENTS.resolutions,
      videoAudioReferenceUrls: SEEDANCE2_REQUIREMENTS.videoAudioReferenceUrls,
      message: 'Seedance 2.0 gateway supports image, video, and audio reference slots.',
    },
  ];
  return {
    ok: checks.every(check => check.ok),
    provider: SEEDANCE2_REQUIREMENTS.provider,
    model: videoModel,
    requirements: SEEDANCE2_REQUIREMENTS,
    checks,
    nextActions: checks.filter(check => !check.ok && check.nextAction).map(check => check.nextAction),
  };
}

function diagnoseGenerationSurfaces(shadowSnapshot, seedance2) {
  const state = shadowSnapshot.state || {};
  const elements = Array.isArray(state.elements) ? state.elements : [];
  const workflowProjects = Array.isArray(state.workflowProjects) ? state.workflowProjects : [];
  const providerReady = seedance2.ok;
  return {
    canvas: {
      ok: providerReady,
      commandSurface: true,
      providerBackedGenerationReady: providerReady,
      browserRequired: true,
      mediaElements: elements.filter(item => item.type === 'image' || item.type === 'video').length,
      commands: ['element.create', 'element.update-prompt', 'element.assign-slot', 'element.ignite', 'generate.video'],
    },
    workflow: {
      ok: providerReady,
      commandSurface: true,
      providerBackedGenerationReady: providerReady,
      browserRequired: true,
      projectCount: workflowProjects.length,
      activeProjectId: state.activeWorkflowProjectId || null,
      commands: ['workflow.project.create', 'workflow.node.create', 'workflow.connect', 'workflow.node.run'],
    },
  };
}

function defaultPreferences() {
  return {
    style: 'cinematic',
    aspectRatio: '16:9',
    imageModel: 'flux-schnell',
    videoModel: 'doubao-seedance-2.0',
    styleNotes: '',
    favoritePrompts: [],
    updatedAt: Date.now(),
  };
}

export function manageAgentPreferences(input = {}) {
  const action = input.action || 'get';
  const current = { ...defaultPreferences(), ...readJson(PREFS_FILE, {}) };

  if (action === 'get') {
    return { ok: true, preferences: current, file: PREFS_FILE };
  }

  if (action === 'set') {
    const next = {
      ...current,
      ...(input.style !== undefined ? { style: String(input.style) } : {}),
      ...(input.aspectRatio !== undefined ? { aspectRatio: String(input.aspectRatio) } : {}),
      ...(input.imageModel !== undefined ? { imageModel: String(input.imageModel) } : {}),
      ...(input.videoModel !== undefined ? { videoModel: String(input.videoModel) } : {}),
      ...(input.styleNotes !== undefined ? { styleNotes: String(input.styleNotes) } : {}),
      updatedAt: Date.now(),
    };
    writeJson(PREFS_FILE, next);
    return { ok: true, preferences: next, file: PREFS_FILE };
  }

  if (action === 'add-favorite') {
    const prompt = String(input.prompt || '').trim();
    if (!prompt) return { ok: false, error: { code: 'BAD_REQUEST', message: 'prompt is required' } };
    const next = {
      ...current,
      favoritePrompts: [
        { id: `fav_${Date.now().toString(36)}`, title: input.title || prompt.slice(0, 64), prompt, createdAt: Date.now() },
        ...(Array.isArray(current.favoritePrompts) ? current.favoritePrompts : []),
      ].slice(0, 50),
      updatedAt: Date.now(),
    };
    writeJson(PREFS_FILE, next);
    return { ok: true, preferences: next, file: PREFS_FILE };
  }

  if (action === 'reset') {
    const next = defaultPreferences();
    writeJson(PREFS_FILE, next);
    return { ok: true, preferences: next, file: PREFS_FILE };
  }

  return { ok: false, error: { code: 'BAD_REQUEST', message: `unknown preferences action: ${action}` } };
}

export function searchInspiration(input = {}) {
  const query = String(input.query || '').trim().toLowerCase();
  const category = String(input.category || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(Number(input.limit || 6), 20));
  const items = INSPIRATION_LIBRARY.filter(item => {
    const haystack = [item.id, item.category, item.title, item.prompt, ...item.tags].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!category || item.category.toLowerCase().includes(category));
  }).slice(0, limit);
  return { ok: true, query, category, items, total: items.length };
}

export function getInspiration(input = {}) {
  const id = String(input.id || '').trim();
  const item = INSPIRATION_LIBRARY.find(entry => entry.id === id);
  return item ? { ok: true, item } : { ok: false, error: { code: 'NOT_FOUND', message: `inspiration not found: ${id}` } };
}

export function enhancePrompt(input = {}) {
  const raw = String(input.prompt || '').trim();
  if (!raw) return { ok: false, error: { code: 'BAD_REQUEST', message: 'prompt is required' } };
  const prefs = manageAgentPreferences({ action: 'get' }).preferences;
  const style = String(input.style || prefs.style || 'cinematic').toLowerCase();
  const styleText = STYLE_PRESETS[style] || STYLE_PRESETS.cinematic;
  const aspectRatio = String(input.aspectRatio || prefs.aspectRatio || '16:9');
  const mode = String(input.mode || 'image');
  const subjectLine = raw.endsWith('.') ? raw : `${raw}.`;
  const notes = [input.styleNotes, prefs.styleNotes].filter(Boolean).join(' ');
  const enhanced = [
    subjectLine,
    `Style direction: ${styleText}.`,
    mode === 'video'
      ? 'Motion direction: clear subject movement, stable camera intention, readable start and end frame, no chaotic cuts.'
      : 'Image direction: strong focal point, coherent composition, polished details, production-ready finish.',
    `Aspect ratio: ${aspectRatio}.`,
    notes ? `Additional constraints: ${notes}.` : '',
  ].filter(Boolean).join(' ');
  return { ok: true, prompt: raw, enhancedPrompt: enhanced, style, aspectRatio, mode };
}

export function listAgentModels(input = {}) {
  const prefs = manageAgentPreferences({ action: 'get' }).preferences;
  const purpose = input.purpose || 'all';
  const models = {
    image: [
      { id: 'flux-schnell', label: 'Flux Schnell', routing: 'browser-provider', selected: prefs.imageModel === 'flux-schnell' },
      { id: 'gpt-image-2', label: 'GPT Image 2', routing: 'browser-provider', selected: prefs.imageModel === 'gpt-image-2' },
      { id: 'imagen', label: 'Imagen', routing: 'browser-provider', selected: prefs.imageModel === 'imagen' },
    ],
    video: [
      { id: 'doubao-seedance-2.0', label: 'Seedance 2.0 · Volcengine', routing: 'browser-provider', provider: 'volcengine', capability: 'video', slots: { image: 9, video: 3, audio: 3 }, durationSec: { min: 4, max: 15 }, resolutions: ['480p', '720p', '1080p'], selected: prefs.videoModel === 'doubao-seedance-2.0' },
      { id: 'seedance-2.0', label: 'Seedance 2.0 · Alias', routing: 'browser-provider', provider: 'volcengine', capability: 'video', slots: { image: 9, video: 3, audio: 3 }, durationSec: { min: 4, max: 15 }, resolutions: ['480p', '720p', '1080p'], selected: prefs.videoModel === 'seedance-2.0' },
      { id: 'dreamina-seedance-2-0-260128', label: 'Seedance 2.0 · Dreamina Ark', routing: 'browser-provider', provider: 'volcengine', capability: 'video', slots: { image: 9, video: 3, audio: 3 }, durationSec: { min: 4, max: 15 }, resolutions: ['480p', '720p', '1080p'], selected: prefs.videoModel === 'dreamina-seedance-2-0-260128' },
      { id: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0 · Doubao Ark', routing: 'browser-provider', provider: 'volcengine', capability: 'video', slots: { image: 9, video: 3, audio: 3 }, durationSec: { min: 4, max: 15 }, resolutions: ['480p', '720p', '1080p'], selected: prefs.videoModel === 'doubao-seedance-2-0-260128' },
      { id: 'kling-v2', label: 'Kling v2', routing: 'browser-provider', provider: 'keling', capability: 'video', selected: prefs.videoModel === 'kling-v2' },
      { id: 'veo-3.1-generate-preview', label: 'Veo 3.1', routing: 'browser-provider', provider: 'google', capability: 'video', selected: prefs.videoModel === 'veo-3.1-generate-preview' },
    ],
  };
  return { ok: true, purpose, models: purpose === 'image' ? { image: models.image } : purpose === 'video' ? { video: models.video } : models };
}

function cliServerConfig(projectDir = process.cwd()) {
  return {
    command: 'node',
    args: [resolve(projectDir, 'tools/flovart/cli.js')],
  };
}

const HOSTS = {
  project: { name: 'Project CLI', path: '.cli.json', wrapperKey: 'cliServers' },
  opencode: { name: 'OpenCode', path: '.cli.json', wrapperKey: 'cliServers' },
  claude: { name: 'Claude Code', path: '.cli.json', wrapperKey: 'cliServers' },
  cursor: { name: 'Cursor', path: '.cursor/cli.json', wrapperKey: 'cliServers' },
  windsurf: { name: 'Windsurf', path: join(homedir(), '.codeium', 'windsurf', 'cli_config.json'), wrapperKey: 'cliServers', global: true },
  roo: { name: 'Roo Code', path: '.roo/cli.json', wrapperKey: 'cliServers' },
  vscode: { name: 'VS Code / GitHub Copilot', path: '.vscode/cli.json', wrapperKey: 'servers', needsType: true },
};

function hostConfigPath(hostConfig, projectDir) {
  if (hostConfig.global || isAbsolute(hostConfig.path)) return hostConfig.path;
  return join(projectDir, hostConfig.path);
}

function serverEntryForHost(hostConfig, projectDir) {
  const entry = cliServerConfig(projectDir);
  return hostConfig.needsType ? { type: 'stdio', ...entry } : entry;
}

function mergeCliJson(filePath, wrapperKey, serverConfig) {
  const current = readJson(filePath, {});
  const next = {
    ...current,
    [wrapperKey]: {
      ...(current[wrapperKey] || {}),
      flovart: serverConfig,
    },
  };
  writeJson(filePath, next);
  return next;
}

export function initCliHost(input = {}) {
  const host = String(input.host || 'project').toLowerCase();
  const projectDir = resolve(String(input.projectDir || process.cwd()));
  const dryRun = input.dryRun === true || input['dry-run'] === true;
  const selected = host === 'all'
    ? Object.entries(HOSTS).filter(([key]) => key !== 'project' && key !== 'opencode')
    : [[host, HOSTS[host]]].filter(([, value]) => value);

  if (selected.length === 0) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: `unsupported host: ${host}` } };
  }

  const writes = selected.map(([key, hostConfig]) => {
    const filePath = hostConfigPath(hostConfig, projectDir);
    const server = serverEntryForHost(hostConfig, projectDir);
    const config = dryRun
      ? { [hostConfig.wrapperKey]: { flovart: server } }
      : mergeCliJson(filePath, hostConfig.wrapperKey, server);
    return { host: key, name: hostConfig.name, filePath, wrapperKey: hostConfig.wrapperKey, server, config, dryRun };
  });

  return {
    ok: true,
    host,
    projectDir,
    writes,
    nextSteps: [
      'Start the Vite app: npm run dev',
      'Open the Flovart browser app from the dev server when provider-backed generation needs to run.',
      'Restart the host so it reloads the Flovart CLI config.',
    ],
  };
}

export function diagnoseAgentSetup(input = {}) {
  const projectDir = resolve(String(input.projectDir || process.cwd()));
  const cliPath = resolve(projectDir, 'tools/flovart/cli.js');
  const packagePath = resolve(projectDir, 'package.json');
  const checks = [
    { id: 'package', ok: existsSync(packagePath), detail: packagePath },
    { id: 'cli', ok: existsSync(cliPath), detail: cliPath },
    { id: 'preferences', ok: existsSync(PREFS_FILE), detail: PREFS_FILE, optional: true },
  ];
  const hostConfigs = Object.entries(HOSTS).map(([key, hostConfig]) => {
    const filePath = hostConfigPath(hostConfig, projectDir);
    const config = readJson(filePath, null);
    const wrapper = config?.[hostConfig.wrapperKey];
    return {
      host: key,
      name: hostConfig.name,
      filePath,
      exists: existsSync(filePath),
      configured: !!wrapper?.flovart,
      wrapperKey: hostConfig.wrapperKey,
    };
  });
  const shadowState = readShadowStateSnapshot();
  const provider = providerSnapshot(shadowState.state?.provider);
  const seedance2 = diagnoseSeedance2(provider);
  const surfaces = diagnoseGenerationSurfaces(shadowState, seedance2);
  const nextSteps = Array.from(new Set([
    'Run npm run flovart:cli -- status --json to verify local file-state runtime.',
    'Run npm run flovart:cli -- init --host <host> to write missing CLI config.',
    ...seedance2.nextActions,
    'Run npm run dev and keep the browser app open for provider-backed generation.',
  ]));
  return {
    ok: checks.every(check => check.ok || check.optional),
    readyForSeedance2: seedance2.ok,
    readyForCanvasSeedance2: surfaces.canvas.ok,
    readyForWorkflowSeedance2: surfaces.workflow.ok,
    projectDir,
    checks,
    hostConfigs,
    shadowState: { exists: shadowState.exists, file: shadowState.file },
    provider: {
      configured: provider.configured,
      selectedModels: provider.selectedModels,
      providers: provider.providers,
    },
    seedance2,
    surfaces,
    nextSteps,
  };
}

export function planBatchGeneration(input = {}) {
  const prompt = String(input.prompt || '').trim();
  if (!prompt) return { ok: false, error: { code: 'BAD_REQUEST', message: 'prompt is required' } };
  const count = Math.max(1, Math.min(Number(input.count || 4), 10));
  const aspectRatio = String(input.aspectRatio || manageAgentPreferences({ action: 'get' }).preferences.aspectRatio || '16:9');
  const styles = ['hero', 'editorial', 'minimal', 'cinematic', 'detail', 'environment', 'graphic', 'social', 'premium', 'experimental'];
  const items = Array.from({ length: count }, (_, index) => {
    const style = styles[index % styles.length];
    const enhanced = enhancePrompt({ prompt: `${prompt} (${style} direction)`, aspectRatio, style: style === 'hero' ? 'product' : style === 'graphic' ? 'minimal' : 'cinematic' });
    return {
      clientShotId: `shot-${index + 1}`,
      direction: style,
      prompt: enhanced.enhancedPrompt,
      aspectRatio,
    };
  });
  return { ok: true, prompt, count, aspectRatio, items };
}

function numberOrUndefined(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function prepareMediaUpload(input = {}) {
  const rawPath = input.path || input.filePath || input.file;
  if (!rawPath) return { ok: false, error: { code: 'BAD_REQUEST', message: 'path is required' } };
  const filePath = resolve(String(rawPath));
  if (!existsSync(filePath)) return { ok: false, error: { code: 'NOT_FOUND', message: `file not found: ${filePath}` } };

  const mimeType = String(input.mimeType || MIME_BY_EXTENSION[extname(filePath).toLowerCase()] || '').trim();
  if (!mimeType) return { ok: false, error: { code: 'BAD_REQUEST', message: `unsupported media extension: ${extname(filePath)}` } };
  const type = mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('image/') ? 'image' : '';
  if (!type) return { ok: false, error: { code: 'BAD_REQUEST', message: `unsupported media type: ${mimeType}` } };
  if (input.type && input.type !== type) return { ok: false, error: { code: 'BAD_REQUEST', message: `expected ${input.type}, got ${type}` } };

  const href = `data:${mimeType};base64,${readFileSync(filePath).toString('base64')}`;
  const element = {
    href,
    mimeType,
    name: input.name || basename(filePath),
    x: numberOrUndefined(input.x),
    y: numberOrUndefined(input.y),
    width: numberOrUndefined(input.width),
    height: numberOrUndefined(input.height),
  };
  return { ok: true, type, filePath, element };
}
