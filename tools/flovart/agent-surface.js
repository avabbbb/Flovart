// The model-facing Agent surface is intentionally smaller than the CLI registry.
// Granular commands remain CLI compatibility adapters; they are not Agent tools.
// 工具名、说明与完整参数 Schema 见 agent-tools.js（四个宿主的唯一来源）；这里只列命令与副作用边界。
export const AGENT_PUBLIC_COMMANDS = Object.freeze([
  'status',
  'agent.turn',
  'agent.task.start',
  'agent.task.get',
  'agent.task.cancel',
  'workflow.inspect',
  'workflow.selection.get',
  'workflow.focus.nodes',
  'workflow.apply',
  'workflow.generate',
  'workflow.models.list',
  'workflow.note.write',
  'workflow.media.import',
  'workflow.export',
  'workflow.node.run',
  'workflow.node.stop',
  'workflow.node.tool',
]);

export const AGENT_PUBLIC_COMMAND_SET = new Set(AGENT_PUBLIC_COMMANDS);

// 会话预算 / 暂停（P1）：只给可信本地 CLI（由人设定上限），刻意不放进 AGENT_PUBLIC_COMMANDS。
// 外部 Agent 想预演花费，用 workflow.node.run 的 dryRun: true。
export const AGENT_SESSION_CONTROL_COMMANDS = Object.freeze([
  'session.budget.get',
  'session.budget.grant',
  'session.budget.revoke',
  'session.pause',
  'session.resume',
]);

// Operation metadata is transport-neutral. Argument schemas remain in the
// canonical command registry; this layer only describes side effects and the
// permission/capability boundary shared by CLI, MCP, and Native projections.
export const AGENT_OPERATION_DEFINITIONS = Object.freeze({
  status: Object.freeze({ sideEffects: 'read', risk: 'none', permissions: Object.freeze(['workspace.read']), idempotent: true, mutation: false, requiredCapabilities: Object.freeze([]) }),
  'workflow.inspect': Object.freeze({ sideEffects: 'read', risk: 'none', permissions: Object.freeze(['workflow.read']), idempotent: true, mutation: false, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  'workflow.selection.get': Object.freeze({ sideEffects: 'read', risk: 'none', permissions: Object.freeze(['workflow.read']), idempotent: true, mutation: false, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  'workflow.focus.nodes': Object.freeze({ sideEffects: 'read', risk: 'none', permissions: Object.freeze(['workflow.read']), idempotent: true, mutation: false, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  'workflow.apply': Object.freeze({ sideEffects: 'workflow.write', risk: 'reversible', permissions: Object.freeze(['workflow.write']), idempotent: true, mutation: true, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  'agent.turn': Object.freeze({ sideEffects: 'agent.delegate', risk: 'cost-and-generation', permissions: Object.freeze(['agent.delegate']), idempotent: true, mutation: true, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  // 异步任务层：start 的副作用等同于被包装的命令（浏览器侧确认与预算照常生效）；get 只读；cancel 只会减少花费。
  'agent.task.start': Object.freeze({ sideEffects: 'agent.delegate', risk: 'cost-and-generation', permissions: Object.freeze(['agent.delegate']), idempotent: true, mutation: true, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  'agent.task.get': Object.freeze({ sideEffects: 'read', risk: 'none', permissions: Object.freeze(['workspace.read']), idempotent: true, mutation: false, requiredCapabilities: Object.freeze([]) }),
  'agent.task.cancel': Object.freeze({ sideEffects: 'generation.stop', risk: 'none', permissions: Object.freeze(['agent.delegate']), idempotent: true, mutation: true, requiredCapabilities: Object.freeze([]) }),
  // 只写 Prompt Bar 时是可逆写入；run=true 才产生费用（浏览器侧确认、本机预算按 run 计）。
  'workflow.generate': Object.freeze({ sideEffects: 'generation.maybe', risk: 'cost-and-generation', permissions: Object.freeze(['workflow.write', 'workflow.run']), idempotent: true, mutation: true, requiredCapabilities: Object.freeze(['browser-workflow', 'provider-gate']) }),
  'workflow.models.list': Object.freeze({ sideEffects: 'read', risk: 'none', permissions: Object.freeze(['workflow.read']), idempotent: true, mutation: false, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  'workflow.note.write': Object.freeze({ sideEffects: 'workflow.write', risk: 'reversible', permissions: Object.freeze(['workflow.write']), idempotent: true, mutation: true, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  'workflow.media.import': Object.freeze({ sideEffects: 'workflow.write', risk: 'reversible', permissions: Object.freeze(['workflow.write']), idempotent: true, mutation: true, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  // 导出不改文档：只读媒体并保存到本机（桌面另存为 / 浏览器下载）。
  'workflow.export': Object.freeze({ sideEffects: 'read', risk: 'none', permissions: Object.freeze(['workflow.read']), idempotent: true, mutation: false, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  'workflow.node.stop': Object.freeze({ sideEffects: 'generation.stop', risk: 'none', permissions: Object.freeze(['workflow.run']), idempotent: true, mutation: true, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  'workflow.node.run': Object.freeze({ sideEffects: 'generation.maybe', risk: 'cost-and-generation', permissions: Object.freeze(['workflow.run']), idempotent: true, mutation: true, requiredCapabilities: Object.freeze(['browser-workflow', 'provider-gate']) }),
  // 画布二次处理（裁剪 / 放大 / 去背景 / 剪辑 / 抽帧 / 反推提示词…）：付费工具在浏览器侧仍需人工确认。
  'workflow.node.tool': Object.freeze({ sideEffects: 'generation.maybe', risk: 'cost-and-generation', permissions: Object.freeze(['workflow.run']), idempotent: true, mutation: true, requiredCapabilities: Object.freeze(['browser-workflow', 'provider-gate']) }),
});

// 内置 Agent 可见的命令（与 agent-tools.js 的 builtin 宿主一致；status / agent.turn 只给外部 Agent）。
export const AGENT_BROWSER_COMMANDS = Object.freeze(AGENT_PUBLIC_COMMANDS.filter(command => command !== 'status' && command !== 'agent.turn' && !command.startsWith('agent.task.')));
