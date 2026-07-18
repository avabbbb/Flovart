import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { v7 as uuidv7 } from 'uuid';

import { validateCommandEnvelope, validateRuntimeContract } from './contracts.js';
import { getCanonicalRegistry } from './registry.js';

const DISCOVERY_SCHEMA_VERSION = '1';
const DEFAULT_TIMEOUT_MS = 1_500;
const execFileAsync = promisify(execFile);
let windowsSidPromise;

function windowsSystemExecutable(name) {
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', name);
}

export class RuntimeClientError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'RuntimeClientError';
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.details = options.details ?? null;
    this.actionUrl = options.actionUrl ?? null;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
      actionUrl: this.actionUrl,
    };
  }
}

export function defaultDiscoveryPath(env = process.env) {
  if (env.FLOVART_RUNTIME_DISCOVERY) return env.FLOVART_RUNTIME_DISCOVERY;
  if (platform() === 'win32') {
    if (!env.LOCALAPPDATA) throw unavailable('LOCALAPPDATA is not set.');
    return join(env.LOCALAPPDATA, 'Flovart', 'runtime', 'control-v1.json');
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Flovart', 'runtime', 'control-v1.json');
  }
  return join(env.XDG_RUNTIME_DIR || join(homedir(), '.local', 'share'), 'Flovart', 'runtime', 'control-v1.json');
}

export async function verifyDiscoveryPermissions(path) {
  const metadata = await stat(path);
  if (platform() === 'win32') {
    const directory = await mkdtemp(join(tmpdir(), 'flovart-acl-'));
    const aclPath = join(directory, 'acl.txt');
    try {
      windowsSidPromise ||= execFileAsync(windowsSystemExecutable('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
        timeout: DEFAULT_TIMEOUT_MS,
        windowsHide: true,
      }).then(({ stdout }) => stdout.match(/S-\d(?:-\d+)+/)?.[0]);
      const currentSid = await windowsSidPromise;
      if (!currentSid) throw new Error('current SID unavailable');
      await execFileAsync(windowsSystemExecutable('icacls.exe'), [path, '/save', aclPath, '/c', '/q'], {
        timeout: DEFAULT_TIMEOUT_MS,
        windowsHide: true,
      });
      const sddl = await readFile(aclPath, 'utf16le');
      const dacl = sddl.slice(sddl.indexOf('D:')).trim();
      const aces = [...dacl.matchAll(/\(([^)]*)\)/g)].map(match => match[1].split(';'));
      const allowed = new Set([currentSid, 'S-1-5-18', 'SY']);
      if (!dacl.startsWith('D:P') || aces.length < 2) throw new Error('unprotected DACL');
      if (aces.some(([type, , , , , sid]) => type !== 'A' || !allowed.has(sid))) {
        throw new Error('unexpected DACL principal');
      }
      if (!aces.some(([, , , , , sid]) => sid === currentSid)) throw new Error('current user missing');
      if (!aces.some(([, , , , , sid]) => sid === 'SY' || sid === 'S-1-5-18')) {
        throw new Error('system missing');
      }
    } catch {
      throw unavailable('Runtime discovery permissions are too broad.');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } else if ((metadata.mode & 0o077) !== 0) {
    throw unavailable('Runtime discovery permissions are too broad.');
  }
  return `${metadata.size}:${metadata.mtimeMs}`;
}

function unavailable(message, details = null) {
  return new RuntimeClientError('RUNTIME_UNAVAILABLE', message, { retryable: true, details });
}

function protocolMismatch(message, details = null) {
  return new RuntimeClientError('PROTOCOL_MISMATCH', message, { details });
}

