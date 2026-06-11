import type { Element } from '../types';
import { elementCanSource, elementCanTarget } from './elementRegistry';

export interface CanvasConnection {
  id: string;
  sourceId: string;
  targetId: string;
  sourceRole?: string;
  targetRole?: string;
}

export function normalizeCanvasConnections(
  elements: Element[],
  connections: CanvasConnection[],
): CanvasConnection[] {
  const elementById = new Map(elements.map((element) => [element.id, element] as const));
  const seen = new Set<string>();

  return connections.filter((connection) => {
    const source = elementById.get(connection.sourceId);
    const target = elementById.get(connection.targetId);
    if (!source || !target || !elementCanSource(source) || !elementCanTarget(target)) {
      return false;
    }

    const key = `${connection.sourceId}:${connection.targetId}:${connection.sourceRole ?? ''}:${connection.targetRole ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
