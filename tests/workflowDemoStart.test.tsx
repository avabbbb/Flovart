import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { createWorkflowNode } from '../components/workflow/constants';
import { InfiniteWorkflow } from '../components/workflow/InfiniteWorkflow';
import { WorkflowGenerationCapabilitiesProvider } from '../components/workflow/WorkflowConfigPanel';
import type { WorkflowNode, WorkflowProject } from '../components/workflow/types';
import type { UserApiKey } from '../types';

const makeProject = (nodes: WorkflowNode[] = []): WorkflowProject => ({
  id: 'project-demo',
  title: 'Demo start',
  nodes,
  connections: [],
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, k: 1 },
  backgroundMode: 'dots',
  agentSessions: [],
  activeAgentSessionId: null,
  createdAt: '2026-11-07T00:00:00.000Z',
  updatedAt: '2026-11-07T00:00:00.000Z',
});

function Harness({ initial, onRunNode = () => undefined, onOpenSettings, userApiKeys = [] }: {
  initial: WorkflowProject;
  onRunNode?: (nodeId: string) => void;
  onOpenSettings?: () => void;
  userApiKeys?: UserApiKey[];
}) {
  const [project, setProject] = useState(initial);
  return (
    <>
      <WorkflowGenerationCapabilitiesProvider sharedMedia={[]}>
        <InfiniteWorkflow
          project={project}
          updateProject={patch => setProject(current => ({ ...current, ...patch }))}
          onRunNode={onRunNode}
          onOpenAgent={() => undefined}
          onOpenSettings={onOpenSettings}
          userApiKeys={userApiKeys}
        />
      </WorkflowGenerationCapabilitiesProvider>
      <output data-testid="workflow-project-state" hidden>{JSON.stringify(project)}</output>
    </>
  );
}

const editor = () => screen.getByTestId('workflow-editor');
const projectState = (): WorkflowProject => JSON.parse(screen.getByTestId('workflow-project-state').textContent || '{}');
const openRunFromContextMenu = (nodeId: string) => {
  const element = editor().querySelector<HTMLElement>(`[data-workflow-node-id="${nodeId}"]`)!;
  fireEvent.contextMenu(element, { clientX: 200, clientY: 200 });
  fireEvent.click(screen.getByRole('menuitem', { name: /运行|生成|Run/ }));
};

describe('demo start paths', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a sample canvas labeled as a sample from the empty canvas', async () => {
    render(<Harness initial={makeProject()} />);
    fireEvent.click(screen.getByTestId('workflow-open-sample'));

    await waitFor(() => expect(projectState().nodes).toHaveLength(4));
    const { nodes, connections } = projectState();
    const script = nodes.find(node => node.type === 'text')!;
    const shots = nodes.filter(node => node.type === 'video');
    expect(script.title).toBe('示例 · 脚本');
    expect(shots.map(node => node.title)).toEqual(['示例 · 镜头 1', '示例 · 镜头 2', '示例 · 镜头 3']);
    expect(shots.every(node => typeof node.metadata.prompt === 'string' && node.metadata.prompt.length > 0)).toBe(true);
    expect(connections).toHaveLength(3);
    expect(connections.every(connection => connection.fromNodeId === script.id)).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('浏览和编辑不需要 Key');
  });

  it('guides to setup instead of running when no AI service is configured', () => {
    const onRunNode = vi.fn();
    const onOpenSettings = vi.fn();
    render(<Harness initial={makeProject([createWorkflowNode('shot', 'video', { x: 120, y: 120 }, { prompt: '镜头' })])} onRunNode={onRunNode} onOpenSettings={onOpenSettings} />);

    openRunFromContextMenu('shot');
    expect(screen.getByTestId('workflow-no-key-guide')).toHaveTextContent('还没有配置 AI 服务');
    expect(onRunNode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('workflow-no-key-open-settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onRunNode).not.toHaveBeenCalled();
    expect(screen.queryByTestId('workflow-no-key-guide')).toBeNull();

    openRunFromContextMenu('shot');
    fireEvent.click(screen.getByTestId('workflow-no-key-run-anyway'));
    expect(onRunNode).toHaveBeenCalledTimes(1);
    expect(onRunNode).toHaveBeenCalledWith('shot');
  });

  it('runs directly without the guide when a key is configured', () => {
    const onRunNode = vi.fn();
    const key = { id: 'k1', provider: 'custom', capabilities: ['video'], key: 'test-key-not-secret', baseUrl: 'https://example.invalid' } as unknown as UserApiKey;
    render(<Harness initial={makeProject([createWorkflowNode('shot', 'video', { x: 120, y: 120 }, { prompt: '镜头' })])} onRunNode={onRunNode} userApiKeys={[key]} />);

    openRunFromContextMenu('shot');
    expect(screen.queryByTestId('workflow-no-key-guide')).toBeNull();
    expect(onRunNode).toHaveBeenCalledTimes(1);
  });
});
