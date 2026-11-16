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
  '模型不传时用与 Prompt Bar 相同的默认策略；不兼容时返回 MODE_UNSUPPORTED / REFERENCE_COUNT_OUT_OF_RANGE（含 min/max/got 与 candidates:[{modelId,mode}]）/ REFERENCE_LIMIT，直接换 candidates 里的模型或模式，不要盲试，先 flovart_models_list。',
  'run 默认 false（只写节点，不花钱）；多个镜头/节点时都用 run=false 建好，再用 flovart_workflow_node_run 的 nodeIds 一次审批运行；单个节点才用 run=true（会扣费并请用户确认），结果原位替换，count>1 折叠成同一批次，返回 run.batch 与每张 takes。',
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
    description: '把一轮对话委派给用户的内置 Flovart Agent（同步，返回摘要、用到的工具与草稿版本）。同步调用有超时；可能超过 1 分钟的委派请改用 flovart_task_start。',
  },
  {
    command: 'agent.task.start',
    name: 'flovart_task_start',
    surfaces: EXTERNAL,
    description: '把可能超过 1 分钟的命令放到后台执行，立即返回 taskId；之后用 flovart_task_get 轮询。可包装：agent.turn、workflow.node.run、workflow.generate、workflow.node.tool、workflow.media.import、workflow.export。被包装命令的确认、预算与 Seedance 预检照常生效；同一 idempotencyKey 重放返回同一个任务。',
    fields: {
      command: { type: 'string', enum: ['agent.turn', 'workflow.node.run', 'workflow.generate', 'workflow.node.tool', 'workflow.media.import', 'workflow.export'], description: '要在后台执行的命令' },
      args: { type: 'object', additionalProperties: true, description: '该命令自己的参数（与直接调用时相同）' },
    },
  },
  {
    command: 'agent.task.get',
    name: 'flovart_task_get',
    surfaces: EXTERNAL,
    description: '读取后台任务：status（queued/running/succeeded/failed/cancelled）、afterSeq 之后的增量事件；done=true 时带 result 或 error。建议每 5–10 秒轮询一次，并把上次返回的 seq 作为 afterSeq。',
    fields: {
      taskId: { type: 'string', minLength: 1 },
      afterSeq: { type: 'number', description: '只返回序号大于它的事件，默认 0' },
    },
  },
  {
    command: 'agent.task.cancel',
    name: 'flovart_task_cancel',
    surfaces: EXTERNAL,
    description: '取消后台任务；它在画布上启动的生成节点会被请求停止。已经提交给模型服务的任务可能仍会计费。',
    fields: {
      taskId: { type: 'string', minLength: 1 },
      reason: { type: 'string' },
    },
  },
  {
    command: 'workflow.inspect',
    name: 'flovart_workflow_inspect',
    aliases: ['flovart_inspect'],
    surfaces: ALL,
    description: '读取可见 Workflow 图（媒体与密钥已脱敏）。summary=true 只给轻量图；nodeId 只看一个节点与它的上下游；'
      + 'ledger=true 返回项目账本（锚点速查 A/S/P/F 编号、镜头表、已生成资产索引，含紧凑文字版），长任务中途或上下文被压缩后先回读它。',
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
      nodeId: { type: 'string', description: '复用的生成节点：id、shot:N、锚点编号或节点名；省略则按 type 新建' },
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
      linkPolicy: { type: 'string', enum: ['auto', 'reject'], description: 'prompt 引用了没连线的节点时：auto（默认）自动连线并回报 autoLinked；reject 直接拒绝' },
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
    command: 'workflow.group.create',
    name: 'flovart_group_create',
    aliases: ['flovart_workflow_group_create'],
    surfaces: ALL,
    description: '把 2 个以上节点放进一个分组框（和生成批次、备选无关）：拖框带动成员，折叠隐藏成员，之后可用 flovart_group_run 整组执行。返回 groupId。',
    fields: {
      nodeIds: { type: 'array', items: { type: 'string' }, minItems: 2, description: '要放进分组的节点 id' },
      title: { type: 'string', description: '分组标题，例如「第一场 · 雨夜」' },
      expectedRevision: { type: 'number' },
      mutationId: { type: 'string', description: '幂等 id；同一 id 重放不会重复建分组' },
    },
  },
  {
    command: 'workflow.group.run',
    name: 'flovart_group_run',
    aliases: ['flovart_workflow_group_run'],
    surfaces: ALL,
    description: '整组执行：按组内依赖拓扑顺序逐个运行分组里所有可运行的生成节点（写了提示词、未锁定的图片/视频节点），整组只确认一次费用；上游失败时跳过依赖它的下游。dryRun=true 只返回执行顺序不花钱。',
    fields: {
      groupId: { type: 'string', minLength: 1, description: '分组框 id（flovart_group_create 返回，或 inspect 里 type=subgraph 且 metadata.groupKind=group 的节点）' },
      dryRun: { type: 'boolean', description: 'true 时只返回执行顺序' },
    },
  },
  {
    command: 'workflow.nodes.search',
    name: 'flovart_workflow_search_nodes',
    surfaces: ALL,
    description: '按条件查节点，只返回精简结果（id、类型、标题、状态、是否有产物、锚点编号、镜号、提示词前 80 字），分页。'
      + '画布大时先用它代替整张 inspect；用户说“A02”“S01”“第 3 镜”“失败的视频”时用它解析成节点 id。'
      + '锚点编号：已批准锚点按种类编号，A 角色 / S 场景 / P 道具 / F 风格。',
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
    command: 'workflow.script.materialize',
    name: 'flovart_script_materialize',
    surfaces: ALL,
    description: '把脚本节点的分镜行物化为生成节点：每行一个 image（或 video）生成节点，行里的 imagePrompt/videoPrompt 写进该节点 Prompt Bar，锚点（characterRefs 与 prompt 里的 @ref:<id>）以 @chip + 连线接上，节点挂 shot 元数据，脚本行回存 imageNodeId/videoNodeId。只建不跑：已物化的行跳过；要运行请把返回的 nodeIds 交给 flovart_workflow_node_run（一次确认，可按批分开，如先 1-5 再 6-9）。',
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
    name: 'flovart_export',
    aliases: ['flovart_workflow_export'],
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
    name: 'flovart_workflow_node_run',
    aliases: ['flovart_workflow_run', 'flovart_run', 'flovart_approve_run'],
    surfaces: ALL,
    description: '原位运行已有的图片/视频生成节点（nodeId），或用 nodeIds 一次确认后并行运行多个（按批审批 approve_run）：建与跑分开——先用 flovart_generate（run=false）把一批节点建好，再把这批 nodeIds 交给本工具，用户在一张审批卡上看到清单与合计费用、确认一次，清单里每个节点各运行一次；清单里有文本备注或非生成节点会在弹卡前被拒绝（NOTE_IS_ANNOTATION / NOT_RUNNABLE）。会扣费。会阻塞到终态再返回，不要自己轮询 inspect。终态 status 只有 succeeded / failed / timeout / unknown_after_submit：成功返回 runId、batch（batchId、headNodeId、memberNodeIds）与每张产物 takes；失败时 error.details.run 带 {status, runId, failedReason, retryable}，批量时每个 runs[] 都有 status。timeout 先 inspect 再用同一 idempotencyKey 重试；unknown_after_submit 可能已计费，禁止重试或换线路。改提示词再跑请用 flovart_generate。',
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
