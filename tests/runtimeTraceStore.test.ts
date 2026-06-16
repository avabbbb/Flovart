import { beforeEach, describe, expect, it } from 'vitest';

import {
  appendTraceEvent,
  createRuntimeJob,
  createRuntimeSession,
  getRuntimeTraceSnapshot,
  listRuntimeJobsForSession,
  listTraceEventsForJob,
  resetRuntimeTraceStore,
  subscribeRuntimeTrace,
  updateRuntimeJob,
} from '../services/runtimeTraceStore';

describe('runtimeTraceStore', () => {
  beforeEach(() => {
    resetRuntimeTraceStore();
  });

  it('records sessions, jobs, and events in one trace snapshot', () => {
    const session = createRuntimeSession({
      name: 'Canvas session',
      source: 'canvas',
      linkedBridge: 'none',
      keyContext: {
        sharedWithExtension: false,
        activeProvider: 'google',
        activeModel: 'veo-3.1-generate-preview',
      },
    });
    const job = createRuntimeJob({
      sessionId: session.sessionId,
      source: 'canvas',
      command: 'canvas.generate.image',
      status: 'queued',
      inputSummary: {
        nodeCount: 4,
      },
    });
    const event = appendTraceEvent({
      sessionId: session.sessionId,
      jobId: job.jobId,
      nodeId: 'video_1',
      level: 'info',
      stage: 'generation.running',
      message: 'Generating video',
    });

    expect(listRuntimeJobsForSession(session.sessionId)).toEqual([
      expect.objectContaining({
        jobId: job.jobId,
        sessionId: session.sessionId,
      }),
    ]);
    expect(listTraceEventsForJob(job.jobId)).toEqual([
      expect.objectContaining({
        id: event.id,
        stage: 'generation.running',
        nodeId: 'video_1',
      }),
    ]);

    const snapshot = getRuntimeTraceSnapshot();
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.events).toHaveLength(1);
  });

  it('updates job state and keeps session activity fresh', () => {
    const session = createRuntimeSession({
      name: 'Trace session',
      source: 'canvas',
    });
    const job = createRuntimeJob({
      sessionId: session.sessionId,
      source: 'canvas',
      command: 'canvas.generate.node',
      status: 'queued',
    });

    const updatedJob = updateRuntimeJob(job.jobId, {
      status: 'running',
    });
    const event = appendTraceEvent({
      sessionId: session.sessionId,
      jobId: job.jobId,
      level: 'warn',
      stage: 'generation.retry',
      message: 'retry 1/2 (1200ms)',
    });
    const nextSnapshot = getRuntimeTraceSnapshot();

    expect(updatedJob?.status).toBe('running');
    expect(event.jobId).toBe(job.jobId);
    expect(nextSnapshot.jobs[0]?.updatedAt).toBeGreaterThanOrEqual(job.updatedAt);
    expect(nextSnapshot.sessions[0]?.lastActiveAt).toBeGreaterThanOrEqual(session.lastActiveAt);
  });

  it('notifies subscribers with the latest snapshot', () => {
    const snapshots = [];
    const unsubscribe = subscribeRuntimeTrace((snapshot) => {
      snapshots.push(snapshot);
    });

    const session = createRuntimeSession({
      name: 'Subscriber session',
      source: 'canvas',
    });
    const job = createRuntimeJob({
      sessionId: session.sessionId,
      source: 'canvas',
      command: 'canvas.run.from-here',
      status: 'queued',
    });
    appendTraceEvent({
      sessionId: session.sessionId,
      jobId: job.jobId,
      level: 'info',
      stage: 'generation.complete',
      message: 'Done',
    });
    unsubscribe();

    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.at(-1)).toMatchObject({
      sessions: [expect.objectContaining({ sessionId: session.sessionId })],
      jobs: [expect.objectContaining({ jobId: job.jobId })],
      events: [expect.objectContaining({ jobId: job.jobId, stage: 'generation.complete' })],
    });
  });
});
