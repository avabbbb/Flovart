/**
 * Cross-view request to open the workflow right drawer on the Agent tab.
 *
 * The right drawer's open/tab state lives inside WorkflowWorkspace. Other
 * surfaces (the Agent diagnostics page, the canvas's own "open assistant"
 * affordance) ask for the drawer through here. The workspace subscribes while
 * mounted and also consumes any request issued while it was unmounted, so a
 * request made from another view is honored on return.
 */
let requestNonce = 0;
const listeners = new Set<() => void>();

export function requestWorkflowAgentDrawer() {
  requestNonce += 1;
  listeners.forEach(listener => listener());
}

/**
 * Clear a pending request and report whether one was waiting. Both the mount
 * path and the live subscriber call this so a handled request cannot fire
 * again on a later mount.
 */
export function consumeWorkflowAgentDrawerRequest(): boolean {
  if (requestNonce === 0) return false;
  requestNonce = 0;
  return true;
}


/** Subscribe to live requests while the workspace is mounted. */
export function subscribeWorkflowAgentDrawer(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
