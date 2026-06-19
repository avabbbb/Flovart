import { describe, expect, it } from 'vitest';
import { createNewBoard } from '../utils/canvasHelpers';

describe('Canvas board contract', () => {
  it('keeps workflow graph state out of Canvas boards', () => {
    const board = createNewBoard('Canvas');

    expect('edges' in board).toBe(false);
    expect(Array.isArray(board.history[0])).toBe(true);
    expect(board.history[0]).toEqual(board.elements);
  });
});
