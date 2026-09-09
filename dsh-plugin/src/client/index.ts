/**
 * @flovart/dsh-plugin — browser half.
 *
 * Registers the additive RC8 slots: conversation.view (contextual Flovart Workflow
 * canvas) and shell.overlay (status/approval/Artifact light overlays). The
 * exclusive root sidebar/conversation/conversation.session slots stay
 * untouched, and no second Flovart navigation entry is added.
 */

// Type-only: pulls the ClientContext merge; erased by the client bundle.
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the owner packages' SlotMap merges exactly as the shell
// applies them; erased by the client bundle.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createWorkflowView } from './WorkflowView.tsx'
import { OverlayHost } from './OverlayHost.tsx'

/** Required services on the guarded browser ctx. */
export const inject = ['slots', 'sessions'] as const

/** Browser plugin body. */
export function apply(ctx: ClientContext): void {
  const WorkflowView = createWorkflowView(ctx)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'flovart',
    label: 'Flovart',
  }, WorkflowView))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'flovart-status',
  }, OverlayHost))
}
