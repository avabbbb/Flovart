import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkflowWorkspaceAdapter } from '../components/workflow/useWorkflowWorkspaceAdapter';
import { WorkflowWorkspaceAdapter } from '../services/workflowWorkspaceAdapter';

describe('visible Workflow Workspace Adapter', () => {
  it('connects from desktop discovery and publishes the latest project without opening Agent UI', async () => {
    let onStatus: ((status: 'connecting' | 'connected' | 'disconnected' | 'error') => void) | undefined;
    const connect = vi.fn();
    const disconnect = vi.fn();
    const pushSnapshot = vi.fn().mockResolvedValue({ ok: true });
    const adapter = new WorkflowWorkspaceAdapter({
      discover: vi.fn().mockResolvedValue({
        state: 'ready',
        url: 'http://127.0.0.1:17372',
        token: 'desktop-only-token',
        managed: true,
      }),
      createBridge: options => {
        onStatus = options.onStatus;
        return { connect, disconnect, pushSnapshot };
      },
    });

    await expect(adapter.start({ id: 'project-1', nodes: [] })).resolves.toBe('connecting');
    expect(connect).toHaveBeenCalledOnce();

    adapter.update({ id: 'project-1', nodes: [{ id: 'node-1' }] });
    onStatus?.('connected');
    await vi.waitFor(() => expect(pushSnapshot).toHaveBeenCalledWith({
      id: 'project-1',
      nodes: [{ id: 'node-1' }],
    }));

    adapter.stop();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('keeps one browser connection while the active project changes', async () => {
    const adapter = {
      start: vi.fn().mockResolvedValue('connecting'),
      update: vi.fn(),
      stop: vi.fn(),
    };
    const createAdapter = vi.fn(() => adapter);
    const { rerender, unmount } = renderHook(
      ({ project }) => useWorkflowWorkspaceAdapter(project as any, createAdapter),
      { initialProps: { project: null as any } },
    );

    expect(createAdapter).toHaveBeenCalledOnce();
    expect(adapter.start).toHaveBeenCalledWith(expect.objectContaining({ id: null }));

    rerender({ project: { id: 'project-1', nodes: [] } });
    rerender({ project: { id: 'project-2', nodes: [] } });

    expect(createAdapter).toHaveBeenCalledOnce();
    expect(adapter.start).toHaveBeenCalledOnce();
    expect(adapter.update).toHaveBeenLastCalledWith({ id: 'project-2', nodes: [] });

    unmount();
    expect(adapter.stop).toHaveBeenCalledOnce();
  });

  it('serializes snapshot writes and publishes only the newest pending project', async () => {
    let onStatus: ((status: 'connecting' | 'connected' | 'disconnected' | 'error') => void) | undefined;
    let releaseFirst: (() => void) | undefined;
    const pushSnapshot = vi.fn()
      .mockImplementationOnce(() => new Promise<void>(resolve => { releaseFirst = resolve; }))
      .mockResolvedValue({ ok: true });
    const adapter = new WorkflowWorkspaceAdapter({
      discover: vi.fn().mockResolvedValue({
        state: 'ready',
        url: 'http://127.0.0.1:17372',
        token: 'desktop-only-token',
        managed: true,
      }),
      createBridge: options => {
        onStatus = options.onStatus;
        return { connect: vi.fn(), disconnect: vi.fn(), pushSnapshot };
      },
    });

    await adapter.start({ id: 'project-1', revision: 1 });
    onStatus?.('connected');
    adapter.update({ id: 'project-1', revision: 2 });
    adapter.update({ id: 'project-1', revision: 3 });

    expect(pushSnapshot).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await vi.waitFor(() => expect(pushSnapshot).toHaveBeenCalledTimes(2));
    expect(pushSnapshot).toHaveBeenLastCalledWith({ id: 'project-1', revision: 3 });
  });

  it('does not create a ghost bridge when stopped during desktop discovery', async () => {
    let finishDiscovery: ((connection: any) => void) | undefined;
    const createBridge = vi.fn();
    const adapter = new WorkflowWorkspaceAdapter({
      discover: () => new Promise(resolve => { finishDiscovery = resolve; }),
      createBridge,
    });

    const starting = adapter.start({ id: null });
    adapter.stop();
    finishDiscovery?.({
      state: 'ready',
      url: 'http://127.0.0.1:17372',
      token: 'desktop-only-token',
      managed: true,
    });

    await expect(starting).resolves.toBe('disconnected');
    expect(createBridge).not.toHaveBeenCalled();
  });
});
