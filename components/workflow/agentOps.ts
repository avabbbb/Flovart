export const WORKFLOW_MUTATION_COMMANDS = new Set([
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
  'workflow.node.run',
  'workflow.node.stop',
]);

export const workflowCommandSummary = (command: string, args: Record<string, unknown>) => {
  const target = args.nodeId || args.id || args.projectId || args.title || '';
  return `${command}${target ? `：${String(target)}` : ''}`;
};
