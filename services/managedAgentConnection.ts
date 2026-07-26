import { invoke, isTauri } from '@tauri-apps/api/core';

export interface ManagedAgentConnection {
  state: 'ready';
  url: string;
  token: string;
  managed: boolean;
}

interface ManagedAgentDiscoveryOptions {
  isTauri?: boolean;
  invoke?: <T>(command: string) => Promise<T>;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export async function getManagedAgentConnection(
  options: ManagedAgentDiscoveryOptions = {},
): Promise<ManagedAgentConnection | null> {
  const tauri = options.isTauri ?? (typeof window !== 'undefined' && isTauri());
  if (!tauri) return null;
  const connection = await (options.invoke || invoke)<ManagedAgentConnection>('managed_agent_connection');
  const endpoint = new URL(connection.url);
  if (endpoint.protocol !== 'http:' || !LOOPBACK_HOSTS.has(endpoint.hostname)) {
    throw new Error('Managed Agent connection must use a loopback HTTP endpoint.');
  }
  if (connection.state !== 'ready' || !connection.token?.trim()) {
    throw new Error('Managed Agent did not return a ready authenticated connection.');
  }
  return { ...connection, url: endpoint.origin };
}
