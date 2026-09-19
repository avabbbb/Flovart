import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_AGENT_PORT = 17373;
// Canonical agent config resolution order:
//   FLOVART_AGENT_CONFIG (explicit file)
//   → FLOVART_AGENT_HOME (home dir, file = <home>/agent.json)
//   → canonical dir (~/.flovart, file = ~/.flovart/agent.json)
//   → ~/.flovart/agent.json
// tools/flovart/local-agent.js replicates this exact order for the packaged CLI,
// which cannot import this module.
export function resolveAgentHome(env = process.env) {
  const configured = env.FLOVART_AGENT_CONFIG ? path.resolve(env.FLOVART_AGENT_CONFIG) : null;
  const dir = env.FLOVART_AGENT_HOME
    ? path.resolve(env.FLOVART_AGENT_HOME)
    : configured
      ? path.dirname(configured)
      : path.join(os.homedir(), '.flovart');
  return { dir, configFile: configured || path.join(dir, 'agent.json') };
}

const agentHome = resolveAgentHome();
export const AGENT_DIR = agentHome.dir;
export const AGENT_CONFIG_FILE = agentHome.configFile;

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
  fs.mkdirSync(path.dirname(AGENT_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(AGENT_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

export function workspaceForProject(projectId = 'default') {
  const safe = String(projectId).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'default';
  const directory = path.join(AGENT_DIR, 'workspaces', safe);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}
