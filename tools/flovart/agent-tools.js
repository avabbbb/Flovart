// Agent 工具 v2 的唯一定义：工具名、别名、给模型看的说明、完整 JSON Schema、宿主可见性。
// 参数名与必填性来自 canonical command registry（command-registry.v1.json），这里只叠加描述 / 枚举 / 结构；
// 网页内置 Agent、本机 Agent、MCP、DSH 四个宿主都从 getAgentToolSpecs(host) 生成工具，不再各写一份。
import { AGENT_OPERATION_DEFINITIONS } from './agent-surface.js';
import { COMMAND_REGISTRY } from './core.js';
import { WORKFLOW_APPLY_GUIDE, WORKFLOW_OPERATIONS_SCHEMA } from './workflow-operation-schema.js';

export const AGENT_TOOL_HOSTS = Object.freeze(['builtin', 'local', 'mcp', 'dsh']);

const ALL = AGENT_TOOL_HOSTS;
const EXTERNAL = Object.freeze(['local', 'mcp', 'dsh']);

const REFERENCE_ITEM = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['nodeId'],
  properties: {
    nodeId: { type: 'string', minLength: 1, description: '上游素材节点 id（image / video / audio；备注不能当参考）' },
    role: {
      type: 'string',
      enum: ['first_frame', 'last_frame', 'reference', 'character', 'style', 'mask', 'source_video', 'source_audio'],
      description: '参考角色（可选）。首尾帧视频给 first_frame + last_frame；其余默认按顺序作参考。',
    },
  },
});

const GENERATE_DESCRIPTION = [
  '在画布上生成图片/视频的唯一入口：只建或复用一个生成节点，提示词直接写进它的 Prompt Bar，',
  'references 里的素材同时成为 @chip 和连线（顺序 = chip 顺序：图片1、图片2…），然后可选原位运行。',
  '不传 nodeId 时按 type=image|video 新建；传 nodeId 时复用该生成节点（不能是文本备注、脚本或音频）。',
  'prompt 里可用 @ref:<节点id> 精确指代参考，也可写 @图片1 / @视频1；没写到的 references 会自动追加 chip。',
  '生成方式按引用自动推导（无参考=文生，有图=图生图/图生视频，首尾帧=first-last-frame，多参考/视频/音频=reference-to-video），',
  '模型不传时用与 Prompt Bar 相同的默认策略；不兼容时返回 MODE_UNSUPPORTED / REFERENCE_LIMIT 和可用模型列表，不要盲试，先 flovart_models_list。',
  'run 默认 false（只写节点，不花钱）；run=true 会扣费并请用户确认，结果原位替换，count>1 折叠成同一批次，返回 run.batch 与每张 takes。',
  '剧本/分镜：每个镜头一个生成节点，镜头内容写进 prompt，镜号等写进 shot；不要建文本节点承载提示词。',
].join('');

