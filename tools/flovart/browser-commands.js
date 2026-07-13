export const BROWSER_COMMANDS = new Set([
  'provider.begin-setup', 'provider.status', 'provider.select-model', 'provider.test',
  'element.ignite',
  'workflow.node.run', 'workflow.node.stop',
  'generate.image', 'generate.images-batch', 'generate.video',
]);

const WAIT_BY_DEFAULT_COMMANDS = new Set([
  'provider.status', 'provider.select-model', 'provider.test',
]);

export function shouldWaitForBrowserCommand(command, wait) {
  if (wait !== undefined) return wait === true || wait === 'true';
  return WAIT_BY_DEFAULT_COMMANDS.has(command);
}
