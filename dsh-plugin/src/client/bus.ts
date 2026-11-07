/**
 * Plugin-local typed event bus shared by the contextual conversation.view and the
 * shell.overlay stack. One bus lives per page (module scope of the single
 * client bundle instance).
 */

export interface WorkspaceBadges {
  waiting: number
  error: number
  artifacts: number
}

export type FlovartBridgeEvent =
  | { kind: 'connected' }
  | { kind: 'badges'; badges: WorkspaceBadges }
  | { kind: 'intent'; intentId: string; status: string; changeSetId?: string }
  | { kind: 'receipt'; intentId: string; status: string; changeSetId?: string }

type Listener = (event: FlovartBridgeEvent) => void

function createBus(): { subscribe: (listener: Listener) => () => void; publish: (event: FlovartBridgeEvent) => void } {
  const listeners = new Set<Listener>()
  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish(event: FlovartBridgeEvent): void {
      for (const listener of [...listeners]) listener(event)
    },
  }
}

export const bridgeBus = createBus()
