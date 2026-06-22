# Unified Canvas And Workflow Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Canvas and Workflow one Flovart visual shell while preserving their separate stores and existing provider, CLI, MCP, and agent execution paths.

**Architecture:** Add focused shared primitives for the top menu, bottom dock, and sliding panel frames. Canvas and Workflow provide domain adapters; Workflow gains node visibility/locking and media insertion without importing Canvas business state.

**Tech Stack:** React, TypeScript, Tailwind/theme variables, Zustand, localforage.

---

## File Map

- Create `components/studio/StudioTopMenu.tsx`: Flovart header and mode switch.
- Create `components/studio/StudioBottomDock.tsx`: descriptor-driven tool dock.
- Create `components/studio/StudioRightDrawer.tsx`: resizable/sliding panel frame.
- Modify `components/AppShell.tsx`: host shared top and bottom chrome.
- Modify `components/Toolbar.tsx`, `components/RightPanel.tsx`, `App.tsx`: Canvas adapter.
- Modify `components/workflow/types.ts`, `store.ts`, `WorkflowSidebar.tsx`, `WorkflowWorkspace.tsx`, `InfiniteWorkflow.tsx`, `WorkflowToolbar.tsx`, `WorkflowAgentPanel.tsx`, `WorkflowNodeToolbar.tsx`: Workflow adapter.
- Modify `styles/workflow.css` and progress docs: remove duplicate chrome and record testable behavior.

### Task 1: Shared Studio Chrome

**Files:**
- Create: `components/studio/StudioTopMenu.tsx`
- Create: `components/studio/StudioBottomDock.tsx`
- Create: `components/studio/StudioRightDrawer.tsx`
- Modify: `components/AppShell.tsx`

- [ ] **Step 1: Implement the header contract**

```tsx
export interface StudioTopMenuProps {
  mode: 'canvas' | 'workflow';
  title: string;
  theme: 'light' | 'dark';
  language: 'en' | 'zho';
  onModeChange: (mode: 'canvas' | 'workflow') => void;
  onToggleTheme?: () => void;
  onToggleLanguage?: () => void;
  onOpenSettings?: () => void;
}
```

- [ ] **Step 2: Implement descriptor-driven dock items**

```tsx
export interface StudioDockItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}
```

- [ ] **Step 3: Implement the shared right drawer**

```tsx
export interface StudioRightDrawerProps {
  open: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  tabs: Array<{ id: string; label: string; icon: React.ReactNode }>;
  activeTab: string;
  onOpenChange: (open: boolean) => void;
  onWidthChange: (width: number) => void;
  onTabChange: (id: string) => void;
  children: React.ReactNode;
}
```

- [ ] **Step 4: Add `bottomDock?: React.ReactNode` to `AppShell`**

Render top menu, workspace and bottom dock as independent layers so drawers do not obscure the dock.

### Task 2: Canvas Adapter

**Files:**
- Modify: `components/Toolbar.tsx`
- Modify: `components/RightPanel.tsx`
- Modify: `App.tsx`

- [ ] **Step 1: Add `orientation?: 'vertical' | 'horizontal'` and `embedded?: boolean` to `ToolbarProps`.**
- [ ] **Step 2: Keep select, hand, shape, drawing, text, media import, undo, redo, fit and grid on the existing handlers.**
- [ ] **Step 3: Reuse the shared drawer frame while preserving Agent, history, assets, drag payloads, reverse prompt, runtime jobs and persisted width.**
- [ ] **Step 4: Compose the Canvas shell.**

```tsx
<AppShell
  topBar={<StudioTopMenu mode="canvas" title={activeBoard.name} {...menuActions} />}
  leftSidebar={<WorkspaceSidebar {...canvasSidebarProps} />}
  main={canvasMain}
  rightSidebar={<RightPanel {...canvasRightPanelProps} />}
  bottomDock={<Toolbar orientation="horizontal" embedded {...canvasToolbarProps} />}
  themeBackground={currentTheme.canvasBackground}
/>
```

### Task 3: Workflow Visibility And Locking

**Files:**
- Modify: `components/workflow/types.ts`
- Modify: `components/workflow/store.ts`
- Modify: `components/workflow/InfiniteWorkflow.tsx`
- Modify: `components/workflow/WorkflowNodeToolbar.tsx`

- [ ] **Step 1: Extend Workflow nodes**

