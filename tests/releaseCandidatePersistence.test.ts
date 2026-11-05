import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import {
  flushWorkflowPersistence,
  useWorkflowStore,
  WORKFLOW_STORE_KEY,
} from '../components/workflow/store';
import { applyWorkflowMutation } from '../components/workflow/draftAuthority';
import { workflowStorage } from '../components/workflow/storage';
import type { WorkflowProject } from '../components/workflow/types';
import { WORKFLOW_PERSISTENCE_VERSION } from '../components/workflow/migrations';

function snapshot(project: WorkflowProject) {
  return JSON.stringify({
    id: project.id,
    nodes: project.nodes,
    connections: project.connections,
    selectedNodeIds: project.selectedNodeIds,
    viewport: project.viewport,
    draftVersion: project.draftVersion,
    draftChangeSets: project.draftChangeSets,
    draftRedoStack: project.draftRedoStack,
  });
}

function projectFixture(): WorkflowProject {
  const source = { ...createWorkflowNode('source', 'image', { x: 0, y: 0 }, { href: 'data:image/png;base64,AA==', mimeType: 'image/png', name: 'source.png' }), objectVersion: 1 };
  const result = { ...createWorkflowNode('result', 'image', { x: 420, y: 0 }, { href: 'data:image/png;base64,BB==', mimeType: 'image/png', name: 'result.png' }), objectVersion: 1 };
  return {
    id: 'rc-persistence', title: 'RC persistence', nodes: [source, result],
    connections: [{ id: 'source-result', fromNodeId: source.id, toNodeId: result.id, kind: 'data', objectVersion: 1 }],
    selectedNodeIds: [source.id], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'dots',
    agentSessions: [], activeAgentSessionId: null, draftChangeSets: [], draftRedoStack: [], draftVersion: 1,
    workflowMutationReceipts: [], createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z',
  };
}

describe('release candidate persistence soak', () => {
  beforeEach(async () => {
    await flushWorkflowPersistence();
    await workflowStorage.clear();
    useWorkflowStore.setState({ hydrated: true, projects: [], activeProjectId: null });
  });

  afterEach(async () => {
    await flushWorkflowPersistence();
    await workflowStorage.clear();
  });

  it('survives 30 persist/rehydrate restart cycles with a stable project hash', async () => {
    let expected = projectFixture();
    useWorkflowStore.setState({ projects: [expected], activeProjectId: expected.id });
    const hashes: string[] = [];

    for (let cycle = 0; cycle < 30; cycle += 1) {
      expected = {
        ...expected,
        nodes: expected.nodes.map(node => node.id === 'result' ? { ...node, position: { x: 420 + cycle, y: cycle } } : node),
        updatedAt: `2026-08-31T00:00:${String(cycle).padStart(2, '0')}.000Z`,
      };
      useWorkflowStore.setState({ projects: [expected], activeProjectId: expected.id });
      useWorkflowStore.getState().updateProject(expected.id, { nodes: expected.nodes, updatedAt: expected.updatedAt });
      await flushWorkflowPersistence();

      useWorkflowStore.setState({ hydrated: false, projects: [], activeProjectId: null });
      await useWorkflowStore.persist.rehydrate();
      const restored = useWorkflowStore.getState().projects[0];
      expect(restored).toBeDefined();
      expect(snapshot(restored)).toBe(snapshot(expected));
      hashes.push(snapshot(restored));
    }

    expect(hashes).toHaveLength(30);
    expect(new Set(hashes).size).toBe(30);
    const stored = await workflowStorage.get<{ state: { projects: WorkflowProject[] }; version: number }>(WORKFLOW_STORE_KEY);
    expect(stored?.version).toBe(WORKFLOW_PERSISTENCE_VERSION);
    expect(snapshot(stored!.state.projects[0])).toBe(snapshot(expected));
  });

  it('persists 100 revisioned mutations without losing connections or duplicating receipts', async () => {
    let current = projectFixture();
    useWorkflowStore.setState({ projects: [current], activeProjectId: current.id });
    for (let index = 0; index < 100; index += 1) {
      const result = applyWorkflowMutation(current, {
        projectId: current.id,
        expectedRevision: current.draftVersion || 1,
        mutationId: `rc-soak-${index + 1}`,
        source: 'ui',
        intent: 'RC persistence soak',
        ops: [{ type: 'move_nodes', positions: [{ id: 'result', position: { x: 421 + index, y: index + 1 } }] }],
      });
      if (result.ok === false) throw new Error(`mutation ${index + 1} failed: ${result.error.code} ${result.error.message}`);
      current = result.project;
      useWorkflowStore.setState({ projects: [current], activeProjectId: current.id });
      useWorkflowStore.getState().updateProject(current.id, { nodes: current.nodes, connections: current.connections, draftVersion: current.draftVersion, draftChangeSets: current.draftChangeSets, workflowMutationReceipts: current.workflowMutationReceipts });
    }
    await flushWorkflowPersistence();

    useWorkflowStore.setState({ hydrated: false, projects: [], activeProjectId: null });
    await useWorkflowStore.persist.rehydrate();
    const restored = useWorkflowStore.getState().projects[0];
    expect(restored.connections).toHaveLength(1);
    expect(restored.draftVersion).toBe(101);
    expect(restored.workflowMutationReceipts).toHaveLength(100);
    expect(new Set(restored.workflowMutationReceipts.map(receipt => receipt.mutationId)).size).toBe(100);
    expect(snapshot(restored)).toBe(snapshot(current));
  });
});
