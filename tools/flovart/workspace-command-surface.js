export const WORKSPACE_READ_COMMAND_NAMES = Object.freeze([
  'workspace.status',
  'workflow.project.list',
  'workflow.inspect',
  'workflow.selection.get',
]);

export const WORKSPACE_WRITE_COMMAND_NAMES = Object.freeze([
  'workflow.apply',
  'workflow.project.create',
  'workflow.project.use',
  'workflow.project.delete',
  'workflow.node.create',
  'workflow.node.create-connected',
  'workflow.node.update',
  'workflow.node.delete',
  'workflow.node.move',
  'workflow.node.resize',
  'workflow.node.tool',
  'workflow.connect',
  'workflow.disconnect',
  'workflow.select',
  'workflow.viewport.set',
  'workflow.focus.nodes',
]);

export const WORKSPACE_EXECUTION_COMMAND_NAMES = Object.freeze([
  'workflow.node.run',
  'workflow.node.stop',
  // 委派回合：可读可写（默认只读），按执行类命令计。
  'agent.turn',
]);

export const WORKSPACE_COMMAND_NAMES = Object.freeze([
  ...WORKSPACE_READ_COMMAND_NAMES,
  ...WORKSPACE_WRITE_COMMAND_NAMES,
  ...WORKSPACE_EXECUTION_COMMAND_NAMES,
]);

export const WORKSPACE_COMMANDS = new Set([...WORKSPACE_COMMAND_NAMES, ...WORKSPACE_EXECUTION_COMMAND_NAMES]);
export const WORKSPACE_WRITE_COMMANDS = new Set([...WORKSPACE_WRITE_COMMAND_NAMES, ...WORKSPACE_EXECUTION_COMMAND_NAMES]);
