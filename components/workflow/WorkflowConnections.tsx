import type { MouseEvent as ReactMouseEvent } from 'react';
import type { WorkflowConnection, WorkflowNode, WorkflowPoint } from './types';

function connectionPath(from: WorkflowNode, to: WorkflowNode): string {
  const startX = from.position.x + from.width;
  const startY = from.position.y + from.height / 2;
  const endX = to.position.x;
  const endY = to.position.y + to.height / 2;
  const curve = Math.max(Math.abs(endX - startX) * 0.5, 50);
  return `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;
}

export function WorkflowConnections({
  nodes,
  connections,
  selectedId,
  active,
  onSelect,
  onContextMenu,
}: {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  selectedId: string | null;
  active?: { sourceId: string; point: WorkflowPoint; targetId?: string | null } | null;
  onSelect: (id: string) => void;
  onContextMenu: (event: ReactMouseEvent<SVGPathElement>, id: string) => void;
}) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const source = active ? byId.get(active.sourceId) : undefined;
  const target = active?.targetId ? byId.get(active.targetId) : undefined;
  return (
    <svg className="workflow-connections" aria-hidden="true">
      {connections.map(connection => {
        const from = byId.get(connection.fromNodeId);
        const to = byId.get(connection.toNodeId);
        if (!from || !to) return null;
        const path = connectionPath(from, to);
        return (
          <g key={connection.id}>
            <path
              data-workflow-connection-id={connection.id}
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth="16"
              pointerEvents="stroke"
              className="workflow-connection-hit"
              onPointerDown={event => event.stopPropagation()}
              onClick={event => { event.stopPropagation(); onSelect(connection.id); }}
              onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onContextMenu(event, connection.id); }}
            />
            <path d={path} fill="none" className={selectedId === connection.id ? 'workflow-connection is-selected' : 'workflow-connection'} />
          </g>
        );
      })}
      {target && (
        <rect
          x={target.position.x - 6}
          y={target.position.y - 6}
          width={target.width + 12}
          height={target.height + 12}
          rx="12"
          fill="color-mix(in srgb,var(--wf-accent) 10%,transparent)"
          stroke="var(--wf-accent)"
          strokeWidth="2"
          pointerEvents="none"
        />
      )}
      {source && active && (() => {
        const startX = source.position.x + source.width;
        const startY = source.position.y + source.height / 2;
        const endX = target ? target.position.x : active.point.x;
        const endY = target ? target.position.y + target.height / 2 : active.point.y;
        const curve = Math.max(Math.abs(endX - startX) * 0.5, 50);
        return <path d={`M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`} fill="none" className="workflow-connection is-active" />;
      })()}
    </svg>
  );
}
