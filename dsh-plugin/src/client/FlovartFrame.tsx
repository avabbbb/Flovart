// The visible Flovart page itself, embedded same-origin. DSH keeps no second
// store or writer: it only relays theme/locale, hands over a one-time
// bootstrap token fetched from the host, and turns start-session requests
// into a DSH draft (never auto-sent).
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { BOOTSTRAP_URL, FRAME_SRC, MESSAGE, isRecord, postBootstrap, postState, registerFrame } from './frameBridge.ts'

type FrameStatus = 'loading' | 'connecting' | 'ready' | 'error'

const MAX_PROMPT = 20000

const STATUS_LABEL: Record<FrameStatus, string> = {
  loading: '正在加载画布',
  connecting: '正在连接 Workspace Operator',
  ready: '已连接',
  error: '连接失败',
}

const STATUS_COLOR: Record<FrameStatus, string> = {
  loading: 'var(--dsh-warning, #d8a32a)',
  connecting: 'var(--dsh-warning, #d8a32a)',
  ready: 'var(--dsh-success, #2fa86b)',
  error: 'var(--dsh-danger, #d9534f)',
}

const GLASS = 'color-mix(in srgb, var(--dsw-alias-bg-layer-2, #f1efe9) 72%, transparent)'
const BLUR = 'blur(24px) saturate(160%)'

const shellStyle = {
  display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0,
  background: 'var(--dsw-alias-bg-base, transparent)',
  color: 'var(--dsw-alias-label-primary, inherit)',
  fontFamily: 'var(--dsw-font-family, inherit)',
} as const

const headerStyle = {
  display: 'flex', alignItems: 'center', gap: 8, minHeight: 36,
  padding: '6px 10px', paddingLeft: 'max(10px, var(--dsh-frame-leading-clearance, 0px))',
  background: GLASS, backdropFilter: BLUR, WebkitBackdropFilter: BLUR,
  borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.18))',
  boxShadow: 'var(--dsw-elevation-soft, none)',
  fontSize: 12, position: 'relative', zIndex: 1,
} as const

const dotStyle = { width: 7, height: 7, borderRadius: '50%', flex: 'none' } as const
const titleStyle = { fontWeight: 600, color: 'var(--dsw-alias-label-primary, inherit)' } as const
const mutedStyle = {
  color: 'var(--dsw-alias-label-secondary, currentColor)', minWidth: 0,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
} as const
const buttonStyle = {
  display: 'inline-flex', alignItems: 'center', minHeight: 26, padding: '3px 10px',
  border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24))',
  borderRadius: 'var(--dsw-radius-sm, 6px)', background: 'transparent',
  color: 'var(--dsw-alias-link, inherit)', fontSize: 12, cursor: 'pointer',
} as const
const frameStyle = { flex: 1, display: 'block', width: '100%', minHeight: 0, border: 0, background: 'transparent' } as const

function errorMessage(body: unknown, status: number): string {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') return body.error.message
  return 'HTTP ' + status
}

export function createFlovartFrame(startSession: (prompt: string) => void) {
  return function FlovartFrame(): ReactElement {
    const frameRef = useRef<HTMLIFrameElement>(null)
    const [generation, setGeneration] = useState(0)
    const [status, setStatus] = useState<FrameStatus>('loading')
    const [detail, setDetail] = useState('')

    useEffect(() => {
      const frame = frameRef.current
      if (!frame) return undefined
      const controller = new AbortController()
      const unregister = registerFrame(frame)

      const connect = async () => {
        setStatus('connecting')
        setDetail('')
        try {
          const response = await fetch(BOOTSTRAP_URL, {
            credentials: 'same-origin', cache: 'no-store',
            headers: { accept: 'application/json' }, signal: controller.signal,
          })
          const body: unknown = await response.json().catch(() => null)
          const agentUrl = isRecord(body) && typeof body.agentUrl === 'string' ? body.agentUrl : ''
          const bootstrapToken = isRecord(body) && typeof body.bootstrapToken === 'string' ? body.bootstrapToken : ''
          if (!response.ok || !agentUrl || !bootstrapToken) {
            setStatus('error')
            setDetail(errorMessage(body, response.status))
            return
          }
          postBootstrap(frame, agentUrl, bootstrapToken)
          setStatus('ready')
        } catch (error) {
          if (controller.signal.aborted) return
          setStatus('error')
          setDetail(error instanceof Error ? error.message : String(error))
        }
      }

      const onMessage = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow || event.origin !== window.location.origin) return
        const data: unknown = event.data
        if (!isRecord(data)) return
        if (data.type === MESSAGE.ready) {
          postState(frame)
          void connect()
          return
        }
        if (data.type === MESSAGE.startSession && typeof data.prompt === 'string') {
          const prompt = data.prompt.trim().slice(0, MAX_PROMPT)
          if (prompt) startSession(prompt)
        }
      }

      window.addEventListener('message', onMessage)
      return () => {
        controller.abort()
        window.removeEventListener('message', onMessage)
        unregister()
      }
    }, [generation])

    const refresh = useCallback(() => {
      setStatus('loading')
      setDetail('')
      setGeneration(value => value + 1)
    }, [])

    const label = detail ? STATUS_LABEL[status] + '：' + detail : STATUS_LABEL[status]
    return (
      <div style={shellStyle} data-flovart-frame="">
        <div style={headerStyle}>
          <span aria-hidden="true" style={{ ...dotStyle, background: STATUS_COLOR[status] }} />
          <span style={titleStyle}>Flovart</span>
          <span style={mutedStyle} title={label}>{label}</span>
          <span style={{ flex: 1 }} />
          <button type="button" style={buttonStyle} onClick={refresh}>刷新</button>
        </div>
        <iframe
          key={generation}
          ref={frameRef}
          src={FRAME_SRC}
          title="Flovart"
          style={frameStyle}
          allow="clipboard-read; clipboard-write"
          onLoad={() => setStatus(current => current === 'loading' ? 'connecting' : current)}
        />
      </div>
    )
  }
}

export function FlovartIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <path d="M10 6.5h4a3 3 0 0 1 3 3V14" />
    </svg>
  )
}