/** 每个命令在注册表 args 之上的 Schema 细化与说明。 */
const DEFINITIONS = [
  {
    command: 'status',
    name: 'flovart_status',
    surfaces: EXTERNAL,
    description: '检查本机 Flovart 前端、Agent 与可见 Workflow 的连接状态。',
  },
  {
    command: 'agent.turn',
    name: 'flovart_agent_turn',
    surfaces: EXTERNAL,
    description: '把一轮对话委派给用户的内置 Flovart Agent（同步，返回摘要、用到的工具与草稿版本）。',
  },
  {
    command: 'workflow.inspect',
    name: 'flovart_workflow_inspect',
    aliases: ['flovart_inspect'],
    surfaces: ALL,
    description: '读取可见 Workflow 图（媒体与密钥已脱敏）。summary=true 只给轻量图；nodeId 只看一个节点与它的上下游。',
  },
  {
    command: 'workflow.selection.get',
    name: 'flovart_workflow_selection_get',
    aliases: ['flovart_workflow_selection', 'flovart_selection'],
    surfaces: ALL,
    description: '读取当前选中的节点（媒体与密钥已脱敏）。',
  },
  {
    command: 'workflow.focus.nodes',
    name: 'flovart_workflow_focus_nodes',
    aliases: ['flovart_workflow_focus'],
    surfaces: ALL,
    description: '把一个或多个节点居中放进视口，不改文档。',
  },
  {
    command: 'workflow.apply',
    name: 'flovart_workflow_apply',
    aliases: ['flovart_apply'],
    surfaces: ALL,
    description: '原子地对一个可见 Workflow 应用带版本与幂等的文档操作（移动、连线、分组、改标题、调整参考顺序等）。生成请用 flovart_generate；写备注请用 flovart_note_write。' + WORKFLOW_APPLY_GUIDE,
    fields: {
      operations: { ...WORKFLOW_OPERATIONS_SCHEMA, description: WORKFLOW_APPLY_GUIDE },
      expectedRevision: { type: 'number', description: '先 inspect 拿到 draftVersion' },
      mutationId: { type: 'string', minLength: 1, description: '本次写入的幂等 id；重试保持不变' },
    },
  },
  {
    command: 'workflow.generate',
    name: 'flovart_generate',
    aliases: ['flovart_workflow_generate'],
    surfaces: ALL,
    description: GENERATE_DESCRIPTION,
    fields: {
      nodeId: { type: 'string', description: '复用的生成节点 id；省略则按 type 新建' },
      type: { type: 'string', enum: ['image', 'video'], description: '新建节点的类型（省略 nodeId 时必填）' },
      title: { type: 'string', description: '新建节点的标题，例如「镜头 2 · 雨夜奔跑」' },
      x: { type: 'number', description: '新建节点位置（可省略，自动放在参考素材右侧）' },
      y: { type: 'number' },
      prompt: { type: 'string', minLength: 1, description: '写进 Prompt Bar 的完整提示词；可含 @ref:<节点id> 或 @图片1' },
      references: { type: 'array', items: REFERENCE_ITEM, description: '有序参考；同时生成 @chip 与连线' },
      modelId: { type: 'string', description: '模型 id（来自 flovart_models_list）；省略用默认' },
      submode: {
        type: 'string',
        enum: ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-extension'],
        description: '生成方式；通常省略，按 references 自动推导',
      },
      aspectRatio: { type: 'string', description: '比例，例如 16:9；必须在模型 aspectRatios 里' },
      resolution: { type: 'string', description: '分辨率，例如 2K / 720p' },
      quality: { type: 'string' },
      count: { type: 'integer', minimum: 1, maximum: 4, description: '一次生成几张（1/2/4，视模型而定）；结果折叠成同一批次' },
      durationSec: { type: 'number', description: '视频时长（秒）' },
      generateAudio: { type: 'boolean', description: '视频是否带声音（模型支持时）' },
      params: { type: 'object', additionalProperties: true, description: '其余生成参数（seed、cameraMovement 等）' },
      shot: {
        type: 'object',
        additionalProperties: false,
        required: ['index'],
        properties: {
          index: { type: 'integer', minimum: 1, description: '镜号' },
          durationSec: { type: 'number' },
          scene: { type: 'string' },
          camera: { type: 'string' },
          dialogue: { type: 'string' },
        },
        description: '分镜元数据（可选）：镜头顺序用 shot.index 表示，不要用连线表示镜头先后',
      },
      run: { type: 'boolean', description: 'true 时写完立即原位运行（扣费，需用户确认）；默认 false' },
      dryRun: { type: 'boolean', description: 'true 时只返回将写入的节点、模型解析与诊断，不写画布' },
      expectedRevision: { type: 'number' },
      mutationId: { type: 'string', description: '幂等 id；同一 id 重放不会重复建节点' },
    },
  },
  {
    command: 'workflow.models.list',
    name: 'flovart_models_list',
    aliases: ['flovart_workflow_models_list'],
    surfaces: ALL,
    description: '列出图片/视频生成模型及其真实能力：每种生成方式是否已配置线路、各类参考上限、张数、比例、分辨率、时长；含 RunningHub 按官方文档动态解析的模型。选模型、换模型前先调它。',
    fields: {
      mode: { type: 'string', enum: ['image', 'video', 'all'], description: '只看图片或视频模型；默认全部' },
      submode: { type: 'string', description: '只要支持该生成方式的模型，例如 first-last-frame' },
      referenceKinds: { type: 'array', items: { type: 'string', enum: ['image', 'video', 'audio'] }, description: '计划使用的参考类型（每个参考一项），用来过滤参考上限不够的模型' },
      includeUnavailable: { type: 'boolean', description: 'true 时也列出当前 Key 下跑不了的模型' },
    },
  },
  {
    command: 'workflow.shortcut.list',
    name: 'flovart_shortcut_list',
    aliases: ['flovart_workflow_shortcut_list'],
    surfaces: ALL,
    description: '列出 Slash 快捷工具（与画布 / 菜单、Prompt Bar 里的 / 同一份清单）：scene 稳定 id、宫格行列、最少源图数。宫格类原地出一张宫格图，非宫格类在右侧新建一个节点。',
    fields: {},
  },
  {
    command: 'workflow.shortcut.apply',
    name: 'flovart_shortcut_apply',
    aliases: ['flovart_workflow_shortcut_apply'],
    surfaces: ALL,
    description: '对一个图片节点套用 Slash 快捷工具，永远只动一个节点、count=1：宫格类（九机位、三视图、四格、25 格）在目标节点已有图片参考或无需源图时把模板写进它的 Prompt Bar 原位生成一张宫格图，目标只是一张图时在右侧新建一个节点并 @+连线引用它；非宫格类（光影矫正、人像增强）总是在右侧新建一个节点。宫格图需要切开时再用 flovart_workflow_node_tool 的 image.split-grid@1。返回 placement=in-place|new-node 与 nodeId。',
    fields: {
      scene: { type: 'string', minLength: 1, description: '快捷工具 id（来自 flovart_shortcut_list），例如 multi-camera-9' },
      nodeId: { type: 'string', description: '目标图片节点；需要源图的工具必填，无需源图的工具省略时新建' },
      text: { type: 'string', description: '补充描述（写进模板的 Content 段）；省略时沿用目标节点里已有的描述' },
      run: { type: 'boolean', description: 'true 时写完立即运行（扣费，需用户确认）；默认 false 只写 Prompt Bar' },
      dryRun: { type: 'boolean', description: 'true 时只返回将写入的节点与模型解析，不写画布' },
      expectedRevision: { type: 'number' },
      mutationId: { type: 'string', description: '幂等 id；同一 id 重放不会重复建节点' },
    },
  },
  {
    command: 'workflow.note.write',
    name: 'flovart_note_write',
    surfaces: ALL,
    description: '写或更新一条给人看的备注（文本节点）。备注永远不连线、不参与生成、不能当提示词或参考。仅在用户明确要求写备注时使用；生成请用 flovart_generate。',
    fields: {
      noteId: { type: 'string', description: '更新已有备注时给出' },
      text: { type: 'string', minLength: 1, description: '备注内容（Markdown）' },
      title: { type: 'string' },
      attachToNodeId: { type: 'string', description: '把备注放在该节点旁边（只是位置，不连线）' },
      placement: { type: 'string', enum: ['right', 'below', 'above', 'left'] },
      expectedRevision: { type: 'number' },
      mutationId: { type: 'string' },
    },
  },
  {
    command: 'workflow.media.import',
    name: 'flovart_media_import',
    surfaces: ALL,
    description: '把 http(s) 图片/视频/音频地址或素材库素材导入画布，成为可持久的媒体节点；给 attachToNodeId 时同时连到该生成节点作参考，并在它的 Prompt Bar 末尾加 @chip。',
    fields: {
      url: { type: 'string', description: 'http(s) 媒体地址（与 assetId 二选一）' },
      assetId: { type: 'string', description: '素材库素材 id（与 url 二选一）' },
      title: { type: 'string' },
      attachToNodeId: { type: 'string', description: '要接上这份素材的图片/视频生成节点' },
      mention: { type: 'boolean', description: '是否在目标 Prompt Bar 加 @chip，默认 true' },
      expectedRevision: { type: 'number' },
      mutationId: { type: 'string' },
    },
  },
  {
    command: 'workflow.node.run',
    name: 'flovart_workflow_node_run',
    aliases: ['flovart_workflow_run', 'flovart_run'],
    surfaces: ALL,
    description: '原位运行已有的图片/视频生成节点（nodeId），或用 nodeIds 一次确认后并行运行多个。会扣费并请用户确认。返回 runId、batch（batchId、headNodeId、memberNodeIds）与每张产物 takes。改提示词再跑请用 flovart_generate。',
    fields: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: '批量运行的节点 id（与 nodeId 二选一）' },
    },
  },
  {
    command: 'workflow.node.stop',
    name: 'flovart_workflow_node_stop',
    surfaces: ALL,
    description: '停止某个节点正在进行的生成（不扣新费用；已提交的上游任务可能仍计费）。',
  },
  {
    command: 'workflow.node.tool',
    name: 'flovart_workflow_node_tool',
    surfaces: ALL,
    description: '在节点上执行画布后处理工具（与节点工具条同一实现：裁剪、放大、去背景、编辑、剪辑、截帧、音频分离/变速/变调、反推提示词、滤镜、扩图、蒙版等），结果写成新节点并自动连线，返回 outputNodeIds。调用 AI 服务的工具会请用户确认。',
    fields: {
      nodeId: { type: 'string', description: '源节点 id（video-merge 可用 sourceNodeIds）' },
      tool: { type: 'string', description: '工具 id，例如 crop / upscale / remove-background / video-trim / video-extract-frame / audio-stem-split / reverse-prompt' },
      position: { type: 'string', enum: ['first', 'current', 'last'], description: 'video-extract-frame：first 首帧 / last 尾帧 / current 指定秒数' },
      currentTimeSec: { type: 'number', description: 'video-extract-frame 在 position=current 时截取的秒数' },
      startSec: { type: 'number', description: '剪辑开始秒数' },
      endSec: { type: 'number', description: '剪辑结束秒数' },
      sourceNodeIds: { type: 'array', items: { type: 'string' }, description: 'video-merge 的有序视频节点 id' },
      audio: { type: 'string', enum: ['full', 'vocals', 'background'], description: '音频分离取哪一路' },
      filters: { type: 'object', additionalProperties: { type: 'number' }, description: 'filter：亮度/对比度/饱和度等数值' },
      direction: { type: 'string', description: 'outpaint：left/right/top/bottom/all' },
      amount: { type: 'number', description: 'outpaint 扩展幅度 0.05-2' },
      targetLongEdge: { type: 'number', description: 'upscale 目标长边 512-8192' },
      action: { type: 'string', description: 'rotate：rotate-90/rotate-180/rotate-270/flip-h/flip-v' },
      rows: { type: 'number', description: 'split-grid 行数 1-6' },
      cols: { type: 'number', description: 'split-grid 列数 1-6' },
      speed: { type: 'number', description: 'audio-speed 倍速 0.25-4' },
      semitones: { type: 'number', description: 'audio-pitch 变调半音数，例如 -3 / +2' },
      preset: { type: 'string', description: 'vectorize 预设' },
      x: { type: 'number', description: 'crop 归一化左边 0-1' },
      y: { type: 'number', description: 'crop 归一化上边 0-1' },
      width: { type: 'number', description: 'crop 归一化宽度 0-1' },
      height: { type: 'number', description: 'crop 归一化高度 0-1' },
      style: { type: 'string' },
      count: { type: 'number', description: 'layer 候选数量 1-4' },
    },
  },
];

