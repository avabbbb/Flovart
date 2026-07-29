export const RUNTIME_COMMAND_NAMES = Object.freeze([
  'runtime.status',
  'command.list',
  'command.schema',
  'runtime.test.delay',
  'task.get',
  'task.list',
  'task.cancel',
  'event.stream',
  'provider.status',
  'agent-text.route.sync',
  'production.dry-run',
  'production.status',
  'production.approve',
  'production.run',
  'workflow.projection.get',
  'generate.image',
  'generate.video',
]);

export const RUNTIME_WRITE_COMMAND_NAMES = Object.freeze([
  'runtime.test.delay',
  'task.cancel',
  'agent-text.route.sync',
  'production.dry-run',
  'production.approve',
  'production.run',
  'generate.image',
  'generate.video',
]);

export const RUNTIME_COMMANDS = new Set(RUNTIME_COMMAND_NAMES);
export const RUNTIME_WRITE_COMMANDS = new Set(RUNTIME_WRITE_COMMAND_NAMES);

export function availableCommandEntries(registry) {
  return Object.entries(registry).filter(([, definition]) => definition.availability === 'available');
}
