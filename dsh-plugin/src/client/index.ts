// @flovart/dsh-plugin, browser half.
//
// Embeds the real Flovart page (same-origin /flovart-app/) as the single
// Browser Authority. Registers it as sidebar.panellist + main (id flovart)
// and as the body of the conversation.view tab; shell.overlay stays as before.
// uiWorkspace, locale and theme are optional services: each is feature-detected.

// Type-only: pulls the ClientContext merge; erased by the client bundle.
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SlotCore, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the owner packages' SlotMap merges exactly as the shell
// applies them; erased by the client bundle.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createFlovartFrame, FlovartIcon } from './FlovartFrame.tsx'
import { isRecord, setLocale, setScheme, watchDocumentTheme, type ColorScheme } from './frameBridge.ts'
import { OverlayHost } from './OverlayHost.tsx'

// Required services on the guarded browser ctx.
export const inject = ['slots'] as const

const VIEW_ID = 'flovart'

function listen(target: ClientContext, event: string, listener: () => void): () => void {
  const on: unknown = Reflect.get(target, 'on')
  if (typeof on !== 'function') return () => undefined
  try {
    const off: unknown = on.call(target, event, listener)
    return typeof off === 'function' ? () => { off() } : () => undefined
  } catch {
    return () => undefined
  }
}

function callMethod(service: unknown, method: string, ...args: unknown[]): unknown {
  if (!isRecord(service)) return undefined
  const fn = service[method]
  return typeof fn === 'function' ? fn.apply(service, args) : undefined
}

function activeLocale(service: unknown): string | undefined {
  const snapshot = callMethod(service, 'getSnapshot')
  return isRecord(snapshot) && typeof snapshot.active === 'string' ? snapshot.active : undefined
}

function activeScheme(service: unknown): ColorScheme | undefined {
  const theme = callMethod(service, 'getTheme')
  const active = isRecord(theme) ? theme.active : undefined
  const scheme = isRecord(active) ? active.colorScheme : undefined
  return scheme === 'light' || scheme === 'dark' ? scheme : undefined
}

// Browser plugin body.
export function apply(ctx: ClientContext): void {
  let workspace: unknown

  ctx.inject(['uiWorkspace'], scoped => scoped.effect(() => {
    workspace = Reflect.get(scoped, 'uiWorkspace')
    return () => { workspace = undefined }
  }, 'flovart: uiWorkspace handle'))

  ctx.inject(['locale'], scoped => scoped.effect(() => {
    const service: unknown = Reflect.get(scoped, 'locale')
    const sync = () => setLocale(activeLocale(service))
    sync()
    const off = listen(scoped, 'locale/change', sync)
    return () => { off(); setLocale(undefined) }
  }, 'flovart: locale bridge'))

  // theme/change and getTheme() are unverified in 0.2.2; both are guarded and
  // the document watcher below carries the tokens either way.
  ctx.inject(['theme'], scoped => scoped.effect(() => {
    const service: unknown = Reflect.get(scoped, 'theme')
    const sync = () => setScheme(activeScheme(service))
    sync()
    const off = listen(scoped, 'theme/change', sync)
    return () => { off(); setScheme(undefined) }
  }, 'flovart: theme bridge'))

  ctx.effect(() => watchDocumentTheme(), 'flovart: theme token watcher')

  // Fills a DSH draft only; whenDraftExists replace, never auto-sends.
  const startSession = (prompt: string) => {
    if (!isRecord(workspace) || typeof workspace.startSession !== 'function') {
      console.warn('Flovart: uiWorkspace.startSession is unavailable; no draft was created.')
      return
    }
    try {
      const result: unknown = workspace.startSession.call(workspace, undefined, { prompt, whenDraftExists: 'replace' })
      if (result instanceof Promise) result.catch(error => console.warn('Flovart: uiWorkspace.startSession failed.', error))
    } catch (error) {
      console.warn('Flovart: uiWorkspace.startSession failed.', error)
    }
  }

  const FlovartFrame = createFlovartFrame(startSession)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: VIEW_ID,
    label: 'Flovart',
  }, FlovartFrame))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: VIEW_ID,
    order: 6,
    label: 'Flovart',
  }, FlovartIcon))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: VIEW_ID,
  }, FlovartFrame))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'flovart-status',
  }, OverlayHost))
}

// 0.2.2 publishes no Context.slots merge (rc.8 got it from the removed
// dsh-client-runtime/client). Type-only; the shell provides ctx.slots at runtime.
declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: SlotCore & {
      // Shell-side gate (used the same way by dsh-client-ui-conversation 0.2.2): runs the factory once the named slot is declared.
      inject(name: keyof SlotMap & string, factory: () => unknown): unknown
    }
  }
}

// dsh-client-ui-sidebar (the slot owner) ships only inside DSH Desktop's app.asar,
// so its SlotMap merge is restated here, type-only. Unverified against the real
// declaration; the runtime spec stays owned by the sidebar package.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.panellist': {
      kind: 'list'
      scope: 'root'
    }
  }
}