/** 注册表类型标记（"string?" / "a|b" / "string[]"）→ JSON Schema。 */
export function descriptorJsonSchema(descriptor) {
  const token = String(descriptor).replace(/\?$/, '');
  if (token.includes('|')) return { type: 'string', enum: token.split('|') };
  if (token === 'number') return { type: 'number' };
  if (token === 'boolean') return { type: 'boolean' };
  if (token === 'object') return { type: 'object', additionalProperties: true };
  if (token === 'array') return { type: 'array', items: {} };
  if (token === 'string[]') return { type: 'array', items: { type: 'string' } };
  return { type: 'string' };
}

function buildSpec(definition) {
  const metadata = COMMAND_REGISTRY[definition.command];
  if (!metadata) throw new Error(`Agent tool ${definition.name} references unknown command ${definition.command}`);
  const fields = definition.fields || {};
  for (const name of Object.keys(fields)) {
    if (!Object.hasOwn(metadata.args, name)) throw new Error(`Agent tool ${definition.name} describes ${name}, which ${definition.command} does not declare in the registry`);
  }
  const properties = {};
  const required = [];
  for (const [name, descriptor] of Object.entries(metadata.args)) {
    properties[name] = { ...descriptorJsonSchema(descriptor), ...(fields[name] || {}) };
    if (!String(descriptor).endsWith('?')) required.push(name);
  }
  return Object.freeze({
    command: definition.command,
    name: definition.name,
    aliases: Object.freeze([...(definition.aliases || [])]),
    description: definition.description || metadata.summary,
    summary: metadata.summary,
    surfaces: Object.freeze([...definition.surfaces]),
    write: Boolean(AGENT_OPERATION_DEFINITIONS[definition.command]?.mutation) && definition.command !== 'agent.turn',
    inputSchema: Object.freeze({ type: 'object', additionalProperties: false, properties, required }),
  });
}

