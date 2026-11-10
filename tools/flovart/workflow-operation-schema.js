// workflow.apply 的 operations 唯一契约：Agent 工具 schema（浏览器内 Agent / MCP）与分发器的字段校验都从这里取。
// 改字段时同步 components/workflow/types.ts 的 WorkflowDocumentOperation。

// 每种 operation 允许的顶层字段；未列出的字段一律报校验错误，不再静默丢弃。
export const WORKFLOW_OPERATION_FIELDS = Object.freeze({
  add_node: Object.freeze(['type', 'node']),
  create_connected_node: Object.freeze(['type', 'fromNodeId', 'node']),
  update_node: Object.freeze(['type', 'id', 'nodeId', 'patch', 'metadata', 'replaceMetadata']),
  delete_nodes: Object.freeze(['type', 'ids']),
  delete_connections: Object.freeze(['type', 'ids', 'all']),
  connect_nodes: Object.freeze(['type', 'id', 'fromNodeId', 'toNodeId', 'kind', 'role', 'order']),
  move_nodes: Object.freeze(['type', 'positions']),
  reorder_nodes: Object.freeze(['type', 'ids']),
  group_nodes: Object.freeze(['type', 'ids', 'batchId', 'source']),
  ungroup_nodes: Object.freeze(['type', 'ids']),
  set_batch_primary: Object.freeze(['type', 'batchId', 'nodeId']),
});

// update_node.patch 允许的节点字段（id 与 objectVersion 由系统维护，不可写）。
export const WORKFLOW_NODE_PATCH_FIELDS = Object.freeze([
  'title', 'type', 'position', 'width', 'height', 'freeResize', 'isVisible', 'isLocked',
  'batchId', 'batchIndex', 'batchGroupSource', 'parentId', 'shot', 'anchor', 'metadata',
]);

const nonEmptyString = { type: 'string', minLength: 1 };
const idList = { type: 'array', items: nonEmptyString, minItems: 1 };
const point = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: { x: { type: 'number' }, y: { type: 'number' } },
};

const METADATA_DESCRIPTION = [
  '节点 metadata 按顶层键合并：只写你要改的键，其它键保持不变。',
  'config 再合并一层：{"config":{"durationSec":15}} 只改时长，modelId 等其它字段保留。',
  '写 prompt 而不带 richTextDocument 时，旧的 richTextDocument 会被清空，编辑器显示并执行的就是这段纯文本；',
  '提示词里的「@视频1」只是文字，参考素材由上游连线（connect_nodes）决定，不需要手写 mention 节点。',
  'replaceMetadata=true 时整个 metadata 被替换，慎用。',
].join('');

const metadata = { type: 'object', additionalProperties: true, description: METADATA_DESCRIPTION };

const nodePatch = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  description: '要修改的节点字段。标题写 {"title":"..."}；提示词/配置写在 metadata 里。',
  properties: {
    title: { type: 'string' },
    type: { type: 'string' },
    position: point,
    width: { type: 'number', exclusiveMinimum: 0 },
    height: { type: 'number', exclusiveMinimum: 0 },
    freeResize: { type: 'boolean' },
    isVisible: { type: 'boolean' },
    isLocked: { type: 'boolean' },
    batchId: { type: 'string' },
    batchIndex: { type: 'number' },
    batchGroupSource: { type: 'string' },
    parentId: { type: 'string' },
    shot: { type: 'object', additionalProperties: true },
    anchor: { type: 'object', additionalProperties: true },
    metadata,
  },
};

const newNode = {
  type: 'object',
  additionalProperties: true,
  required: ['type'],
  description: '新节点：type 必填（image/text/video/audio/config）；id、title、position、metadata 可选，缺 position 时自动落位。',
  properties: {
    id: nonEmptyString,
    type: { type: 'string' },
    title: { type: 'string' },
    position: point,
    width: { type: 'number' },
    height: { type: 'number' },
    metadata,
  },
};

const op = (type, required, properties, description) => ({
  type: 'object',
  additionalProperties: false,
  description,
  required: ['type', ...required],
  properties: { type: { const: type }, ...properties },
});

// operations 数组单项的 JSON Schema（按 type 区分的 oneOf）。
export const WORKFLOW_OPERATION_ITEM_SCHEMA = Object.freeze({
  oneOf: [
    op('update_node', [], {
      id: { ...nonEmptyString, description: '要修改的节点 id（必填；nodeId 是它的别名，二选一）。' },
      nodeId: { ...nonEmptyString, description: 'id 的别名。' },
      patch: nodePatch,
      metadata: { ...metadata, description: '等价于 patch.metadata。' + METADATA_DESCRIPTION },
      replaceMetadata: { type: 'boolean' },
    }, '修改已有节点。patch 或 metadata 至少给一个。'),
    op('add_node', ['node'], { node: newNode }, '新增节点。'),
    op('create_connected_node', ['fromNodeId', 'node'], { fromNodeId: nonEmptyString, node: newNode }, '新增节点并从 fromNodeId 连线到它。'),
    op('connect_nodes', ['fromNodeId', 'toNodeId'], {
      id: nonEmptyString,
      fromNodeId: nonEmptyString,
      toNodeId: nonEmptyString,
      kind: { type: 'string' },
      role: { type: 'string' },
      order: { type: 'number' },
    }, '连线：上游 fromNodeId 作为下游 toNodeId 的输入。'),
    op('delete_nodes', ['ids'], { ids: idList }, '删除节点（会要求用户确认）。'),
    op('delete_connections', [], { ids: idList, all: { type: 'boolean' } }, '删除连线：ids 或 all=true。'),
    op('move_nodes', ['positions'], {
      positions: {
        type: 'array',
        minItems: 1,
        items: { type: 'object', additionalProperties: false, required: ['id', 'position'], properties: { id: nonEmptyString, position: point } },
      },
    }, '移动节点。'),
    op('reorder_nodes', ['ids'], { ids: idList }, '重排全部节点顺序（必须完整、不重复）。'),
    op('group_nodes', ['ids', 'batchId'], { ids: idList, batchId: nonEmptyString, source: { type: 'string' } }, '把节点编成一个批次组。'),
    op('ungroup_nodes', ['ids'], { ids: idList }, '解散批次组。'),
    op('set_batch_primary', ['batchId', 'nodeId'], { batchId: nonEmptyString, nodeId: nonEmptyString }, '设置批次主节点。'),
  ],
});

export const WORKFLOW_OPERATIONS_SCHEMA = Object.freeze({
  type: 'array',
  minItems: 1,
  items: WORKFLOW_OPERATION_ITEM_SCHEMA,
});

// 工具 description 里给模型看的用法与示例。
export const WORKFLOW_APPLY_GUIDE = [
  '用法：先 inspect 拿到 draftVersion，作为 expectedRevision；一次只发一个写入，成功后用返回的 draftVersion 继续。',
  '只改已有节点且这些节点在期间没被动过时，版本号落后也能写入；冲突时错误会给出当前版本和被改动的节点。',
  '未知字段会直接报错。示例：',
  '{"type":"update_node","id":"node-1","patch":{"title":"视频-延长"}}；',
  '{"type":"update_node","id":"node-1","patch":{"metadata":{"prompt":"龙喷火，镜头缓推","config":{"durationSec":15}}}}；',
  '{"type":"connect_nodes","fromNodeId":"image-1","toNodeId":"video-1"}。',
].join('');
