// DSH side of the Flovart embed contract (mirrors dsh-guizang-design lib/client.js).
// Every postMessage pins targetOrigin to location.origin; inbound messages are
// checked by the frame component (event.source and event.origin).

export const FRAME_SRC = '/flovart-app/?embed=dsh#/app'
export const BOOTSTRAP_URL = '/flovart-app/api/bootstrap'

export const MESSAGE = Object.freeze({
  ready: 'flovart:dsh-ready',
  theme: 'flovart:dsh-theme',
  locale: 'flovart:dsh-locale',
  bootstrap: 'flovart:dsh-bootstrap',
  startSession: 'flovart:start-session',
  link: 'flovart:dsh-link',
})

export type FrameLinkStatus = 'connecting' | 'ready' | 'error'

// Short reasons per Flovart link issue kind (services/agentLinkIssue.ts). The
// frame only receives the kind, never URLs, tokens or raw error text.
const LINK_ISSUE_LABEL: Record<string, string> = {
  not_configured: '未拿到连接凭证',
  blocked_by_page: '浏览器拦截了本机连接',
  refused: 'Workspace Operator 未运行',
  unreachable: '连不上 Workspace Operator',
  timeout: 'Workspace Operator 响应超时',
  cors: 'Operator 拒绝了页面来源',
  auth: '连接凭证已失效，正在重新获取',
  version: 'Flovart 与 Operator 版本不匹配',
  wrong_service: '端口上不是 Flovart Operator',
  stream_lost: '实时通道中断，正在重连',
  sync_failed: '画布同步失败',
}

/**
 * Map the canvas' real link state (posted by the embedded Flovart page) onto
 * the frame header, so DSH never shows "connected" merely because a token
 * was handed over.
 */
export function frameStatusFromLink(data: unknown): { status: FrameLinkStatus; detail: string } | null {
  if (!isRecord(data) || data.type !== MESSAGE.link || typeof data.state !== 'string') return null
  const issue = typeof data.issue === 'string' ? LINK_ISSUE_LABEL[data.issue] || '' : ''
  if (data.state === 'ready') return { status: 'ready', detail: '' }
  if (data.state === 'connecting') return { status: 'connecting', detail: issue }
  if (data.state === 'offline' || data.state === 'error' || data.state === 'auth_failed') {
    return { status: 'error', detail: issue || '画布未连接' }
  }
  return null
}

export type ColorScheme = 'light' | 'dark'

// Read explicitly because not every engine enumerates custom properties on
// a computed style declaration.
const KNOWN_TOKENS = [
  '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-caption',
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-2',
  '--dsw-alias-border-l2', '--dsw-alias-border-l4',
  '--dsw-alias-button-primary-fill', '--dsw-alias-button-primary-hover',
  '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-active',
  '--dsw-alias-link',
  '--dsw-radius-xs', '--dsw-radius-sm', '--dsw-radius-md', '--dsw-radius-lg', '--dsw-radius-xl', '--dsw-radius-panel',
  '--dsw-elevation-soft', '--dsw-elevation-prominent', '--dsw-elevation-panel',
  '--dsw-font-family',
]

const frames = new Set<HTMLIFrameElement>()
const state: { scheme: ColorScheme | undefined; lang: string | undefined } = { scheme: undefined, lang: undefined }
let broadcastQueued = false

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function documentScheme(root: HTMLElement): ColorScheme {
  if (state.scheme) return state.scheme
  const declared = getComputedStyle(root).colorScheme || ''
  const dark = declared.includes('dark')
  const light = declared.includes('light')
  if (dark !== light) return dark ? 'dark' : 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function readThemeTokens(root: HTMLElement = document.documentElement): Record<string, string> {
  const style = getComputedStyle(root)
  const names = new Set(KNOWN_TOKENS)
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index)
    if (name.startsWith('--dsw-')) names.add(name)
  }
  const tokens: Record<string, string> = {}
  for (const name of names) {
    const value = style.getPropertyValue(name).trim()
    if (value) tokens[name] = value
  }
  return tokens
}

function post(frame: HTMLIFrameElement, message: Record<string, unknown>): void {
  const target = frame.contentWindow
  if (!target) return
  try { target.postMessage(message, window.location.origin) }
  catch {
    // Frame navigated away; its next ready message resyncs it.
  }
}

export function postState(frame: HTMLIFrameElement): void {
  const root = document.documentElement
  post(frame, { type: MESSAGE.theme, scheme: documentScheme(root), tokens: readThemeTokens(root) })
  if (state.lang) post(frame, { type: MESSAGE.locale, lang: state.lang })
}

export function postBootstrap(frame: HTMLIFrameElement, agentUrl: string, bootstrapToken: string): void {
  post(frame, { type: MESSAGE.bootstrap, agentUrl, bootstrapToken })
}

function broadcast(): void {
  if (broadcastQueued) return
  broadcastQueued = true
  requestAnimationFrame(() => {
    broadcastQueued = false
    for (const frame of frames) postState(frame)
  })
}

export function setScheme(scheme: ColorScheme | undefined): void {
  state.scheme = scheme
  broadcast()
}

export function setLocale(lang: string | undefined): void {
  state.lang = lang
  broadcast()
}

export function registerFrame(frame: HTMLIFrameElement): () => void {
  frames.add(frame)
  return () => { frames.delete(frame) }
}

// Theme services are unverified in 0.2.2, so the root's own --dsw- values are
// re-read whenever its class/style/attributes or the OS scheme change.
export function watchDocumentTheme(): () => void {
  const observer = new MutationObserver(broadcast)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] })
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', broadcast)
  return () => {
    observer.disconnect()
    media.removeEventListener('change', broadcast)
  }
}
