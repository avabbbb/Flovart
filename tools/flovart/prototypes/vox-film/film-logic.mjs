export const PRODUCTION_STEPS = [
  ['preflight', 'status', false],
  ['preflight', 'provider.status', false],
  ['preflight', 'models.list', false],
  ['project', 'project.create', false],
  ['workflow', 'workflow.project.create', false],
  ['workflow', 'workflow.node.create', false],
  ['keyframes', 'generate.images-batch', true],
  ['motion', 'generate.video', true],
  ['voice', 'generate.speech', true],
  ['music', 'generate.music', true],
  ['assets', 'asset.list', false],
  ['assets', 'asset.materialize', false],
  ['render', 'film.render', false],
  ['verify', 'film.verify', false],
  ['handoff', 'export.project', false],
];

export function createFilmManifest() {
  return {
    schemaVersion: '0.1-prototype',
    prototype: true,
    project: {
      slug: 'editorial-collage-15s-dry-run',
      title: '为什么城市需要夜晚',
      topic: '用 15 秒解释减少光污染的价值',
      language: 'zh-CN',
    },
    output: { durationSec: 15, aspectRatio: '16:9', width: 1280, height: 720, fps: 24 },
    style: {
      id: 'editorial-paper-collage',
      look: 'torn paper, halftone print, archival cut-outs, bold flat color, stable headline typography',
      motion: 'flat 2D paper layers, one restrained camera move per shot, no morphing',
    },
    provider: { mode: 'mock', apiKeyRequired: false, providerCallsExpected: 0, maxSpendUsd: 0 },
    gates: { beatMap: 'approved-for-dry-run', visualStyle: 'approved-for-dry-run' },
    audio: {
      narration: { intent: 'documentary-voice', language: 'zh-CN' },
      music: { intent: 'minimal editorial pulse, instrumental, no vocals' },
    },
    beats: [
      {
        id: 'beat-01', durationSec: 5, title: '我们弄丢了夜晚', color: '0x24334a', toneHz: 220,
        narration: '我们点亮了城市，却也在不知不觉中弄丢了夜晚。',
        shot: { cameraMove: 'push_in', scene: '夜间城市被过量灯光覆盖，星空像一张被撕走的深蓝纸片' },
      },
      {
        id: 'beat-02', durationSec: 5, title: '黑暗也是基础设施', color: '0x5a3f78', toneHz: 277,
        narration: '没有足够的黑暗，鸟类、昆虫和人的睡眠都会迷路。',
        shot: { cameraMove: 'parallax', scene: '纸雕飞鸟、昆虫与睡眠时钟分层错位，冷白灯切开画面' },
      },
      {
        id: 'beat-03', durationSec: 5, title: '把星星还给城市', color: '0x16766f', toneHz: 330,
        narration: '少一点无效照明，城市依然安全，也能重新看见星星。',
        shot: { cameraMove: 'static', scene: '遮光路灯照亮地面，建筑沉入蓝色纸夜，星星重新出现' },
      },
    ],
  };
}

export function createCommandPlan(registry, film) {
  const argsByCommand = {
    status: {},
    'provider.status': {},
    'models.list': { purpose: 'all' },
    'project.create': { name: film.project.title },
    'workflow.project.create': { title: film.project.title },
    'workflow.node.create': { type: 'text', title: '影片计划', metadata: { manifest: 'film.json' } },
    'generate.images-batch': {
      items: film.beats.map((beat) => ({
        name: `${beat.id}-keyframe`,
        prompt: `${beat.title}。${beat.shot.scene}。${film.style.look}`,
        aspectRatio: film.output.aspectRatio,
      })),
      placeOnCanvas: true,
      layout: 'grid',
    },
    'generate.speech': {
      language: film.project.language,
      segments: film.beats.map((beat) => ({ id: beat.id, text: beat.narration })),
    },
    'generate.music': { prompt: film.audio.music.intent, durationSec: film.output.durationSec },
    'asset.list': {},
    'asset.materialize': { project: film.project.slug, destination: '<project-assets-dir>' },
    'film.render': { manifest: 'film.json', output: 'final.mp4' },
    'film.verify': { manifest: 'film.json', input: 'final.mp4' },
    'export.project': { format: 'json' },
  };
  const steps = PRODUCTION_STEPS.flatMap(([phase, command, providerBacked]) => {
    if (command !== 'generate.video') return [{ phase, command, providerBacked, args: argsByCommand[command] }];
    return film.beats.map((beat) => ({
      phase,
      command,
      providerBacked,
      args: {
        prompt: `${beat.shot.scene}. ${film.style.motion}`,
        sourceImageIds: [`<${beat.id}-keyframe-id>`],
        durationSec: beat.durationSec,
        aspectRatio: film.output.aspectRatio,
      },
    }));
  }).map((step, index) => ({
    id: `step-${String(index + 1).padStart(2, '0')}`,
    ...step,
    available: Boolean(registry[step.command]),
    executed: false,
  }));
  return {
    prototype: true,
    sourceOfTruth: 'tools/flovart/core.js#COMMAND_REGISTRY',
    safety: { providerCallsExecuted: 0, apiKeyRead: false, estimatedCostUsd: 0 },
    coverage: {
      total: steps.length,
      available: steps.filter((step) => step.available).length,
      missing: [...new Set(steps.filter((step) => !step.available).map((step) => step.command))],
    },
    steps,
  };
}

export function initialState(outputDir) {
  return {
    phase: 'idle',
    outputDir,
    providerCalls: 0,
    costUsd: 0,
    commandCoverage: null,
    files: { manifest: null, commandPlan: null, clips: [], final: null, contactSheet: null, verification: null },
    verification: null,
    error: null,
  };
}

export function transition(state, event) {
  const allowed = {
    PLANNED: ['idle', 'failed', 'verified'],
    RENDERED: ['planned'],
    VERIFIED: ['rendered'],
    FAILED: ['idle', 'planned', 'rendered', 'verified'],
    RESET: ['idle', 'planned', 'rendered', 'verified', 'failed'],
  };
  if (!allowed[event.type]?.includes(state.phase)) {
    throw new Error(`非法原型状态转换：${state.phase} -> ${event.type}`);
  }
  if (event.type === 'RESET') return initialState(state.outputDir);
  if (event.type === 'FAILED') return { ...state, phase: 'failed', error: event.error };
  if (event.type === 'PLANNED') {
    return {
      ...state,
      phase: 'planned',
      commandCoverage: event.plan.coverage,
      files: { ...state.files, manifest: event.manifestPath, commandPlan: event.planPath },
      error: null,
    };
  }
  if (event.type === 'RENDERED') {
    return {
      ...state,
      phase: 'rendered',
      files: { ...state.files, clips: event.clips, final: event.finalPath },
    };
  }
  return {
    ...state,
    phase: 'verified',
    verification: event.verification,
    files: { ...state.files, contactSheet: event.contactSheetPath, verification: event.verificationPath },
  };
}
