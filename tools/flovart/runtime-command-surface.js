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
  'generate.video',
]);

export const RUNTIME_WRITE_COMMAND_NAMES = Object.freeze([
  'runtime.test.delay',
  'task.cancel',
  'generate.video',
]);

export const RUNTIME_COMMANDS = new Set(RUNTIME_COMMAND_NAMES);
export const RUNTIME_WRITE_COMMANDS = new Set(RUNTIME_WRITE_COMMAND_NAMES);

export function availableCommandEntries(registry) {
  return Object.entries(registry).filter(([, definition]) => definition.availability === 'available');
}
