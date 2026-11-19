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
    nodeId: { type: 'string', minLength: 1, description: '上游素材节点：节点 id、锚点编号（A01/S01/P01/T01）、shot:N 或节点名（重名报 AMBIGUOUS_NODE_NAME）；image / video / audio，备注不能当参考' },
    role: {
      type: 'string',
      enum: ['first_frame', 'last_frame', 'reference', 'character', 'style', 'mask', 'source_video', 'source_audio'],
      description: '参考角色（可选）。首尾帧视频给 first_frame + last_frame；其余默认按顺序作参考。',
    },
    region: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'w', 'h'],
      description: '只引用图片的一块区域（焦点编辑/镜头聚焦）：0-1 归一化 {x,y,w,h}，左上为原点；运行前自动裁剪，不建裁剪节点。仅图片。',
      properties: {
        x: { type: 'number', minimum: 0, maximum: 1 },
        y: { type: 'number', minimum: 0, maximum: 1 },
        w: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        h: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        mask: {
          type: 'object',
          additionalProperties: false,
          description: '可选蒙版（点选主体时）：storageKey 或 href，与区域同尺寸',
          properties: { storageKey: { type: 'string' }, href: { type: 'string' } },
        },
      },
    },
  },
});

const GENERATE_DESCRIPTION = [
  '在画布上生成图片/视频的唯一入口：只建或复用一个生成节点，提示词直接写进它的 Prompt Bar，',
  'references 里的素材同时成为 @chip 和连线（顺序 = chip 顺序：图片1、图片2…），然后可选原位运行。',
  '不传 nodeId 时按 type=image|video 新建；传 nodeId 时复用该生成节点（不能是文本备注、脚本或音频）。',
  'prompt 里可用 @ref:<节点id>、已批准锚点的编号 @A01 / @S01、@shot:3 或 @"节点名"（名字须唯一，否则 AMBIGUOUS_NODE_NAME 并列候选）精确指代参考，也可写 @图片1 / @视频1；没写到的 references 会自动追加 chip；',
  'prompt 引用了没连线的节点会自动连上并在 autoLinked 里回报（linkPolicy=reject 时改为报 REFERENCE_NOT_LINKED）。断开连线/删节点时下游 Prompt Bar 的对应 chip 会被清掉，结果里有 prunedMentions。',
  'references[].region={x,y,w,h}（0-1）只引用图片的一块区域，例如只取人脸或产品局部；运行前自动裁剪，画布上不建裁剪节点。',
  'nodeId 与 references 同样接受节点 id、锚点编号（角色 A、场景 S、产品道具 P、风格 T）、shot:N 或节点名；名字重名时返回 AMBIGUOUS_NODE_NAME 和候选，改用 id 或编号。',
  '生成方式按引用自动推导（无参考=文生，有图=图生图/图生视频，首尾帧=first-last-frame，多参考/视频/音频=reference-to-video），',
  '模型不传时用与 Prompt Bar 相同的默认策略；不兼容时返回 MODE_UNSUPPORTED / REFERENCE_COUNT_OUT_OF_RANGE（含 min/max/got 与 candidates:[{modelId,mode}]）/ REFERENCE_LIMIT，直接换 candidates 里的模型或模式，不要盲试，先 iris_models_list。',
  'run 默认 false（只写节点，不花钱）；多个镜头/节点时都用 run=false 建好，再用 iris_workflow_node_run 的 nodeIds 一次审批运行；单个节点才用 run=true（会扣费并请用户确认），结果原位替换，count>1 折叠成同一批次，返回 run.batch 与每张 takes。',
  '剧本/分镜：每个镜头一个生成节点，镜头内容写进 prompt，镜号等写进 shot；不要建文本节点承载提示词。',
].join('');