```ts
export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  title: string;
  position: WorkflowPoint;
  width: number;
  height: number;
  freeResize?: boolean;
  isVisible: boolean;
  isLocked: boolean;
  metadata: WorkflowNodeMetadata;
}
```

- [ ] **Step 2: Normalize persisted nodes**

```ts
nodes: project.nodes.map(node => ({
  ...node,
  isVisible: node.isVisible !== false,
  isLocked: node.isLocked === true,
}))
```

- [ ] **Step 3: Render visible nodes and their attached connections only**

```ts
const visibleNodes = project.nodes.filter(node => node.isVisible !== false);
const visibleIds = new Set(visibleNodes.map(node => node.id));
const visibleConnections = project.connections.filter(
  edge => visibleIds.has(edge.fromNodeId) && visibleIds.has(edge.toNodeId),
);
```

- [ ] **Step 4: Reject locked-node drag, resize, edit, delete and run before committing a history frame.**

### Task 4: Workflow Left Drawer

**Files:**
- Create: `components/workflow/WorkflowSidebar.tsx`
- Modify: `components/workflow/WorkflowProjectList.tsx`
- Modify: `components/workflow/WorkflowWorkspace.tsx`

- [ ] **Step 1: Define project and node layer actions**

```tsx
export interface WorkflowSidebarProps {
  open: boolean;
  project: WorkflowProject | null;
  onOpenChange: (open: boolean) => void;
  onSelectNodes: (ids: string[]) => void;
  onRenameNode: (id: string, title: string) => void;
  onToggleNodeVisible: (id: string) => void;
  onToggleNodeLocked: (id: string) => void;
  onReorderNode: (id: string, targetId: string, position: 'before' | 'after') => void;
}
```

- [ ] **Step 2: Preserve project create/import/select/rename/delete through `WorkflowProjectList`.**
- [ ] **Step 3: Show node icon, title, status, selection, visibility and lock; support rename and z-order drag.**

### Task 5: Workflow Bottom Dock

**Files:**
- Modify: `components/workflow/WorkflowToolbar.tsx`
- Modify: `components/workflow/InfiniteWorkflow.tsx`
- Modify: `components/workflow/WorkflowWorkspace.tsx`

- [ ] **Step 1: Keep select, pan, image/video/audio import, shared media, text/config creation, undo, redo, fit, grid and Agent.**
- [ ] **Step 2: Lift existing editor callbacks through a focused `WorkflowDockState` descriptor.**
- [ ] **Step 3: Remove the duplicate floating toolbar frame and `.workflow-bottom-bar`.**

### Task 6: Workflow Right Drawer

**Files:**
- Modify: `components/workflow/WorkflowWorkspace.tsx`
- Modify: `components/workflow/WorkflowAgentPanel.tsx`
- Modify: `components/RightPanel.tsx`

- [ ] **Step 1: Share `agent`, `history` and `assets` drawer tabs while keeping content adapters separate.**
- [ ] **Step 2: Embed Workflow Agent without changing online/local bridge, Codex/CLI/MCP, confirmation, thread, attachment or session logic.**
- [ ] **Step 3: Insert history/assets as Workflow image/video nodes through existing media helpers and localforage storage.**

### Task 7: Workflow ElementBar Parity

**Files:**
- Modify: `components/workflow/WorkflowNodeToolbar.tsx`
- Modify: `components/workflow/InfiniteWorkflow.tsx`

- [ ] **Step 1: Keep type-applicable image/video/audio actions and unlocked-node copy/layer/align/run/stop/delete actions.**
- [ ] **Step 2: Forward resolved image data and MIME type to the existing reverse-prompt callback, then focus PromptBar.**
- [ ] **Step 3: Keep PromptBar and ElementBar anchored to selected visible nodes without drag or recursive state updates.**

### Task 8: Styling And Documentation

**Files:**
- Modify: `styles/workflow.css`
- Modify: `docs/content/docs/progress/todo.mdx`
- Modify: `docs/content/docs/progress/pending-test.mdx`

- [ ] **Step 1: Remove duplicate shell styles and use current theme variables.**
- [ ] **Step 2: Move matching todo work to pending-test and record actual shell/layer/Agent/history/asset/ElementBar behavior.**
- [ ] **Step 3: Inspect changed-file scope, `git diff --check`, stale selectors and new prop call sites. Per `AGENTS.md`, do not execute syntax checks, tests or builds.**
