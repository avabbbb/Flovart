export const WORKSPACE_READ_COMMAND_NAMES = Object.freeze([
  'workspace.status',
  'workflow.project.list',
  'workflow.inspect',
]);

export const WORKSPACE_WRITE_COMMAND_NAMES = Object.freeze([
  'workflow.project.create',
  'workflow.project.use',
  'workflow.project.delete',
  'workflow.node.create',
  'workflow.node.create-connected',
  'workflow.node.update',
  'workflow.node.delete',
  'workflow.node.move',
  'workflow.node.resize',
  'workflow.connect',
  'workflow.disconnect',
  'workflow.select',
  'workflow.viewport.set',
]);

export const WORKSPACE_COMMAND_NAMES = Object.freeze([
  ...WORKSPACE_READ_COMMAND_NAMES,
  ...WORKSPACE_WRITE_COMMAND_NAMES,
]);

export const WORKSPACE_COMMANDS = new Set(WORKSPACE_COMMAND_NAMES);
export const WORKSPACE_WRITE_COMMANDS = new Set(WORKSPACE_WRITE_COMMAND_NAMES);