/** 每个命令在注册表 args 之上的 Schema 细化与说明。 */
const DEFINITIONS = [
  {
    command: 'status',
    name: 'iris_status',
    surfaces: EXTERNAL,
    description: '检查本机 Iris 前端、Agent 与可见 Workflow 的连接状态。',
  },
  {
    command: 'agent.turn',
    name: 'iris_agent_turn',
    surfaces: EXTERNAL,
    description: '把一轮对话委派给用户的内置 Iris Agent（同步，返回摘要、用到的工具与草稿版本）。同步调用有超时；可能超过 1 分钟的委派请改用 iris_task_start。',
  },
  {
    command: 'agent.task.start',
    name: 'iris_task_start',
    surfaces: ALL,
    description: '把可能超过 1 分钟的命令放到后台执行，立即返回 taskId；之后用 iris_task_get 轮询。可包装：agent.turn、workflow.node.run、workflow.group.run、workflow.generate、workflow.node.tool、workflow.media.import、workflow.export。被包装命令的确认、预算与 Seedance 预检照常生效；同一 idempotencyKey 重放返回同一个任务。',
    fields: {
      command: { type: 'string', enum: ['agent.turn', 'workflow.node.run', 'workflow.group.run', 'workflow.generate', 'workflow.image.tool', 'workflow.video.tool', 'workflow.audio.tool', 'workflow.media.import', 'workflow.export'], description: '要在后台执行的命令' },
      args: { type: 'object', additionalProperties: true, description: '该命令自己的参数（与直接调用时相同）' },
    },
  },
  {
    command: 'agent.task.get',
    name: 'iris_task_get',
    surfaces: ALL,
    description: '读取后台任务：status（queued/running/succeeded/failed/cancelled；unknown_submit=刷新 / 重启前可能已提交并扣费、结果待核对，不要自动重跑）、afterSeq 之后的增量事件；done=true 时带 result 或 error。建议每 5–10 秒轮询一次，并把上次返回的 seq 作为 afterSeq。',
    fields: {
      taskId: { type: 'string', minLength: 1 },
      afterSeq: { type: 'number', description: '只返回序号大于它的事件，默认 0' },
    },
  },
  {
    command: 'agent.task.cancel',
    name: 'iris_task_cancel',
    surfaces: ALL,
    description: '取消后台任务；它在画布上启动的生成节点会被请求停止。已经提交给模型服务的任务可能仍会计费。',
    fields: {
      taskId: { type: 'string', minLength: 1 },
      reason: { type: 'string' },
    },
  },
  {
    command: 'workflow.inspect',
    name: 'iris_workflow_inspect',
    aliases: ['iris_inspect'],
    surfaces: ALL,
    description: '读取可见 Workflow 图（媒体与密钥已脱敏）。summary=true 只给轻量图；nodeId 只看一个节点与它的上下游；'
      + 'ledger=true 返回项目账本（锚点速查 A/S/P/F 编号、镜头表、已生成资产索引，含紧凑文字版），长任务中途或上下文被压缩后先回读它。',
  },
  {
    command: 'workflow.selection.get',
    name: 'iris_workflow_selection_get',
    aliases: ['iris_workflow_selection', 'iris_selection'],
    surfaces: ALL,
    description: '读取当前选中的节点（媒体与密钥已脱敏）。',
  },
  {
    command: 'workflow.focus.nodes',
    name: 'iris_workflow_focus_nodes',
    aliases: ['iris_workflow_focus'],
    surfaces: ALL,
    description: '把一个或多个节点居中放进视口，不改文档。',
  },
  {
    command: 'workflow.apply',
    name: 'iris_workflow_apply',
    aliases: ['iris_apply'],
    surfaces: ALL,
    description: '原子地对一个可见 Workflow 应用带版本与幂等的文档操作（移动、连线、分组、改标题、调整参考顺序等）。生成请用 iris_generate；写备注请用 iris_note_write。' + WORKFLOW_APPLY_GUIDE,
    fields: {
      operations: { ...WORKFLOW_OPERATIONS_SCHEMA, description: WORKFLOW_APPLY_GUIDE },
      expectedRevision: { type: 'number', description: '先 inspect 拿到 draftVersion' },
      mutationId: { type: 'string', minLength: 1, description: '本次写入的幂等 id；重试保持不变' },
    },
  },
  {
    command: 'workflow.generate',
    name: 'iris_generate',
    aliases: ['iris_workflow_generate'],
    surfaces: ALL,
    description: GENERATE_DESCRIPTION,
    fields: {
      nodeId: { type: 'string', description: '复用的生成节点：id、shot:N、锚点编号或节点名；省略则按 type 新建' },
      type: { type: 'string', enum: ['image', 'video'], description: '新建节点的类型（省略 nodeId 时必填）' },
      title: { type: 'string', description: '新建节点的标题，例如「镜头 2 · 雨夜奔跑」' },
      x: { type: 'number', description: '新建节点位置（可省略，自动放在参考素材右侧）' },
      y: { type: 'number' },
      prompt: { type: 'string', minLength: 1, description: '写进 Prompt Bar 的完整提示词；可含 @ref:<节点id> 或 @图片1' },
      references: { type: 'array', items: REFERENCE_ITEM, description: '有序参考；同时生成 @chip 与连线' },
      modelId: { type: 'string', description: '模型 id（来自 iris_models_list）；省略用默认' },
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
      linkPolicy: { type: 'string', enum: ['auto', 'reject'], description: 'prompt 引用了没连线的节点时：auto（默认）自动连线并回报 autoLinked；reject 直接拒绝' },
      run: { type: 'boolean', description: 'true 时写完立即原位运行（扣费，需用户确认）；默认 false' },
      dryRun: { type: 'boolean', description: 'true 时只返回将写入的节点、模型解析与诊断，不写画布' },
      expectedRevision: { type: 'number' },
      mutationId: { type: 'string', description: '幂等 id；同一 id 重放不会重复建节点' },
    },
  },
  {
    command: 'workflow.models.list',
    name: 'iris_models_list',
    aliases: ['iris_workflow_models_list'],
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
    name: 'iris_shortcut_list',
    aliases: ['iris_workflow_shortcut_list'],
    surfaces: ALL,
    description: '列出 Slash 快捷工具（与画布 / 菜单、Prompt Bar 里的 / 同一份清单）：scene 稳定 id、宫格行列、最少源图数。宫格类原地出一张宫格图，非宫格类在右侧新建一个节点。',
    fields: {},
  },
  {
    command: 'workflow.shortcut.apply',
    name: 'iris_shortcut_apply',
    aliases: ['iris_workflow_shortcut_apply'],
    surfaces: ALL,
    description: '对一个图片节点套用 Slash 快捷工具，永远只动一个节点、count=1：宫格类（九机位、三视图、四格、25 格）在目标节点已有图片参考或无需源图时把模板写进它的 Prompt Bar 原位生成一张宫格图，目标只是一张图时在右侧新建一个节点并 @+连线引用它；非宫格类（光影矫正、人像增强）总是在右侧新建一个节点。宫格图需要切开时再用 iris_workflow_node_tool 的 image.split-grid@1。返回 placement=in-place|new-node 与 nodeId。',
    fields: {
      scene: { type: 'string', minLength: 1, description: '快捷工具 id（来自 iris_shortcut_list），例如 multi-camera-9' },
      nodeId: { type: 'string', description: '目标图片节点；需要源图的工具必填，无需源图的工具省略时新建' },
      text: { type: 'string', description: '补充描述（写进模板的 Content 段）；省略时沿用目标节点里已有的描述' },
      run: { type: 'boolean', description: 'true 时写完立即运行（扣费，需用户确认）；默认 false 只写 Prompt Bar' },
      dryRun: { type: 'boolean', description: 'true 时只返回将写入的节点与模型解析，不写画布' },
      expectedRevision: { type: 'number' },
      mutationId: { type: 'string', description: '幂等 id；同一 id 重放不会重复建节点' },
    },
  },
  {
    command: 'workflow.group.create',
    name: 'iris_group_create',
    aliases: ['iris_workflow_group_create'],
    surfaces: ALL,
    description: '把 2 个以上节点放进一个分组框（和生成批次、备选无关）：拖框带动成员，折叠隐藏成员，之后可用 iris_group_run 整组执行。返回 groupId。',
    fields: {
      nodeIds: { type: 'array', items: { type: 'string' }, minItems: 2, description: '要放进分组的节点 id' },
      title: { type: 'string', description: '分组标题，例如「第一场 · 雨夜」' },
      expectedRevision: { type: 'number' },
      mutationId: { type: 'string', description: '幂等 id；同一 id 重放不会重复建分组' },
    },
  },
  {
    command: 'workflow.group.run',
    name: 'iris_group_run',
    aliases: ['iris_workflow_group_run'],
    surfaces: ALL,
    description: '整组执行：按组内依赖拓扑顺序逐个运行分组里所有可运行的生成节点（写了提示词、未锁定的图片/视频节点），整组只确认一次费用；上游失败时跳过依赖它的下游。dryRun=true 只返回执行顺序不花钱。',
    fields: {
      groupId: { type: 'string', minLength: 1, description: '分组框 id（iris_group_create 返回，或 inspect 里 type=subgraph 且 metadata.groupKind=group 的节点）' },
      dryRun: { type: 'boolean', description: 'true 时只返回执行顺序' },
    },
  },
  {
    command: 'workflow.nodes.search',
    name: 'iris_workflow_search_nodes',
    surfaces: ALL,
    description: '按条件查节点，只返回精简结果（id、类型、标题、状态、是否有产物、锚点编号、镜号、提示词前 80 字），分页。'
      + '画布大时先用它代替整张 inspect；用户说“A02”“S01”“第 3 镜”“失败的视频”时用它解析成节点 id。'
      + '锚点编号：已批准锚点按种类编号，A 角色 / S 场景 / P 道具 / T 风格。',
    fields: {
      query: { type: 'string', description: '关键字，匹配标题、文件名、提示词、备注内容、锚点编号；空格分隔的多个词需全部命中' },
      types: { type: 'array', items: { type: 'string' }, description: '节点类型，如 ["image","video"]' },
      anchorCodes: { type: 'array', items: { type: 'string' }, description: '锚点编号，如 ["A02","S01"]' },
      anchor: { type: 'string', enum: ['any', 'approved', 'pending', 'character', 'scene', 'product', 'style'], description: '只看锚点：全部 / 已批准 / 待批准 / 某个种类' },
      status: { type: 'array', items: { type: 'string', enum: ['empty', 'running', 'done', 'error'] }, description: '节点状态：empty 未生成 / running 生成中 / done 有产物 / error 失败' },
      shotIndex: { type: 'number', description: '镜号' },
      parentId: { type: 'string', description: '只看某个子画布（分组）里的节点' },
      limit: { type: 'number', description: '每页条数，默认 20，最多 100' },
      offset: { type: 'number', description: '分页偏移，用上一页返回的 nextOffset' },
    },
  },
  {
    command: 'workflow.cost.estimate',
    name: 'iris_cost_estimate',
    aliases: ['iris_estimate_cost'],
    surfaces: ALL,
    description: '运行前预估费用（只读，不弹卡、不扣费）：给 nodeIds（与 iris_workflow_node_run 相同的清单）或 groupId（iris_group_run 会跑的成员），'
      + '返回每个节点的模型、线路、任务数、预估费用，合计 total {tasks, cost}，费用未知的 unknownCostNodeIds，以及被提交前检查拦下的 blockedNodeIds（这些节点的审批卡无法确认，先修好）。'
      + '与审批卡同一份计划。多个节点或整组运行前先调用它，把清单和合计告诉用户再请求运行；cost 为 null 表示至少一项没有计价规则，以 AI 服务账单为准，不要自己估一个数。',
    fields: {
      nodeIds: { type: 'array', items: { type: 'string' }, minItems: 1, description: '要预估的生成节点 id（与 groupId 二选一）' },
      groupId: { type: 'string', minLength: 1, description: '分组框 id（与 nodeIds 二选一）' },
    },
  },
  {
    command: 'workflow.node.tool.list',
    name: 'iris_node_tool_list',
    aliases: ['iris_workflow_node_tool_list'],
    surfaces: ALL,
    description: '画布工具说明书（只读）：每个工具的 tool id、名称、适用节点类型 inputTypes、计费 billing（free 本地免费 / paid 调用 AI 服务，执行前用户确认 / llm 用用户配置的文本或视觉模型）、'
      + '参数 JSON Schema parameters、产出 output 与用法。给 nodeId 只列这个节点能用的工具，给 tool 只看一个。调用 iris_image_tool / iris_video_tool / iris_audio_tool 前不确定参数时先查它。',
    fields: {
      nodeId: { type: 'string', minLength: 1, description: '只列这个节点能用的工具' },
      tool: { type: 'string', minLength: 1, description: '只看这一个工具，例如 upscale / video-trim' },
    },
  },
  {
    command: 'workflow.note.write',
    name: 'iris_note_write',
    surfaces: ALL,
    description: '写或更新一条给人看的备注（文本节点）。备注永远不连线、不参与生成、不能当提示词或参考。仅在用户明确要求写备注时使用；生成请用 iris_generate。',
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
    name: 'iris_media_import',
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
    command: 'workflow.script.materialize',
    name: 'iris_script_materialize',
    surfaces: ALL,
    description: '把脚本节点的分镜行物化为生成节点：每行一个 image（或 video）生成节点，行里的 imagePrompt/videoPrompt 写进该节点 Prompt Bar，锚点（characterRefs 与 prompt 里的 @ref:<id>）以 @chip + 连线接上，节点挂 shot 元数据，脚本行回存 imageNodeId/videoNodeId。只建不跑：已物化的行跳过；要运行请把返回的 nodeIds 交给 iris_workflow_node_run（一次确认，可按批分开，如先 1-5 再 6-9）。',
    fields: {
      scriptNodeId: { type: 'string', minLength: 1, description: '脚本节点 id' },
      kind: { type: 'string', enum: ['image', 'video'], description: '建图片还是视频生成节点，默认 image' },
      rows: { type: 'string', description: '1 起的分镜行号：1-5、1,3,6-9 或 all（默认全部）' },
      dryRun: { type: 'boolean', description: 'true 时只返回计划，不写画布' },
      expectedRevision: { type: 'number' },
      mutationId: { type: 'string' },
    },
  },
  {
    command: 'workflow.export',
    name: 'iris_export',
    aliases: ['iris_workflow_export'],
    surfaces: ALL,
    description: '导出画布内容（不改文档）：单个图片/视频/音频节点导出原文件；多个节点或一个分组（groupId = 节点的 batchId）打包成 ZIP，文件按节点名命名；脚本节点导出分镜 CSV。文本备注不导出，会列在 skipped 里。默认保存到用户本机（桌面端弹另存为）；外部 Agent 要拿到文件内容时给 inline=true（≤20MB，返回 dataBase64）。',
    fields: {
      nodeIds: { type: 'array', items: { type: 'string' }, minItems: 1, description: '要导出的节点 id（与 groupId 二选一）' },
      groupId: { type: 'string', description: '分组 id，即节点的 batchId（与 nodeIds 二选一）' },
      fileName: { type: 'string', description: '导出文件名（不含扩展名），默认用节点名或项目名' },
      save: { type: 'boolean', description: '是否保存到用户本机，默认 true' },
      inline: { type: 'boolean', description: '是否在结果里附带 base64 文件内容，默认 false' },
    },
  },
  {
    command: 'workflow.node.run',
    name: 'iris_workflow_node_run',
    aliases: ['iris_workflow_run', 'iris_run', 'iris_approve_run'],
    surfaces: ALL,
    description: '原位运行已有的图片/视频生成节点（nodeId），或用 nodeIds 一次确认后并行运行多个（按批审批 approve_run）：建与跑分开——先用 iris_generate（run=false）把一批节点建好，再把这批 nodeIds 交给本工具，用户在一张审批卡上看到清单与合计费用、确认一次，清单里每个节点各运行一次；清单里有文本备注或非生成节点会在弹卡前被拒绝（NOTE_IS_ANNOTATION / NOT_RUNNABLE）。会扣费。会阻塞到终态再返回，不要自己轮询 inspect。终态 status 只有 succeeded / failed / timeout / unknown_after_submit：成功返回 runId、batch（batchId、headNodeId、memberNodeIds）与每张产物 takes；失败时 error.details.run 带 {status, runId, failedReason, retryable}，批量时每个 runs[] 都有 status。timeout 先 inspect 再用同一 idempotencyKey 重试；unknown_after_submit 可能已计费，禁止重试或换线路。改提示词再跑请用 iris_generate。',
    fields: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: '批量运行的节点 id（与 nodeId 二选一）' },
    },
  },
  {
    command: 'workflow.node.stop',
    name: 'iris_workflow_node_stop',
    surfaces: ALL,
    description: '停止某个节点正在进行的生成（不扣新费用；已提交的上游任务可能仍计费）。',
  },
  {
    command: 'workflow.image.tool',
    name: 'iris_image_tool',
    surfaces: ALL,
    description: '在图片节点上执行图片工具（与节点工具条同一实现），结果写成 image 结果节点并从源节点直接连线，返回 resultNodeId（可用 iris_workflow_node_run 原位重跑）与 outputNodeIds（全部新结果，含宫格切分、分层等多输出）。'
      + 'upscale / remove-background / split-layers / edit / layer / outpaint / mask 调用 AI 服务，执行前会请用户确认；crop / rotate / vectorize / split-grid / filter 本地免费；reverse-prompt 用你配置的视觉模型把提示词写回源节点。'
      + '只填所选工具用到的参数；完整 schema 用 iris_node_tool_list 查。工具不适用于该节点或参数不合法时，在确认前直接返回 TOOL_NOT_APPLICABLE / BAD_REQUEST。',
    fields: {
      nodeId: { type: 'string', minLength: 1, description: '源图片节点 id' },
      tool: { type: 'string', description: '图片工具 id' },
      prompt: { type: 'string', description: 'edit / layer / mask 必填；outpaint 可选，描述扩展区域' },
      x: { type: 'number', minimum: 0, maximum: 1, description: 'crop 归一化左边 0-1' },
      y: { type: 'number', minimum: 0, maximum: 1, description: 'crop 归一化上边 0-1' },
      width: { type: 'number', minimum: 0, maximum: 1, description: 'crop 归一化宽度 0-1' },
      height: { type: 'number', minimum: 0, maximum: 1, description: 'crop 归一化高度 0-1' },
      targetLongEdge: { type: 'number', minimum: 512, maximum: 8192, description: 'upscale 目标长边' },
      algorithm: { type: 'string', enum: ['high', 'bilinear', 'nearest'], description: 'upscale 算法' },
      action: { type: 'string', enum: ['rotate-90', 'rotate-180', 'rotate-270', 'flip-h', 'flip-v'], description: 'rotate 动作' },
      preset: { type: 'string', enum: ['detailed', 'poster', 'line'], description: 'vectorize 预设' },
      rows: { type: 'number', minimum: 1, maximum: 6, description: 'split-grid 行数' },
      cols: { type: 'number', minimum: 1, maximum: 6, description: 'split-grid 列数' },
      maskNodeId: { type: 'string', description: 'edit / layer / mask 的蒙版图片节点 id（mask 与 maskHref 二选一必填）' },
      maskHref: { type: 'string', description: '蒙版图片地址' },
      maskMimeType: { type: 'string', description: '蒙版 MIME，默认 image/png' },
      style: { type: 'string', description: 'layer 风格' },
      count: { type: 'number', minimum: 1, maximum: 4, description: 'layer 候选数量' },
      filters: { type: 'object', additionalProperties: { type: 'number' }, description: 'filter：亮度 / 对比度 / 饱和度等数值' },
      direction: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'all'], description: 'outpaint 扩展方向' },
      amount: { type: 'number', minimum: 0.05, maximum: 2, description: 'outpaint 扩展幅度' },
    },
  },
  {
    command: 'workflow.video.tool',
    name: 'iris_video_tool',
    surfaces: ALL,
    description: '在视频节点上执行视频工具（本地处理，不计费；reverse-prompt 用你配置的视觉模型）：video-trim 剪辑、video-av-split 音视频分离、video-merge 按 sourceNodeIds 顺序拼接、video-extract-frame 截帧、reverse-prompt 反推提示词。'
      + '结果写成新结果节点并从源节点直接连线，返回 resultNodeId 与 outputNodeIds。截帧前可先用 iris_workflow_media_view 的 times 找准时间点。只填所选工具用到的参数。',
    fields: {
      nodeId: { type: 'string', minLength: 1, description: '源视频节点 id（video-merge 可省略，取 sourceNodeIds 第一个）' },
      tool: { type: 'string', description: '视频工具 id' },
      startSec: { type: 'number', minimum: 0, description: 'video-trim 开始秒数' },
      endSec: { type: 'number', minimum: 0, description: 'video-trim 结束秒数（大于 startSec）' },
      audio: { type: 'string', enum: ['full', 'vocals', 'background'], description: 'video-av-split 取哪一路音频' },
      sourceNodeIds: { type: 'array', items: { type: 'string' }, minItems: 2, description: 'video-merge 的有序视频节点 id' },
      position: { type: 'string', enum: ['first', 'current', 'last'], description: 'video-extract-frame：first 首帧 / last 尾帧 / current 指定秒数' },
      currentTimeSec: { type: 'number', minimum: 0, description: 'video-extract-frame 在 position=current 时截取的秒数' },
    },
  },
  {
    command: 'workflow.audio.tool',
    name: 'iris_audio_tool',
    surfaces: ALL,
    description: '在音频节点上执行音频工具（本地处理，不计费）：audio-trim 剪辑、audio-speed 变速、audio-pitch 变调、audio-stem-split 人声 / 伴奏分离。结果写成 audio 结果节点并从源节点直接连线，返回 resultNodeId 与 outputNodeIds。只填所选工具用到的参数。',
    fields: {
      nodeId: { type: 'string', minLength: 1, description: '源音频节点 id' },
      tool: { type: 'string', description: '音频工具 id' },
      startSec: { type: 'number', minimum: 0, description: 'audio-trim 开始秒数' },
      endSec: { type: 'number', minimum: 0, description: 'audio-trim 结束秒数（大于 startSec）' },
      speed: { type: 'number', minimum: 0.25, maximum: 4, description: 'audio-speed 倍速' },
      semitones: { type: 'number', description: 'audio-pitch 变调半音数，例如 -3 / +2' },
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
    // 2026-11-20 Flovart → Iris：旧工具名 flovart_*（含旧别名）继续解析到同一命令，弃用。
    legacyNames: Object.freeze(legacyToolNames([definition.name, ...(definition.aliases || [])])),
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

/** iris_* 工具名对应的更名前旧名 flovart_*（弃用别名）。 */
export function legacyToolNames(names) {
  return names.filter(name => name.startsWith('iris_')).map(name => 'flovart_' + name.slice('iris_'.length));
}

/** flovart_* 旧名 → iris_* 新名；不是旧名时原样返回。 */
export function canonicalToolName(name) {
  return typeof name === 'string' && name.startsWith('flovart_') ? 'iris_' + name.slice('flovart_'.length) : name;
}

/** 工具名、旧别名或更名前的 flovart_* 名 → 命令。 */
export function agentToolCommand(name) {
  const spec = AGENT_TOOL_SPECS.find(item => item.name === name || item.aliases.includes(name) || item.legacyNames.includes(name));
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
