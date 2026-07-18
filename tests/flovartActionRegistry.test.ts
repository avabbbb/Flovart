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
        expect.objectContaining({ action: 'workflow.describe', targetDomain: 'workflow' }),
        expect.objectContaining({ action: 'workflow.createNode', targetDomain: 'workflow' }),
        expect.objectContaining({ action: 'generate.image', targetDomain: 'workflow' }),
        expect.objectContaining({ action: 'generate.video', targetDomain: 'workflow' }),
        expect.objectContaining({ action: 'assets.list', targetDomain: 'assets' }),
      ]),
    );
  });

  it('creates traceable action requests with inferred targets', () => {
    const request = createFlovartActionRequest({
      source: 'skill',
      action: 'workflow.createNode',
      payload: { description: 'Test shot' },
    });

    expect(request.sessionId).toMatch(/^session_/);
    expect(request.traceId).toMatch(/^trace_/);
    expect(request.target).toEqual({ domain: 'workflow' });
    expect(findFlovartAction(request.action)?.targetDomain).toBe('workflow');
  });

  it('normalizes success and error responses', () => {
    const request = createFlovartActionRequest({
      source: 'claude-code',
      action: 'workflow.describe',
      sessionId: 'session_1',
      traceId: 'trace_1',
    });

    expect(createFlovartActionSuccess(request, { nodeCount: 2 })).toMatchObject({
      ok: true,
      sessionId: 'session_1',
      traceId: 'trace_1',
      action: 'workflow.describe',
      result: { nodeCount: 2 },
    });
    expect(createFlovartActionError(request, 'BAD_REQUEST', 'Missing target')).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'Missing target' },
    });
  });
});
