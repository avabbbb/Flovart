// The model-facing Agent surface is intentionally smaller than the CLI registry.
// Granular commands remain CLI compatibility adapters; they are not Agent tools.
export const AGENT_PUBLIC_COMMANDS = Object.freeze([
  'status',
  'workflow.inspect',
  'workflow.selection.get',
  'workflow.apply',
  'workflow.node.run',
]);

export const AGENT_PUBLIC_COMMAND_SET = new Set(AGENT_PUBLIC_COMMANDS);

// Operation metadata is transport-neutral. Argument schemas remain in the
// canonical command registry; this layer only describes side effects and the
// permission/capability boundary shared by CLI, MCP, and Native projections.
export const AGENT_OPERATION_DEFINITIONS = Object.freeze({
  status: Object.freeze({ sideEffects: 'read', risk: 'none', permissions: Object.freeze(['workspace.read']), idempotent: true, mutation: false, requiredCapabilities: Object.freeze([]) }),
  'workflow.inspect': Object.freeze({ sideEffects: 'read', risk: 'none', permissions: Object.freeze(['workflow.read']), idempotent: true, mutation: false, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  'workflow.selection.get': Object.freeze({ sideEffects: 'read', risk: 'none', permissions: Object.freeze(['workflow.read']), idempotent: true, mutation: false, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  'workflow.apply': Object.freeze({ sideEffects: 'workflow.write', risk: 'reversible', permissions: Object.freeze(['workflow.write']), idempotent: true, mutation: true, requiredCapabilities: Object.freeze(['browser-workflow']) }),
  'workflow.node.run': Object.freeze({ sideEffects: 'generation.maybe', risk: 'cost-and-generation', permissions: Object.freeze(['workflow.run']), idempotent: true, mutation: true, requiredCapabilities: Object.freeze(['browser-workflow', 'provider-gate']) }),
});

export const AGENT_BROWSER_COMMANDS = Object.freeze([
  'workflow.inspect',
  'workflow.selection.get',
  'workflow.apply',
  'workflow.node.run',
]);