function assertDiscovery(value) {
  const registry = getCanonicalRegistry();
  if (!value || typeof value !== 'object') throw unavailable('Runtime discovery record is invalid.');
  if (value.schemaVersion !== DISCOVERY_SCHEMA_VERSION) {
    throw protocolMismatch('Unsupported runtime discovery schema.', {
      expected: DISCOVERY_SCHEMA_VERSION,
      received: value.schemaVersion,
    });
  }
  if (value.protocolVersion !== registry.protocolVersion || value.registryHash !== registry.registryHash) {
    throw protocolMismatch('Runtime discovery contract does not match this client.', {
      expectedProtocolVersion: registry.protocolVersion,
      receivedProtocolVersion: value.protocolVersion,
      expectedRegistryHash: registry.registryHash,
      receivedRegistryHash: value.registryHash,
    });
  }
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65_535) {
    throw unavailable('Runtime discovery port is invalid.');
  }
  if (!Number.isInteger(value.pid) || value.pid < 1) throw unavailable('Runtime discovery PID is invalid.');
  if (typeof value.runtimeInstanceId !== 'string' || !value.runtimeInstanceId) {
    throw unavailable('Runtime discovery instance ID is invalid.');
  }
  if (typeof value.runtimeVersion !== 'string' || !value.runtimeVersion) {
    throw unavailable('Runtime discovery version is invalid.');
  }
  if (typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))) {
    throw unavailable('Runtime discovery start time is invalid.');
  }
  if (typeof value.token !== 'string' || !/^[a-f0-9]{64}$/i.test(value.token)) {
    throw unavailable('Runtime discovery token is invalid.');
  }
  return value;
}

function errorFromResponse(status, body) {
  const error = body?.error;
  if (validateRuntimeContract('runtime-error', error).ok) {
    return new RuntimeClientError(error.code, error.message, error);
  }
  return protocolMismatch(`Production Runtime returned an invalid HTTP ${status} error contract.`);
}

export class FlovartRuntimeClient {
  constructor(options = {}) {
    this.discoveryPath = options.discoveryPath || defaultDiscoveryPath();
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.permissionVerifier = options.permissionVerifier || verifyDiscoveryPermissions;
    this.discoveryPermissionsVerified = false;
  }

  async connect() {
    await this.status();
    return this;
  }

  async loadDiscovery() {
    try {
      if (!this.discoveryPermissionsVerified) {
        await this.permissionVerifier(this.discoveryPath);
        this.discoveryPermissionsVerified = true;
      }
      return assertDiscovery(JSON.parse(await readFile(this.discoveryPath, 'utf8')));
    } catch (error) {
      if (error instanceof RuntimeClientError) throw error;
      throw unavailable('Production Runtime is not running or its discovery record is unreadable.');
    }
  }

  async request(path, init = {}) {
    const discovery = await this.loadDiscovery();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await fetch(`http://127.0.0.1:${discovery.port}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${discovery.token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch {
      throw unavailable('Production Runtime is offline or did not respond in time.');
    } finally {
      clearTimeout(timer);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw unavailable('Production Runtime returned an invalid response.');
    }
    if (!response.ok) throw errorFromResponse(response.status, body);
    return { body, discovery };
  }

  async status() {
    const { body, discovery } = await this.request('/v1/status');
    const contract = validateRuntimeContract('runtime-status', body);
    if (!contract.ok) throw protocolMismatch('Production Runtime returned an invalid status contract.');
    if (body.runtimeInstanceId !== discovery.runtimeInstanceId) {
      throw unavailable('Runtime discovery record is stale.');
    }
    if (body.registryHash !== discovery.registryHash || body.protocolVersion !== discovery.protocolVersion) {
      throw protocolMismatch('Production Runtime status does not match its discovery record.');
    }
    return body;
  }

  async execute(command, args = {}, actor = { kind: 'cli', instanceId: `cli_${process.pid}` }) {
    const registry = getCanonicalRegistry();
    if (command === 'command.schema' && args.command && !registry.commands[args.command]) {
      throw new RuntimeClientError('UNKNOWN_COMMAND', `Unknown Flovart command: ${args.command}`);
    }
    const envelope = {
      protocolVersion: registry.protocolVersion,
      commandId: `cmd_${uuidv7()}`,
      command,
      args,
      actor,
    };
    const contract = validateCommandEnvelope(envelope);
    if (!contract.ok) throw new RuntimeClientError(contract.error.code, contract.error.message, contract.error);
    return (await this.request('/v1/commands', {
      method: 'POST',
      body: JSON.stringify(envelope),
    })).body;
  }

  async disconnect() {}
}

export function createRuntimeFacade(client) {
  return {
    _version: 'production-runtime-v1',
    status: () => client.status(),
    runtime: {
      status: () => client.status(),
      execute: (command, args, actor) => client.execute(command, args, actor),
    },
  };
}
