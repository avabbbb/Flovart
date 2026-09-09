import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, extname, basename, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PRODUCT_MODEL_ENTRIES, listProductModelEntries } from './product-models.js';
import { discoverAgentHosts } from './host-discovery.js';
import { getDistributionTarget, resolveDistributionTargetId } from './host-registry.js';

export { discoverAgentHosts };

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = process.env.FLOVART_AGENT_CONFIG_DIR || join(process.env.APPDATA || process.env.HOME || homedir(), 'Flovart');
const PREFS_FILE = join(CONFIG_DIR, 'agent-preferences.json');

const SEEDANCE2_PRODUCT_IDS = ['flovart:seedance-2', 'flovart:seedance-2-fast'];
const SEEDANCE2_ALIASES = ['doubao-seedance-2.0', 'seedance-2.0', 'dreamina-seedance-2-0-260128', 'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128'];
const SEEDANCE2_REQUIREMENTS = {
  provider: 'volcengine',
  productModelIds: SEEDANCE2_PRODUCT_IDS,
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
      image: 'flovart:gpt-image-2',
      video: 'flovart:seedance-2',
      text: 'gemini-3-flash-preview',
      ...(provider.selectedModels || {}),
    },
    providers: Array.isArray(provider.providers) ? provider.providers : [],
  };
  if (snapshot.selectedModels.video === 'kling-v2' && !snapshot.configured.video && snapshot.providers.length === 0) {
    snapshot.selectedModels.video = 'flovart:seedance-2';
  }
  return snapshot;
}

function diagnoseSeedance2(provider) {
  const videoModel = String(provider.selectedModels.video || '');
  const normalizedModel = videoModel.toLowerCase();
  const modelOk = SEEDANCE2_PRODUCT_IDS.includes(normalizedModel)
    || SEEDANCE2_ALIASES.includes(normalizedModel)
    || normalizedModel.includes('seedance');
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
      expectedProductModelIds: SEEDANCE2_PRODUCT_IDS,
      message: modelOk ? 'Seedance 2.0 model is selected.' : 'Selected video model is not a Seedance 2.0 model.',
      nextAction: modelOk ? undefined : 'provider.select-model --video-model flovart:seedance-2',
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
  const workflowProjects = Array.isArray(state.workflowProjects) ? state.workflowProjects : [];
  const providerReady = seedance2.ok;
  return {
    workflow: {
      ok: providerReady,
      commandSurface: true,
      providerBackedGenerationReady: providerReady,
      browserRequired: true,
      projectCount: workflowProjects.length,
      activeProjectId: state.activeWorkflowProjectId || null,
      commands: ['workflow.inspect', 'workflow.selection.get', 'workflow.apply', 'workflow.node.run'],
    },
  };
}

