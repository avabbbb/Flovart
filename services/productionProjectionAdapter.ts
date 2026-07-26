import type {
  WorkflowConnection,
  WorkflowNode,
  WorkflowProject,
} from '../components/workflow/types';
import type { FlovartRuntimeApi } from './flovartRuntime';

export interface ProductionWorkflowProjection {
  schemaVersion: 'flovart.workflow-projection/1';
  projectionId: string;
  projectionVersion: number;
  projectionHash: string;
  projectId: string;
  productionSessionId: string;
  specRevisionId: string;
  productionRunId: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}

type ProjectionSyncResult = 'applied' | 'unchanged' | 'empty' | 'unavailable';

interface ProductionProjectionAdapterOptions {
  runtime: Pick<FlovartRuntimeApi, 'execute'> | null;
  getProject: (projectId: string) => WorkflowProject | null;
  updateProject: (
    projectId: string,
    patch: Pick<WorkflowProject, 'nodes' | 'connections' | 'selectedNodeIds'>,
  ) => void;
}

const isProjectedNode = (node: WorkflowNode) => Boolean(node.metadata.productionProjection);
const isProjectedConnection = (connection: WorkflowConnection) => (
  connection.id.startsWith('production-dependency-')
);

export function mergeProductionProjection(
  project: WorkflowProject,
  projection: ProductionWorkflowProjection,
): WorkflowProject {
  if (projection.schemaVersion !== 'flovart.workflow-projection/1') {
    throw new Error(`不支持的 Production Projection：${projection.schemaVersion}`);
  }
  if (projection.projectId !== project.id) {
    throw new Error(`Production Projection 项目不匹配：${projection.projectId}`);
  }
  const existingNodes = new Map(project.nodes.map(node => [node.id, node]));
  const userNodes = project.nodes.filter(node => !isProjectedNode(node));
  const projectedNodes = projection.nodes.map(node => {
    const existing = existingNodes.get(node.id);
    if (!existing || !isProjectedNode(existing)) return node;
    return {
      ...node,
      position: existing.position,
      width: existing.width,
      height: existing.height,
      freeResize: existing.freeResize,
      isVisible: existing.isVisible,
      isLocked: existing.isLocked,
    };
  });
  const nodes = [...userNodes, ...projectedNodes];
  const validNodeIds = new Set(nodes.map(node => node.id));
  const preservedConnections = project.connections.filter(connection => (
    !isProjectedConnection(connection)
    && validNodeIds.has(connection.fromNodeId)
    && validNodeIds.has(connection.toNodeId)
  ));
  const connectionIds = new Set(preservedConnections.map(connection => connection.id));
  const connections = [
    ...preservedConnections,
    ...projection.connections.filter(connection => {
      if (
        connectionIds.has(connection.id)
        || !validNodeIds.has(connection.fromNodeId)
        || !validNodeIds.has(connection.toNodeId)
      ) return false;
      connectionIds.add(connection.id);
      return true;
    }),
  ];
  return {
    ...project,
    nodes,
    connections,
    selectedNodeIds: project.selectedNodeIds.filter(id => validNodeIds.has(id)),
  };
}

export class ProductionProjectionAdapter {
  private readonly appliedHashes = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<ProjectionSyncResult>>();

  constructor(private readonly options: ProductionProjectionAdapterOptions) {}

  sync(projectId: string): Promise<ProjectionSyncResult> {
    const existing = this.inFlight.get(projectId);
    if (existing) return existing;
    const pending = this.syncNow(projectId).finally(() => {
      if (this.inFlight.get(projectId) === pending) this.inFlight.delete(projectId);
    });
    this.inFlight.set(projectId, pending);
    return pending;
  }

  private async syncNow(projectId: string): Promise<ProjectionSyncResult> {
    if (!this.options.runtime) return 'unavailable';
    const response = await this.options.runtime.execute({
      protocolVersion: '1',
      commandId: `projection_${crypto.randomUUID()}`,
      command: 'workflow.projection.get',
      args: { projectId },
      actor: { kind: 'ui', instanceId: 'production_projection_adapter' },
    }) as { projection?: ProductionWorkflowProjection | null };
    const projection = response?.projection;
    if (!projection) return 'empty';
    if (
      typeof projection.projectionHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(projection.projectionHash)
    ) {
      throw new Error('Production Projection 缺少有效 Hash。');
    }
    if (this.appliedHashes.get(projectId) === projection.projectionHash) return 'unchanged';
    const project = this.options.getProject(projectId);
    if (!project) return 'unavailable';
    const merged = mergeProductionProjection(project, projection);
    this.options.updateProject(projectId, {
      nodes: merged.nodes,
      connections: merged.connections,
      selectedNodeIds: merged.selectedNodeIds,
    });
    this.appliedHashes.set(projectId, projection.projectionHash);
    return 'applied';
  }
}
