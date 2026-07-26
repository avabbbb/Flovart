export const BROWSER_COMMANDS = new Set([
  'provider.begin-setup', 'provider.select-model', 'provider.test',
  'workflow.node.run', 'workflow.node.stop',
  'generate.images-batch',
]);

const WAIT_BY_DEFAULT_COMMANDS = new Set([
  'provider.select-model', 'provider.test',
]);

export function shouldWaitForBrowserCommand(command, wait) {
  if (wait !== undefined) return wait === true || wait === 'true';
  return WAIT_BY_DEFAULT_COMMANDS.has(command);
}
