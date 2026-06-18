import type { WorkflowNode, WorkflowViewport } from './types';

const MAP_WIDTH = 150;
const MAP_HEIGHT = 96;
const MAP_INSET = 8;

export function WorkflowMiniMap({ nodes, viewport, onCenter }: { nodes: WorkflowNode[]; viewport: WorkflowViewport; onCenter: (x: number, y: number) => void }) {
  if (nodes.length === 0) return null;
  const minX = Math.min(...nodes.map(node => node.position.x));
  const minY = Math.min(...nodes.map(node => node.position.y));
  const maxX = Math.max(...nodes.map(node => node.position.x + node.width));
  const maxY = Math.max(...nodes.map(node => node.position.y + node.height));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = Math.min(MAP_WIDTH / width, MAP_HEIGHT / height);
  const contentWidth = width * scale;
  const contentHeight = height * scale;
  const offsetX = MAP_INSET + (MAP_WIDTH - contentWidth) / 2;
  const offsetY = MAP_INSET + (MAP_HEIGHT - contentHeight) / 2;
  return (
    <button
      type="button"
      data-workflow-overlay
      className="workflow-minimap"
      aria-label="工作流小地图"
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        const localX = Math.max(offsetX, Math.min(offsetX + contentWidth, event.clientX - rect.left));
        const localY = Math.max(offsetY, Math.min(offsetY + contentHeight, event.clientY - rect.top));
        const x = minX + (localX - offsetX) / scale;
        const y = minY + (localY - offsetY) / scale;
        onCenter(x, y);
      }}
    >
      {nodes.map(node => {
        const nodeWidth = Math.max(3, node.width * scale);
        const nodeHeight = Math.max(3, node.height * scale);
        const centerX = offsetX + (node.position.x + node.width / 2 - minX) * scale;
        const centerY = offsetY + (node.position.y + node.height / 2 - minY) * scale;
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
