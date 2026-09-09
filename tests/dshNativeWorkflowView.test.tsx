import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkflowView } from '../dsh-plugin/src/client/WorkflowView'

const sessionId = 'deepseek-session' as Parameters<typeof WorkflowView>[0]['sessionId']

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

function project(title = '海洋保护短片') {
  return {
    id: 'workflow-brief',
    title,
    nodes: [{
      id: 'brief-node',
      type: 'text',
      title: 'Production Brief',
      metadata: { prompt: '制作一支 60 秒海洋保护短片' },
    }],
    connections: [],
    selectedNodeIds: ['brief-node'],
    draftVersion: 2,
  }
}

function installBrowserWorkflowMock(
  workflow = project(),
  health = { ok: true, hasWorkflow: true, clients: 1, activeProjectId: 'workflow-brief', revision: 2 },
) {
  const requests: Array<{ command?: string; args?: Record<string, unknown> }> = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const pathname = url.pathname.replace(/^\/flovart-workspace/, '')
    if (pathname === '/health') return jsonResponse(health)
    if (pathname === '/api/tools') {
      const body = JSON.parse(String(init?.body || '{}')) as { command?: string; args?: Record<string, unknown> }
      requests.push(body)
      if (body.command === 'workflow.inspect') return jsonResponse({ ok: true, result: { ok: true, result: workflow } })
      if (body.command === 'workflow.selection.get') return jsonResponse({ ok: true, result: { ok: true, result: { selectedNodeIds: workflow.selectedNodeIds } } })
    }
    return jsonResponse({ ok: false, error: { code: 'UNEXPECTED_REQUEST', message: pathname } }, 500)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, requests }
}

describe('DeepSeek Harness contextual Workflow view', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the visible Browser Workflow without creating a native draft or exposing connection fields', async () => {
    const { requests } = installBrowserWorkflowMock()

    render(<WorkflowView sessionId={sessionId} />)

    expect(await screen.findByRole('heading', { name: '海洋保护短片' })).toBeInTheDocument()
    expect(screen.getByText('Production Brief')).toBeInTheDocument()
    expect(screen.getByText('1 个节点 · 0 条连接')).toBeInTheDocument()
    expect(screen.queryByText(/Native|native|Token|URL|Director Binding/)).not.toBeInTheDocument()
    expect(requests).toContainEqual(expect.objectContaining({
      command: 'workflow.inspect',
      args: expect.objectContaining({ workspaceMode: 'browser' }),
    }))
  })

  it('fails closed when no visible Browser Workflow is connected', async () => {
    const { fetchMock } = installBrowserWorkflowMock(project(), {
      ok: true,
      hasWorkflow: true,
      clients: 0,
      activeProjectId: 'workflow-brief',
      revision: 2,
    })

    render(<WorkflowView sessionId={sessionId} />)

    expect(await screen.findByText('Flovart Workflow 暂不可用')).toBeInTheDocument()
    expect(screen.getByText('请先在 Flovart 中打开一个可见的 Workflow。')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith('/api/tools'))).toBe(false)
  })

  it('sends the visible Workflow selection as context to the current DSH session', async () => {
    const prompt = vi.fn(async (_messages: Array<{ type: string; text: string }>, _mode: string) => ({ ok: true, result: { accepted: true } }))
    installBrowserWorkflowMock()

    render(<WorkflowView sessionId={sessionId} session={{ prompt } as never} />)
    expect(await screen.findByText('Production Brief')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask DSH Agent' }), { target: { value: '把这个节点改成夜景' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    expect(prompt.mock.calls[0]?.[0]?.[0]?.text).toContain('"projectId": "workflow-brief"')
    expect(prompt.mock.calls[0]?.[0]?.[0]?.text).toContain('"selectedNodeIds": [\n    "brief-node"\n  ]')
    expect(prompt.mock.calls[0]?.[0]?.[0]?.text).toContain('把这个节点改成夜景')
  })
})
