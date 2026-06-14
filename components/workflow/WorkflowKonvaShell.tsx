import React, { useMemo } from 'react';
import { Circle, Group, Layer, Path, Rect, Stage, Text } from 'react-konva';
import { NODE_DEFS } from '../nodeflow/defs';
import { getBezierPath, getPortPosition } from '../nodeflow/graph';
import type { WorkflowEdge, WorkflowGroup, WorkflowNode, WorkflowViewport } from '../nodeflow/types';

interface WorkflowKonvaShellProps {
  width: number;
  height: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  groups: WorkflowGroup[];
  viewport: WorkflowViewport;
  selectedNodeIds: string[];
  activeNodeId?: string | null;
  onNodeSelect?: (nodeId: string, additive: boolean) => void;
}

type EdgePath = {
  id: string;
  d: string;
  selected: boolean;
};

const NODE_FILL = '#ffffff';
const NODE_STROKE = '#d6d3d1';
const NODE_SELECTED_STROKE = '#60a5fa';
const NODE_ACTIVE_STROKE = '#10b981';
const EDGE_STROKE = '#94a3b8';
const GROUP_FILL = 'rgba(14, 165, 233, 0.06)';
const GROUP_STROKE = 'rgba(14, 165, 233, 0.34)';

function portIndex(node: WorkflowNode | undefined, portKey: string, output: boolean): number {
  if (!node) return -1;
  const def = NODE_DEFS[node.kind];
  if (!def) return -1;
  const ports = output ? def.outputs : def.inputs;
  return ports.findIndex((port) => port.key === portKey);
}

function buildEdgePaths(nodes: WorkflowNode[], edges: WorkflowEdge[], selectedNodeIds: string[]): EdgePath[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  return edges.flatMap((edge) => {
    const source = nodeMap.get(edge.fromNode);
    const target = nodeMap.get(edge.toNode);
    const sourceIndex = portIndex(source, edge.fromPort, true);
    const targetIndex = portIndex(target, edge.toPort, false);
    if (!source || !target || sourceIndex < 0 || targetIndex < 0) return [];

    const from = getPortPosition(source, sourceIndex, true);
    const to = getPortPosition(target, targetIndex, false);
    return [{
      id: edge.id,
      d: getBezierPath(from, to),
      selected: selectedNodeIds.includes(source.id) || selectedNodeIds.includes(target.id),
    }];
  });
}

export const WorkflowKonvaShell: React.FC<WorkflowKonvaShellProps> = ({
  width,
  height,
  nodes,
  edges,
  groups,
  viewport,
  selectedNodeIds,
  activeNodeId,
  onNodeSelect,
}) => {
  const selected = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const edgePaths = useMemo(() => buildEdgePaths(nodes, edges, selectedNodeIds), [edges, nodes, selectedNodeIds]);

  return (
    <Stage
      width={width}
      height={height}
      data-testid="workflow-konva-stage"
    >
      <Layer>
        <Group
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          data-testid="workflow-konva-world"
        >
          {groups.map((group) => (
            <Group key={group.id} data-testid={`workflow-konva-group-${group.id}`}>
              <Rect
                x={group.x}
                y={group.y}
                width={group.width}
                height={group.height}
                cornerRadius={14}
                fill={GROUP_FILL}
                stroke={GROUP_STROKE}
                strokeWidth={1}
              />
              <Text
                x={group.x + 12}
                y={group.y + 8}
                text={group.title}
                fontSize={11}
                fontFamily="Inter, system-ui, sans-serif"
                fill="#0f766e"
              />
            </Group>
          ))}

          {edgePaths.map((edge) => (
            <Path
              key={edge.id}
              data={edge.d}
              stroke={edge.selected ? '#38bdf8' : EDGE_STROKE}
              strokeWidth={edge.selected ? 2.4 : 1.8}
              lineCap="round"
              lineJoin="round"
              data-testid={`workflow-konva-edge-${edge.id}`}
            />
          ))}

          {nodes.map((node) => {
            const def = NODE_DEFS[node.kind];
            if (!def) return null;
            const isSelected = selected.has(node.id);
            const isActive = activeNodeId === node.id;
            const title = node.config?.label || def.title;

            return (
              <Group
                key={node.id}
                x={node.x}
                y={node.y}
                data-testid={`workflow-konva-node-${node.id}`}
                onClick={(event) => onNodeSelect?.(node.id, Boolean(event.evt?.metaKey || event.evt?.ctrlKey))}
                onTap={() => onNodeSelect?.(node.id, false)}
              >
                <Rect
                  width={def.width}
                  height={def.height}
                  cornerRadius={8}
                  fill={NODE_FILL}
                  stroke={isActive ? NODE_ACTIVE_STROKE : isSelected ? NODE_SELECTED_STROKE : NODE_STROKE}
                  strokeWidth={isActive || isSelected ? 2 : 1}
                  shadowColor="rgba(15, 23, 42, 0.12)"
                  shadowBlur={8}
                  shadowOffsetY={2}
                />
                <Rect
                  width={def.width}
                  height={30}
                  cornerRadius={[8, 8, 0, 0]}
                  fill={isActive ? '#ecfdf5' : isSelected ? '#eff6ff' : '#fafaf9'}
                />
                <Text
                  x={12}
                  y={9}
                  width={def.width - 24}
                  text={title}
                  fontSize={12}
                  fontFamily="Inter, system-ui, sans-serif"
                  fontStyle="600"
                  fill="#1c1917"
                  listening={false}
                />
                {def.inputs.map((port, index) => (
                  <Circle
                    key={`input-${port.key}`}
                    x={0}
                    y={50 + index * 22}
                    radius={6}
                    fill="#ffffff"
                    stroke="#94a3b8"
                    strokeWidth={1}
                  />
                ))}
                {def.outputs.map((port, index) => (
                  <Circle
                    key={`output-${port.key}`}
                    x={def.width}
                    y={50 + index * 22}
                    radius={6}
                    fill="#ffffff"
                    stroke="#64748b"
                    strokeWidth={1}
                  />
                ))}
              </Group>
            );
          })}
        </Group>
      </Layer>
    </Stage>
  );
};
