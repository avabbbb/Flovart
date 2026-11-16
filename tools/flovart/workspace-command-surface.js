export const WORKSPACE_READ_COMMAND_NAMES = Object.freeze([
  'workspace.status',
  'workflow.project.list',
  'workflow.inspect',
  'workflow.selection.get',
  'workflow.models.list',
  'workflow.export',
  'agent.task.get',
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
  'workflow.note.write',
  'workflow.media.import',
]);

export const WORKSPACE_EXECUTION_COMMAND_NAMES = Object.freeze([
  'workflow.node.run',
  'workflow.node.stop',
  // 写 Prompt Bar（+ 可选运行）：run=true 时与 node.run 一样要确认与计费。
  'workflow.generate',
  // 委派回合：可读可写（默认只读），按执行类命令计。
  'agent.turn',
  // 异步任务层：start 包装长命令，cancel 停止它；都在本机 Agent 会话里执行。
  'agent.task.start',
  'agent.task.cancel',
]);

export const WORKSPACE_COMMAND_NAMES = Object.freeze([
  ...WORKSPACE_READ_COMMAND_NAMES,
  ...WORKSPACE_WRITE_COMMAND_NAMES,
  ...WORKSPACE_EXECUTION_COMMAND_NAMES,
]);

export const WORKSPACE_COMMANDS = new Set([...WORKSPACE_COMMAND_NAMES, ...WORKSPACE_EXECUTION_COMMAND_NAMES]);
export const WORKSPACE_WRITE_COMMANDS = new Set([...WORKSPACE_WRITE_COMMAND_NAMES, ...WORKSPACE_EXECUTION_COMMAND_NAMES]);
