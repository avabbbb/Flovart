import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_AGENT_PORT = 17372;
export const AGENT_DIR = path.join(os.homedir(), '.flovart');
export const AGENT_CONFIG_FILE = path.join(AGENT_DIR, 'agent.json');

export function loadAgentConfig(create = false) {
  try {
    return JSON.parse(fs.readFileSync(AGENT_CONFIG_FILE, 'utf8'));
  } catch {
    const port = Number(process.env.FLOVART_AGENT_PORT) || DEFAULT_AGENT_PORT;
    const config = { url: `http://127.0.0.1:${port}`, token: crypto.randomBytes(18).toString('hex'), origin: null, threads: {} };
    if (create) saveAgentConfig(config);
    return config;
  }
}

export function saveAgentConfig(config) {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.writeFileSync(AGENT_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

export function workspaceForProject(projectId = 'default') {
  const safe = String(projectId).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'default';
  const directory = path.join(AGENT_DIR, 'workspaces', safe);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}
