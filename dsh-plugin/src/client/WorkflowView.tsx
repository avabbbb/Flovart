/**
 * DSH's browser half is a contextual view of Flovart's visible Workflow.
 * It never creates a local Draft, owns a mutation store, or calls a Provider.
 * Mutations stay in ctx.flovart and therefore use the same Browser Authority
 * as the Flovart WebUI.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react'
import type { ClientContext, ISessions, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { bridgeBus } from './bus.ts'
import { FlovartLinkClient, FlovartLinkError, type LinkWorkflowProject } from './linkClient.ts'

type WorkflowViewProps = Pick<ConvViewProps, 'sessionId'> & { session?: SessionFace }
type ViewStatus = 'idle' | 'connecting' | 'ready' | 'error'

const mutedTextStyle = { color: 'var(--dsw-alias-label-secondary, currentColor)' } as const
const buttonStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  minHeight: 28, padding: '4px 9px', border: '1px solid transparent', borderRadius: 6,
  background: 'transparent', color: 'var(--dsw-alias-label-primary, inherit)',
  fontSize: 12, cursor: 'pointer',
} as const

function statusLabel(status: ViewStatus): string {
  return status === 'ready' ? '已连接当前 Workflow' : status === 'connecting' ? '正在检查当前 Workflow' : status === 'error' ? 'Workflow 暂不可用' : '等待检查'
}

function statusColor(status: ViewStatus): string {
  return status === 'ready' ? 'var(--dsh-success, currentColor)' : status === 'error' ? 'var(--dsh-danger, currentColor)' : 'var(--dsh-warning, currentColor)'
}

function selectionContext(project: LinkWorkflowProject | null): string {
  if (!project) return JSON.stringify({ projectId: null, workflowId: null, selectedNodeIds: [] }, null, 2)
  return JSON.stringify({
    projectId: project.id,
    workflowId: project.id,
    revision: project.revision,
    selectedNodeIds: project.selectedNodeIds,
    selectedAssetIds: [],
    ...(project.selectedNodeIds[0] ? { focusedNodeId: project.selectedNodeIds[0] } : {}),
  }, null, 2)
}

function badges(project: LinkWorkflowProject) {
  return {
    waiting: project.nodes.filter(node => node.metadata.status === 'loading').length,
    error: project.nodes.filter(node => node.metadata.status === 'error').length,
    artifacts: project.nodes.filter(node => node.metadata.hasMedia === true).length,
  }
}

export function createWorkflowView(ctx: ClientContext) {
  const sessions = ctx.sessions as unknown as Pick<ISessions, 'scope' | 'sessionOf'>
  return function BoundWorkflowView(props: WorkflowViewProps): ReactElement {
    const scope = sessions.scope(props.sessionId)
    const session = scope ? sessions.sessionOf(scope) : undefined
    return <WorkflowView {...props} {...(session ? { session } : {})} />
  }
}

export function WorkflowView({ sessionId: _sessionId, session }: WorkflowViewProps): ReactElement {
  const client = useMemo(() => new FlovartLinkClient(), [])
  const [status, setStatus] = useState<ViewStatus>('idle')
  const [project, setProject] = useState<LinkWorkflowProject | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [promptState, setPromptState] = useState<'idle' | 'sending' | 'sent' | 'unavailable'>('idle')
  const requestRef = useRef(0)

  const refresh = useCallback(async (showProgress = true) => {
    const request = ++requestRef.current
    if (showProgress) setStatus('connecting')
    try {
      const health = await client.health()
      if (!health.hasWorkflow || health.clients < 1) {
        throw new FlovartLinkError('请先在 Flovart 中打开一个可见的 Workflow。', { code: 'WORKSPACE_REQUIRED', status: 409 })
      }
      const next = await client.inspect(health.activeProjectId || undefined)
      if (request !== requestRef.current) return
      setProject(next)
      setErrorText(null)
      setStatus('ready')
      bridgeBus.publish({ kind: 'connected' })
      bridgeBus.publish({ kind: 'badges', badges: badges(next) })
    } catch (error) {
      if (request !== requestRef.current) return
      setStatus('error')
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }, [client])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(false), 4000)
    return () => {
      requestRef.current += 1
      window.clearInterval(timer)
    }
  }, [refresh])

  const submitPrompt = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    const text = prompt.trim()
    if (!text) return
    if (!session) {
      setPromptState('unavailable')
      return
    }
    setPromptState('sending')
    try {
      const result = await session.prompt([{
        type: 'text',
        text: `<flovart_context>\n${selectionContext(project)}\n</flovart_context>\n\n${text}`,
      }], 'queue')
      if (typeof result === 'object' && result !== null && 'ok' in result && result.ok === false) throw new Error('DSH Agent 拒绝了这条消息。')
      setPrompt('')
      setPromptState('sent')
    } catch {
      setPromptState('unavailable')
    }
  }, [prompt, project, session])

  const header = (
    <header style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 42, padding: '6px 12px', borderBottom: '1px solid var(--dsh-border, rgba(128,128,128,0.25))', flexWrap: 'wrap' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 650, fontSize: 13 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(status) }} />
        <span>Flovart</span>
      </div>
      <span style={{ ...mutedTextStyle, fontSize: 11 }}>{statusLabel(status)}</span>
      {project && <span style={{ ...mutedTextStyle, fontSize: 11 }}>{project.title} · v{project.revision ?? '—'}</span>}
      <button type="button" style={{ ...buttonStyle, marginLeft: 'auto' }} onClick={() => void refresh()} disabled={status === 'connecting'}>刷新</button>
    </header>
  )

  const promptBar = (
    <form onSubmit={event => void submitPrompt(event)} style={{ display: 'grid', gap: 7, padding: '10px 12px', borderTop: '1px solid var(--dsh-border, rgba(128,128,128,0.25))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, ...mutedTextStyle }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: session ? 'var(--dsh-success, currentColor)' : 'var(--dsh-warning, currentColor)' }} />
        <span>Ask DSH Agent</span>
        <span>{session ? '已就绪' : '当前不可用，输入会保留'}</span>
        {project && project.selectedNodeIds.length > 0 && <span>已选 {project.selectedNodeIds.length} 个节点</span>}
        {promptState === 'sent' && <span style={{ marginLeft: 'auto' }}>已发送</span>}
        {promptState === 'sending' && <span style={{ marginLeft: 'auto' }}>发送中…</span>}
        {promptState === 'unavailable' && <span style={{ marginLeft: 'auto' }}>发送失败</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <textarea
          aria-label="Ask DSH Agent"
          value={prompt}
          onChange={event => { setPrompt(event.target.value); if (promptState !== 'idle') setPromptState('idle') }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitPrompt() } }}
          placeholder="在 DSH 主对话中告诉 Agent 要怎么改…"
          rows={2}
          style={{ flex: 1, minWidth: 0, resize: 'vertical', padding: '8px 10px', border: '1px solid var(--dsh-border, rgba(128,128,128,0.3))', borderRadius: 8, background: 'var(--dsh-bg-subtle, transparent)', color: 'var(--dsh-text, inherit)', font: 'inherit', fontSize: 12, lineHeight: 1.5 }}
        />
        <button type="submit" style={{ ...buttonStyle, minHeight: 34, background: 'var(--dsw-alias-button-primary-fill, #1f6feb)', color: 'var(--dsw-alias-label-primary-inverted, #fff)' }} disabled={!prompt.trim() || promptState === 'sending'}>发送</button>
      </div>
    </form>
  )

  if (status !== 'ready' || !project) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'var(--dsh-text, inherit)' }}>
        {header}
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24, overflow: 'auto' }}>
          <div style={{ width: 'min(520px, 100%)', display: 'grid', gap: 12, padding: 20, border: '1px solid var(--dsh-border, rgba(128,128,128,0.25))', borderRadius: 10, background: 'var(--dsh-bg-subtle, transparent)' }}>
            <strong>{status === 'error' ? 'Flovart Workflow 暂不可用' : '正在准备当前 Workflow'}</strong>
            <span style={{ ...mutedTextStyle, fontSize: 12, lineHeight: 1.6 }}>{errorText || '正在通过 Flovart Link 检查可见 Browser Workflow。DSH 不会创建隐藏副本。'}</span>
            {status === 'error' && <button type="button" style={{ ...buttonStyle, width: 'fit-content', background: 'var(--dsw-alias-button-primary-fill, #1f6feb)', color: 'var(--dsw-alias-label-primary-inverted, #fff)' }} onClick={() => void refresh()}>重新检查</button>}
          </div>
        </div>
        {promptBar}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'var(--dsh-text, inherit)' }}>
      {header}
      <main style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14, display: 'grid', gap: 12, alignContent: 'start' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{project.title}</h2>
          <span style={{ ...mutedTextStyle, fontSize: 11 }}>{project.nodes.length} 个节点 · {project.connections.length} 条连接</span>
        </div>
        <p style={{ ...mutedTextStyle, margin: 0, fontSize: 12, lineHeight: 1.6 }}>这里显示 Flovart 当前可见 Workflow 的摘要；修改和生成由 DSH 的 Flovart tools 通过同一份 Browser Authority 执行。</p>
        <div style={{ display: 'grid', gap: 8 }} aria-label="当前 Workflow 节点">
          {project.nodes.length === 0 && <span style={{ ...mutedTextStyle, fontSize: 12 }}>当前 Workflow 还没有节点。</span>}
          {project.nodes.map(node => (
            <article key={node.id} style={{ padding: '9px 10px', border: '1px solid var(--dsh-border, rgba(128,128,128,0.25))', borderRadius: 8, background: 'var(--dsh-bg-subtle, transparent)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                <strong>{node.title}</strong>
                <span style={mutedTextStyle}>{node.type}</span>
              </div>
              {typeof node.metadata.prompt === 'string' && <p style={{ ...mutedTextStyle, margin: '5px 0 0', fontSize: 11, lineHeight: 1.5 }}>{node.metadata.prompt}</p>}
            </article>
          ))}
        </div>
      </main>
      {errorText && <div role="alert" style={{ padding: '6px 12px', borderTop: '1px solid var(--dsh-danger, currentColor)', fontSize: 12 }}>{errorText}</div>}
      {promptBar}
    </div>
  )
}
