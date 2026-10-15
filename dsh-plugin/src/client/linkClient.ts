export interface LinkWorkflowNode {
  id: string
  type: string
  title: string
  metadata: Record<string, unknown>
}

export interface LinkWorkflowProject {
  id: string
  title: string
  nodes: LinkWorkflowNode[]
  connections: Array<{ id: string; fromNodeId: string; toNodeId: string }>
  selectedNodeIds: string[]
  revision: number | null
}

export interface LinkHealth {
  ok: boolean
  hasWorkflow: boolean
  clients: number
  activeProjectId: string | null
  revision: number | null
}

export class FlovartLinkError extends Error {
  readonly code: string | null
  readonly status: number
  readonly details: Record<string, unknown> | null

  constructor(message: string, options: { code?: string | null; status: number; details?: Record<string, unknown> | null }) {
    super(message)
    this.name = 'FlovartLinkError'
    this.code = options.code || null
    this.status = options.status
    this.details = options.details || null
  }
}

const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
)

const text = (value: unknown, fallback: string): string => {
  const result = typeof value === 'string' ? value.trim() : ''
  return result || fallback
}

const number = (value: unknown): number | null => {
  const result = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(result) ? result : null
}

function unwrapResult(value: unknown): unknown {
  const source = record(value)
  if (!source) return value
  if (source.ok === false) {
    const error = record(source.error)
    throw new FlovartLinkError(
      text(error?.message || source.message, 'Flovart Workflow 命令失败。'),
      { code: typeof error?.code === 'string' ? error.code : null, status: 400, details: record(error?.details) },
    )
  }
  return 'result' in source ? unwrapResult(source.result) : 'data' in source ? unwrapResult(source.data) : value
}

function normalizeProject(value: unknown): LinkWorkflowProject | null {
  const source = record(unwrapResult(value))
  if (!source) return null
  const id = text(source.projectId || source.id, '')
  if (!id || !Array.isArray(source.nodes)) return null
  const nodes = source.nodes.flatMap((item, index) => {
    const node = record(item)
    if (!node) return []
    return [{
      id: text(node.id, `node-${index + 1}`),
      type: text(node.type, 'unknown'),
      title: text(node.title, '未命名节点'),
      metadata: record(node.metadata) || {},
    }]
  })
  const nodeIds = new Set(nodes.map(node => node.id))
  const connections = Array.isArray(source.connections)
    ? source.connections.flatMap((item, index) => {
      const connection = record(item)
      const fromNodeId = text(connection?.fromNodeId, '')
      const toNodeId = text(connection?.toNodeId, '')
      if (!connection || !nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) return []
      return [{ id: text(connection.id, `connection-${index + 1}`), fromNodeId, toNodeId }]
    })
    : []
  return {
    id,
    title: text(source.title, '未命名工作流'),
    nodes,
    connections,
    selectedNodeIds: Array.isArray(source.selectedNodeIds)
      ? source.selectedNodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeIds.has(nodeId))
      : [],
    revision: number(source.draftVersion ?? source.revision),
  }
}

export class FlovartLinkClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(options: { url?: string; fetch?: typeof globalThis.fetch } = {}) {
    this.baseUrl = (options.url || new URL('/flovart-workspace', globalThis.location.origin).toString()).replace(/\/+$/, '')
    this.fetchImpl = options.fetch || globalThis.fetch.bind(globalThis)
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchImpl(new URL(`${this.baseUrl}/${path.replace(/^\/+/, '')}`), {
        ...init,
        headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },
      })
    } catch {
      throw new FlovartLinkError('Flovart 本地服务暂时不可用。', { code: 'LINK_OFFLINE', status: 0 })
    }
    const body = await response.json().catch(() => null)
    if (!response.ok || record(body)?.ok === false) {
      const error = record(record(body)?.error)
      throw new FlovartLinkError(text(error?.message || record(body)?.message, `Flovart Link 返回 HTTP ${response.status}`), {
        code: typeof error?.code === 'string' ? error.code : null,
        status: response.status,
        details: record(error?.details),
      })
    }
    return body
  }

  async health(): Promise<LinkHealth> {
    const body = record(await this.request('/health')) || {}
    return {
      ok: body.ok !== false,
      hasWorkflow: Boolean(body.hasWorkflow),
      clients: Number(body.clients || 0),
      activeProjectId: typeof body.activeProjectId === 'string' ? body.activeProjectId : null,
      revision: number(body.revision),
    }
  }

  async command(command: string, args: Record<string, unknown> = {}, idempotencyKey?: string): Promise<unknown> {
    const body = await this.request('/api/tools', {
      method: 'POST',
      body: JSON.stringify({ command, args: { ...args, workspaceMode: 'browser' }, source: 'agent', ...(idempotencyKey ? { idempotencyKey } : {}) }),
    })
    return unwrapResult(record(body)?.result ?? body)
  }

  async inspect(projectId?: string): Promise<LinkWorkflowProject> {
    const project = normalizeProject(await this.command('workflow.inspect', projectId ? { projectId } : {}))
    if (!project) throw new FlovartLinkError('当前 Workflow 返回的数据格式无效。', { code: 'WORKSPACE_UNAVAILABLE', status: 503 })
    return project
  }

  selection(projectId?: string): Promise<unknown> {
    return this.command('workflow.selection.get', projectId ? { projectId } : {})
  }
}
