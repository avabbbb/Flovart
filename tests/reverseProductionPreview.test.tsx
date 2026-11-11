import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductionPreview } from '../components/reverse/ProductionPreview';

const project = {
  id: 'p1',
  direction: 'video',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  references: [],
  slots: [],
  axes: [],
  analysis: {
    durationMs: 2000, words: [], segments: [], analyzedAt: 'fixture', source: 'manual',
    shots: [
      { id: 's1', index: 1, startMs: 0, endMs: 1000, slotIds: [], description: '开场' },
      { id: 's2', index: 2, startMs: 1000, endMs: 2000, slotIds: [], description: '演示' },
    ],
  },
  outputs: [],
} as never;

describe('production preview', () => {
  it('mounts a player for a valid spec', () => {
    render(<ProductionPreview project={project} language='zho' />);
    expect(screen.getByTestId('reverse-production-preview')).toBeTruthy();
  });
});
