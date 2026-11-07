import { describe, expect, it } from 'vitest';
import { STABLE_TOOL_COMMANDS } from '../dsh-plugin/src/tools';
import { buildCliCommand } from '../dsh-plugin/src/cli';

describe('DSH Flovart projection', () => {
  it('keeps the model-facing tool surface aligned with the five stable commands', () => {
    expect(STABLE_TOOL_COMMANDS).toEqual([
      'status',
      'workflow.inspect',
      'workflow.selection.get',
      'workflow.apply',
      'workflow.node.run',
    ]);
  });

  it('serializes structured tool arguments as JSON CLI flags', () => {
    expect(buildCliCommand('node "/tmp/flovart-cli.js"', 'workflow.apply', {
      operations: [{ op: 'add_node', node: { id: 'shot-1' } }],
      expectedRevision: 3,
    })).toEqual([
      'node',
      '/tmp/flovart-cli.js',
      'workflow.apply',
      '--operations=[{"op":"add_node","node":{"id":"shot-1"}}]',
      '--expectedRevision=3',
      '--json',
    ]);
  });
});