export const AGENT_TOOL_SPECS = Object.freeze(DEFINITIONS.map(buildSpec));

export const AGENT_TOOL_SPEC_BY_COMMAND = Object.freeze(Object.fromEntries(AGENT_TOOL_SPECS.map(spec => [spec.command, spec])));

/** 某个宿主可见的 Agent 工具（同一份 schema 与名字）。 */
export function getAgentToolSpecs(host) {
  if (!AGENT_TOOL_HOSTS.includes(host)) throw new Error(`Unknown Agent tool host: ${host}`);
  return AGENT_TOOL_SPECS.filter(spec => spec.surfaces.includes(host));
}

/** 工具名或旧别名 → 命令。 */
export function agentToolCommand(name) {
  const spec = AGENT_TOOL_SPECS.find(item => item.name === name || item.aliases.includes(name));
  return spec?.command;
}

/** 去掉宿主自己注入的参数（例如内置 Agent 的 projectId）后的 schema。 */
export function agentToolInputSchema(spec, { omit = [], extra = {}, requiredExtra = [] } = {}) {
  const properties = { ...spec.inputSchema.properties };
  for (const name of omit) delete properties[name];
  Object.assign(properties, extra);
  const required = [...spec.inputSchema.required.filter(name => !omit.includes(name)), ...requiredExtra];
  return { type: 'object', additionalProperties: false, properties, required };
}
