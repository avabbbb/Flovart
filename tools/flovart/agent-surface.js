// The model-facing Agent surface is intentionally smaller than the CLI registry.
// Granular commands remain CLI compatibility adapters; they are not Agent tools.
export const AGENT_PUBLIC_COMMANDS = Object.freeze([
  'status',
  'agent.turn',
  'workflow.inspect',
  'workflow.selection.get',
  'workflow.focus.nodes',
  'workflow.apply',
  'workflow.node.run',
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
  'workflow.node.run': Object.freeze({ sideEffects: 'generation.maybe', risk: 'cost-and-generation', permissions: Object.freeze(['workflow.run']), idempotent: true, mutation: true, requiredCapabilities: Object.freeze(['browser-workflow', 'provider-gate']) }),
});

export const AGENT_BROWSER_COMMANDS = Object.freeze([
  'workflow.inspect',
  'workflow.selection.get',
  'workflow.focus.nodes',
  'workflow.apply',
  'workflow.node.run',
]);
