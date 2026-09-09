import { inspectLocalAgent, waitForWebUi, buildBrowserBootstrapUrl, issueBrowserBootstrapToken } from './local-agent.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function browserReady(result) {
  return result?.state === 'ready'
    && Number(result.health?.clients || 0) > 0
    && Boolean(result.health?.hasWorkflow);
}

function browserSnapshot(result, status = 'connected') {
  return {
    status,
    connected: status === 'connected',
    clientId: result?.health?.clientId || null,
    projectId: result?.health?.activeProjectId || null,
    revision: numericOrNull(result?.health?.revision),
    activeHostWriter: result?.health?.activeHostWriter || null,
  };
}

/**
 * Coordinates only local service/browser readiness. Workflow mutations,
 * provider execution, and agent reasoning remain outside this seam.
 */
export class FlovartBootstrapCoordinator {
  constructor(options = {}) {
    this.inspectAgent = options.inspectAgent || inspectLocalAgent;
    this.waitForWeb = options.waitForWeb || waitForWebUi;
    this.buildBootstrapUrl = options.buildBootstrapUrl || buildBrowserBootstrapUrl;
    this.issueBootstrapToken = options.issueBootstrapToken
      || (this.buildBootstrapUrl === buildBrowserBootstrapUrl ? issueBrowserBootstrapToken : null);
    this.openBrowser = options.openBrowser || (() => {});
    this.sleep = options.sleep || sleep;
  }

  async start({ ensureAgent, launchWeb, open = false, route = '#/app', timeoutMs = 20_000 } = {}) {
    const agentRequired = Boolean(ensureAgent);
    let connection = null;
    let webProcess = null;
    let agentError = null;
    let frontendError = null;
    try {
      connection = (await ensureAgent?.()) || null;
    } catch (error) {
      agentError = error instanceof Error ? error.message : String(error);
    }
    try {
      webProcess = (await launchWeb?.()) || null;
    } catch (error) {
      frontendError = error instanceof Error ? error.message : String(error);
    }
    let frontendUrl = null;
    if (!frontendError) {
      try {
        frontendUrl = await this.resolveWebUrl(webProcess, timeoutMs);
      } catch (error) {
        frontendError = error instanceof Error ? error.message : String(error);
      }
    }
    const result = {
      ok: Boolean((!webProcess || frontendUrl) && (!agentRequired || connection)),
      runtime: { status: connection ? 'ready' : 'offline', surface: 'browser-workflow' },
      frontend: frontendUrl ? { status: 'ready', url: frontendUrl } : { status: 'offline', url: null },
      agent: connection ? { status: 'ready', url: connection.url } : { status: 'offline', url: null },
      browser: { status: 'not-opened', connected: false, clientId: null, projectId: null, revision: null },
      browserOpened: false,
    };
    if (agentError) result.agent.error = agentError;
    if (frontendError) result.frontend.error = frontendError;
    if (!open || !frontendUrl) return result;

    let bootstrapUrl = frontendUrl;
    if (!connection) {
      const url = new URL(frontendUrl);
      url.hash = route.startsWith('#') ? route : `#${route}`;
      bootstrapUrl = url.toString();
    }
    let previousBrowserClientId = null;
    if (connection) {
      try {
        const beforeOpen = await this.inspectAgent(connection, { timeoutMs: 800 });
        if (browserReady(beforeOpen)) {
          result.browser = browserSnapshot(beforeOpen);
          result.browserOpened = false;
          result.ok = true;
          return result;
        }
        previousBrowserClientId = beforeOpen?.health?.activeWriter?.clientId || beforeOpen?.health?.clientId || null;
      } catch {
        // The post-open poll remains authoritative if the pre-open probe races startup.
      }
    }
    if (connection) {
      try {
        const browserConnection = this.issueBootstrapToken
          ? { ...connection, bootstrapToken: await this.issueBootstrapToken(connection, { timeoutMs: 800 }) }
          : connection;
        bootstrapUrl = this.buildBootstrapUrl(frontendUrl, browserConnection, route);
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        result.ok = false;
        return result;
      }
    }
    try {
      const opened = this.openBrowser(bootstrapUrl);
      result.browserOpened = opened !== false;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.ok = false;
      return result;
    }
    if (!connection) {
      result.browser.status = 'offline';
      result.error = result.error || 'Flovart Agent 未启动，已打开 WebUI 但 Browser Workflow 尚未绑定。';
      result.ok = false;
      return result;
    }
    const browser = await this.waitForBrowser(connection, timeoutMs, previousBrowserClientId);
    result.browser = browser;
    result.ok = browser.status === 'connected';
    if (!result.ok) result.error = browser.error || '等待浏览器 Workflow 连接超时。';
    return result;
  }

  async resolveWebUrl(webProcess, timeoutMs) {
    if (!webProcess) return null;
    const direct = typeof webProcess === 'string' ? webProcess : webProcess.url || await webProcess.getUrl?.();
    if (direct) return this.waitForWeb(direct, { timeoutMs });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const candidate = await webProcess.getUrl?.();
      if (candidate) return this.waitForWeb(candidate, { timeoutMs: Math.max(500, deadline - Date.now()) });
      if (webProcess.child?.exitCode !== null && webProcess.child?.exitCode !== undefined) break;
      await this.sleep(100);
    }
    return null;
  }

  async waitForBrowser(connection, timeoutMs, previousClientId = null) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() <= deadline) {
      last = await this.inspectAgent(connection, { timeoutMs: 800 });
      const activeClientId = last?.health?.activeWriter?.clientId || last?.health?.clientId || null;
      const openedPageReady = !previousClientId || activeClientId !== previousClientId;
      if (browserReady(last) && openedPageReady) {
        return {
          status: 'connected',
          connected: true,
          clientId: last.health.clientId || null,
          projectId: last.health.activeProjectId || null,
          revision: numericOrNull(last.health.revision),
          activeHostWriter: last.health.activeHostWriter || null,
        };
      }
      await this.sleep(250);
    }
    return {
      status: 'pending',
      connected: false,
      clientId: last?.health?.clientId || null,
      projectId: last?.health?.activeProjectId || null,
      revision: numericOrNull(last?.health?.revision),
      activeHostWriter: last?.health?.activeHostWriter || null,
      error: previousClientId
        ? '等待新打开的浏览器 Workflow 成为 Active Writer 超时。请重新打开 Flovart。'
        : '等待浏览器 Workflow 连接超时。请重新打开 Flovart。',
    };
  }
}

function numericOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