function defaultPreferences() {
  return {
    style: 'cinematic',
    aspectRatio: '16:9',
    imageModel: 'flovart:gpt-image-2',
    videoModel: 'flovart:seedance-2',
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
  const filterCapability = purpose === 'image' ? 'image' : purpose === 'video' ? 'video' : 'all';
  const entries = listProductModelEntries(filterCapability);
  const models = {};
  for (const entry of entries) {
    const list = models[entry.capability] || (models[entry.capability] = []);
    list.push({
      id: entry.id,
      label: entry.name,
      routing: 'browser-provider',
      provider: entry.provider,
      capability: entry.capability,
      status: entry.status,
      badge: entry.badge || undefined,
      selected: prefs[`${entry.capability}Model`] === entry.id,
    });
  }
  const imageModels = models.image || [];
  const videoModels = models.video || [];
  const seedance2 = videoModels.find(m => SEEDANCE2_PRODUCT_IDS.includes(m.id.toLowerCase()));
  if (seedance2) {
    seedance2.slots = SEEDANCE2_REQUIREMENTS.slots;
    seedance2.durationSec = SEEDANCE2_REQUIREMENTS.durationSec;
    seedance2.resolutions = SEEDANCE2_REQUIREMENTS.resolutions;
  }
  return {
    ok: true,
    purpose,
    models: purpose === 'image' ? { image: imageModels } : purpose === 'video' ? { video: videoModels } : { image: imageModels, video: videoModels },
  };
}

export function initCliHost(input = {}) {
  const legacyHost = String(input.legacyHost || input.host || '').toLowerCase();
  const targetAliases = {
    project: 'project-skill',
    all: 'project-skill',
    codex: 'codex-skill',
    claude: 'claude-code-skill',
    opencode: 'opencode-skill',
    cursor: 'project-skill',
    windsurf: 'project-skill',
    vscode: 'project-skill',
  };
  const requestedTargetId = String(input.target || targetAliases[legacyHost] || 'project-skill').toLowerCase();
  const targetId = resolveDistributionTargetId(requestedTargetId);
  const target = getDistributionTarget(targetId);
  const projectDir = resolve(String(input.projectDir || process.cwd()));
  const dryRun = input.dryRun === true || input['dry-run'] === true;
  if (!target || target.status !== 'supported' || !target.installPath) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_DISTRIBUTION_TARGET',
        message: `不支持的 Distribution Target：${requestedTargetId}`,
        details: { targetId: requestedTargetId, availableTargets: ['project-skill', 'codex', 'codex-skill', 'codebuddy-code-skill', 'claude-code-skill', 'opencode-skill'] },
      },
    };
  }

  // The agent-facing surface is CLI-first: init installs the Flovart SKILL as a
  // coding-agent attachment and never writes MCP server configuration.
  const packagedSkill = join(PACKAGE_DIR, 'skill', 'SKILL.md');
  const sourceSkill = resolve(PACKAGE_DIR, '..', '..', '.agents', 'skills', 'flovart', 'SKILL.md');
  const skillSource = existsSync(sourceSkill) ? sourceSkill : packagedSkill;
  const distributionRoot = join(projectDir, target.installPath);
  const skillTarget = join(distributionRoot, 'flovart', 'SKILL.md');
  if (!dryRun && existsSync(skillSource)) {
    ensureParent(skillTarget);
    writeFileSync(skillTarget, readFileSync(skillSource, 'utf8'), 'utf8');
  }
  const packagedOpenSkill = join(PACKAGE_DIR, 'skill', 'open-flovart', 'SKILL.md');
  const sourceOpenSkill = resolve(PACKAGE_DIR, '..', '..', '.agents', 'skills', 'open-flovart', 'SKILL.md');
  const openSkillSource = existsSync(sourceOpenSkill) ? sourceOpenSkill : packagedOpenSkill;
  const openSkillTarget = join(distributionRoot, 'open-flovart', 'SKILL.md');
  if (!dryRun && existsSync(openSkillSource)) {
    ensureParent(openSkillTarget);
    writeFileSync(openSkillTarget, readFileSync(openSkillSource, 'utf8'), 'utf8');
  }

  return {
    ok: existsSync(skillSource) && existsSync(openSkillSource),
    requestedTarget: requestedTargetId,
    target: targetId,
    distributionTarget: target,
    projectDir,
    skill: { source: skillSource, target: skillTarget, exists: existsSync(skillSource), dryRun },
    bootstrapSkill: { source: openSkillSource, target: openSkillTarget, exists: existsSync(openSkillSource), dryRun },
    nextSteps: [
      'Run flovart ensure --json to launch or reuse the local Runtime and visible Workflow.',
      `The selected distribution reads ${target.installPath}/open-flovart/SKILL.md to prepare the browser, then ${target.installPath}/flovart/SKILL.md for Workflow commands.`,
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
  const agentSurface = (() => {
    const skillTarget = join(projectDir, '.agents', 'skills', 'flovart', 'SKILL.md');
    const toolPath = join(projectDir, 'tools', 'flovart', 'cli.js');
    return {
      skillInstalled: existsSync(skillTarget),
      skillPath: skillTarget,
      cliAvailable: existsSync(toolPath) || process.env.FLOVART_SKIP_CLI_CHECK === '1',
      cliPath: toolPath,
      usage: 'flovart <command> --json  // source checkout fallback: npm run flovart:cli -- <command> --json',
    };
  })();
  const shadowState = readShadowStateSnapshot();
  const provider = providerSnapshot(shadowState.state?.provider);
  const seedance2 = diagnoseSeedance2(provider);
  const surfaces = diagnoseGenerationSurfaces(shadowState, seedance2);
  // Diagnosis is a bounded readiness check; the picker can perform the
  // optional version probe, while setup diagnostics should not wait on every
  // executable's `--version` process.
  const hostDiscovery = discoverAgentHosts({ includeVersion: false });
  const nextSteps = Array.from(new Set([
    'Run npm run flovart:cli -- status --json, then start --open if needed to verify the local Runtime and visible Workflow.',
    'Run npm run flovart:cli -- init --target project-skill to install the Flovart Skill.',
    ...seedance2.nextActions,
    'Run flovart start --open and keep the visible Workflow available for provider-backed generation.',
  ]));
  return {
    ok: checks.every(check => check.ok || check.optional),
    readyForSeedance2: seedance2.ok,
    readyForWorkflowSeedance2: surfaces.workflow.ok,
    projectDir,
    checks,
    agentSurface,
    hostDiscovery,
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
