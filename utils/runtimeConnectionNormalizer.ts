import type { RuntimeConnection, RuntimeEntity } from '../types/runtime';

function runtimeConnectionKey(connection: RuntimeConnection): string {
  return [
    connection.sourceEntityId,
    connection.targetEntityId,
    connection.kind,
    connection.role ?? '',
    connection.sourcePort ?? '',
    connection.targetPort ?? '',
  ].join('::');
}

export function normalizeRuntimeConnections(
  entities: Record<string, RuntimeEntity>,
  connections: RuntimeConnection[],
): Record<string, RuntimeConnection> {
  const normalized: Record<string, RuntimeConnection> = {};
  const seen = new Set<string>();

  for (const connection of connections) {
    if (!connection?.id) continue;
    if (!entities[connection.sourceEntityId] || !entities[connection.targetEntityId]) continue;
    if (connection.sourceEntityId === connection.targetEntityId) continue;

    const key = runtimeConnectionKey(connection);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized[connection.id] = { ...connection };
  }

  return normalized;
}
