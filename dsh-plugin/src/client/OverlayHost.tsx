/**
 * shell.overlay entry: Flovart light overlays (approval/status/Artifact).
 * Receives Bridge events from the conversation.view relay and shows a small
 * dismissible stack. Never hosts Workflow/Table editing — that stays in the
 * view or the independent window.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { bridgeBus, type FlovartBridgeEvent } from './bus.ts'

interface OverlayItem {
  id: number
  event: FlovartBridgeEvent
}

const OVERLAY_TTL_MS = 10000
const MAX_OVERLAYS = 3

export function OverlayHost(): ReactElement {
  const [items, setItems] = useState<OverlayItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  useEffect(() => {
    const dispose = bridgeBus.subscribe(event => {
      const id = nextId.current
      nextId.current += 1
      setItems(current => [...current.slice(-(MAX_OVERLAYS - 1)), { id, event }])
      const timer = window.setTimeout(() => {
        setItems(current => current.filter(item => item.id !== id))
        timers.current.delete(id)
      }, OVERLAY_TTL_MS)
      timers.current.set(id, timer)
    })
    return () => {
      dispose()
      for (const timer of timers.current.values()) clearTimeout(timer)
      timers.current.clear()
    }
  }, [])

  if (items.length === 0) return <div />

  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 48, zIndex: 1000,
      display: 'flex', flexDirection: 'column', gap: 8, width: 320,
      pointerEvents: 'none',
    }}>
      {items.map(item => (
        <div
          key={item.id}
          style={{
            pointerEvents: 'auto', borderRadius: 10, padding: '10px 12px',
            background: 'var(--dsh-overlay-bg, #1f2328)',
            color: 'var(--dsh-text, #e6e8eb)',
            border: '1px solid var(--dsh-border, rgba(128,128,128,0.35))',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            fontSize: 12, lineHeight: 1.5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>{titleOf(item.event)}</span>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => {
                const timer = timers.current.get(item.id)
                clearTimeout(timer)
                timers.current.delete(item.id)
                setItems(current => current.filter(entry => entry.id !== item.id))
              }}
              style={{
                marginLeft: 'auto', border: 0, background: 'transparent',
                color: 'inherit', cursor: 'pointer', fontSize: 12,
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ opacity: 0.8 }}>{detailOf(item.event)}</div>
        </div>
      ))}
    </div>
  )
}

function titleOf(event: FlovartBridgeEvent): string {
  switch (event.kind) {
    case 'connected': return 'Flovart 已连接'
    case 'badges': return 'Flovart 状态更新'
    case 'intent': return '制作意图更新'
    case 'receipt': return '执行回执完成'
  }
}

function detailOf(event: FlovartBridgeEvent): string {
  switch (event.kind) {
    case 'connected': return '工作页已通过 Harness 内部通道连接，状态与产物徽标已贯通。'
    case 'badges': {
      const parts: string[] = []
      if (event.badges.waiting > 0) parts.push(`等待中 ${event.badges.waiting}`)
      if (event.badges.error > 0) parts.push(`错误 ${event.badges.error}`)
      if (event.badges.artifacts > 0) parts.push(`新产物 ${event.badges.artifacts}`)
      return parts.length > 0 ? parts.join(' · ') : '暂无待处理项'
    }
    case 'intent': return `意图 ${event.intentId} 状态：${event.status}${event.changeSetId ? `（ChangeSet ${event.changeSetId}）` : ''}`
    case 'receipt': return `意图 ${event.intentId} 回执：${event.status}${event.changeSetId ? `（ChangeSet ${event.changeSetId}）` : ''}`
  }
}
