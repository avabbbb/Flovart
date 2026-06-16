import { describe, expect, it } from 'vitest';

import {
  createFlovartActionError,
  createFlovartActionRequest,
  createFlovartActionSuccess,
  findFlovartAction,
  listFlovartActions,
} from '../services/flovartActionRegistry';

describe('flovartActionRegistry', () => {
  it('lists the first native action protocol actions', () => {
    expect(listFlovartActions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'canvas.describe', targetDomain: 'canvas' }),
        expect.objectContaining({ action: 'selection.describe', targetDomain: 'canvas' }),
        expect.objectContaining({ action: 'generate.image', targetDomain: 'canvas' }),
        expect.objectContaining({ action: 'storyboard.listShots', targetDomain: 'storyboard' }),
        expect.objectContaining({ action: 'storyboard.createShot', targetDomain: 'storyboard' }),
        expect.objectContaining({ action: 'assets.list', targetDomain: 'assets' }),
      ]),
    );
  });

  it('creates traceable action requests with inferred targets', () => {
    const request = createFlovartActionRequest({
      source: 'skill',
      action: 'storyboard.createShot',
      payload: { description: 'Test shot' },
    });

    expect(request.sessionId).toMatch(/^session_/);
    expect(request.traceId).toMatch(/^trace_/);
    expect(request.target).toEqual({ domain: 'storyboard' });
    expect(findFlovartAction(request.action)?.targetDomain).toBe('storyboard');
  });

  it('normalizes success and error responses', () => {
    const request = createFlovartActionRequest({
      source: 'claude-code',
      action: 'canvas.describe',
      sessionId: 'session_1',
      traceId: 'trace_1',
    });

    expect(createFlovartActionSuccess(request, { elementCount: 2 })).toMatchObject({
      ok: true,
      sessionId: 'session_1',
      traceId: 'trace_1',
      action: 'canvas.describe',
      result: { elementCount: 2 },
    });
    expect(createFlovartActionError(request, 'BAD_REQUEST', 'Missing target')).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'Missing target' },
    });
  });
});
