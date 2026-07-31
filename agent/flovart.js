import path from 'node:path';
import { AGENT_DIR, workspaceForProject } from './config.js';
import { FlovartAgentKernel } from './kernel.js';
import { createProductionRuntimeStream, RUNTIME_AGENT_TEXT_MODEL } from './runtime-connection.js';

export class FlovartAgentService {
  constructor({
    databasePath = path.join(AGENT_DIR, 'agent-sessions.db'),
    model = RUNTIME_AGENT_TEXT_MODEL,
    streamFn = createProductionRuntimeStream(),
    tools = [],
  } = {}) {
    this.databasePath = databasePath;
    this.model = model;
    this.streamFn = streamFn;
    this.tools = tools;
    this.sessions = new Map();
  }

  async getSession(projectId) {
    const id = String(projectId || 'default');
    let session = this.sessions.get(id);
    if (!session) {
      session = (async () => {
        const kernel = new FlovartAgentKernel({
          databasePath: this.databasePath,
          model: this.model,
          streamFn: this.streamFn,
          tools: this.tools,
        });
        await kernel.openSession({ projectId: id, cwd: workspaceForProject(id) });
        return kernel;
      })();
      this.sessions.set(id, session);
      session.catch(() => this.sessions.delete(id));
    }
    return session;
  }

  async snapshot(projectId) {
    return (await this.getSession(projectId)).snapshot();
  }

  async send(projectId, text, images = []) {
    return (await this.getSession(projectId)).send(text, images);
  }

  async subscribe(projectId, listener) {
    return (await this.getSession(projectId)).subscribe(listener);
  }

  async cancel(projectId) {
    (await this.getSession(projectId)).cancel();
  }

  async close() {
    const sessions = await Promise.allSettled(this.sessions.values());
    await Promise.all(sessions.flatMap(result => result.status === 'fulfilled' ? [result.value.close()] : []));
    this.sessions.clear();
  }
}
