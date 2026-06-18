import type { WorkflowNode, WorkflowViewport } from './types';

export function WorkflowMiniMap({ nodes, viewport, onCenter }: { nodes: WorkflowNode[]; viewport: WorkflowViewport; onCenter: (x: number, y: number) => void }) {
  if (nodes.length === 0) return null;
  const minX = Math.min(...nodes.map(node => node.position.x));
  const minY = Math.min(...nodes.map(node => node.position.y));
  const maxX = Math.max(...nodes.map(node => node.position.x + node.width));
  const maxY = Math.max(...nodes.map(node => node.position.y + node.height));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = Math.min(150 / width, 96 / height);
  return (
    <button
      type="button"
      data-workflow-overlay
      className="workflow-minimap"
      aria-label="工作流小地图"
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = minX + Math.max(0, Math.min(150, event.clientX - rect.left)) / scale;
        const y = minY + Math.max(0, Math.min(96, event.clientY - rect.top)) / scale;
        onCenter(x, y);
      }}
    >
      {nodes.map(node => {
        const nodeWidth = Math.max(3, node.width * scale);
        const nodeHeight = Math.max(3, node.height * scale);
        const centerX = (node.position.x + node.width / 2 - minX) * scale;
        const centerY = (node.position.y + node.height / 2 - minY) * scale;
        return (
          <span
            key={node.id}
            className={`workflow-minimap__node workflow-minimap__node--${node.type}`}
            style={{ left: centerX - nodeWidth / 2, top: centerY - nodeHeight / 2, width: nodeWidth, height: nodeHeight }}
          />
        );
      })}
      <span className="workflow-minimap__zoom">{Math.round(viewport.k * 100)}%</span>
    </button>
  );
}
