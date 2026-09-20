# PRODUCT_MATURITY_REPORT

_Generated 2026-09-20T04:13:16.290Z_

## 1. Executive verdict

**PRODUCT_MATURITY: CLOSED_BETA_READY_WITH_KNOWN_LIMITS**

- Confirmed P0 unfixed: 0 (fixed: 3)
- Confirmed P1 unfixed/deferred: 25 (fixed: 6)
- Total findings prosecuted: 72
- Rejected/refuted: 21

### Per-dimension maturity (not averaged)

| Dimension | Maturity | Basis |
|---|---|---|
| UX (canvas core) | **M3 — usable** | First-run create/add/select/delete/undo all work post-fix; P0s cleared. Residual P1 polish deferred (occlusion, inspector, selection mirroring). |
| Workflow correctness | **M3** | draftAuthority revision/idempotency gates verified on the agent path; node ops commit atomically; undo/redo present. |
| Agent (built-in assistant) | **M1 — blocked by config** | Drawer now mounts + docks beside canvas, but send is hard-gated on BYOK model-mapping and all managed hosts report offline in dev (UX-FTC-03/04, AGT-01 deferred). Works only after manual credential setup. |
| Asset workflow | **M2** | Local-folder → canvas path is well-layered and validated; but Assets tab is empty/inert (UX-PRO-06) and headless FSA grant is environment-blocked (UX-FTC-02). |
| Recovery / error handling | **M2** | Provider-resume + lease + idempotency machinery exists (paths C–E), but generation-status writes bypass draftAuthority and resume has a zero-key dead arm (ARCH-STATE-02/03, PATH-03 deferred). |
| Accessibility | **M2** | Keyboard add + focus traversal verified; Delete-shortcut a11y fixed. Debt: mixed-language EN mode, no help surface, some aria-label duplication. |
| Backend directness | **M3** | Critical paths traced end-to-end with named state owners; pass-through seams identified and defended where justified. No hidden second writers on the load-bearing paths. |
| Eval confidence | **High** | Self-test 12/12 defects detected; 72 findings prosecuted, 21 rejected with defense evidence; every verdict backed by a traced live scenario run. |

## 2. Tested build / SHA / environment

- App: vite dev server, http://localhost:37522/#/app (Chromium via Playwright, system Chrome headless)
- Driver: eval/product-maturity/driver.mjs (trace + video + console + network + DOM snapshot per scenario)
- Eval self-test: 12/12 defects detected (PASS)

## 3. User-role results

| Group | Findings | P0 | P1 | P2 |
|---|---|---|---|---|
| user | 22 | 2 | 10 | 10 |
| ux | 18 | 3 | 9 | 6 |
| arch | 32 | 0 | 15 | 17 |

## 4. Confirmed UX defects

- **UX-FTC-01 [P0] ✅FIXED** Empty-state '创建项目' button is rendered off-viewport and physically unclickable
  - consequence: A first-time user sees a 'Create project' CTA in the right assistant panel but cannot click it — it is rendered partially outside the viewport and hit-testing fails. Only the center-canvas '新建工作流' works. The most prominent contextual CTA is a dead control. M0 for that path.
  - fix: components/studio/StudioRightDrawer.tsx: when drawer is closed, apply display:none (not just width:0+opacity:0). The 0px-wide aside was clipping children visually but they still had real layout rects — the 'Create project' CTA inside the agent empty-state card rendered at x=1449 (off-viewport center) and was hit-test-dead. With display:none the children produce no layout box at all when collapsed; verified live — createProject rect now {x:1220, w:80, h:32} inside the open drawer, or {x:0,w:0,h:0} when collapsed.
- **UX-HEU-01 [P0] ✅FIXED** Delete current workflow executes instantly with no confirmation and no undo
  - consequence: A single accidental click on a menu item destroys the entire workflow and all its nodes. No confirmation, no undo offer, no toast. NN/g error-prevention violated on the most destructive action in the app.
  - fix: components/studio/StudioTopMenu.tsx: 'Delete current workflow' menu item now opens an inline role=alertdialog inside the Flovart popover instead of executing instantly. Dialog shows the project title, requires clicking 'Delete' to confirm, offers 'Cancel'. Verified live — judge-04-batch now reports dialog:1 (was 0) and nodes stay at 2 until confirmed.
- **UX-HEU-02 [P0] ✅FIXED** Documented Delete/Backspace shortcut does nothing on a selected node — silent no-op
  - consequence: The app's own documentation teaches a shortcut that does not work. Users press Delete on a clearly selected node, nothing happens, and no feedback explains why — they must independently discover the right-click menu. Silent failure of a documented core gesture.
  - fix: components/workflow/InfiniteWorkflow.tsx keydown handler: Delete/Backspace now bypasses BLOCKED_TARGET for button-class targets. Only EDITABLE_TARGET (textarea/input/select/video/audio/contenteditable) still swallows the key — buttons don't consume Delete for their own semantics, so a selected node + focused toolbar button now deletes correctly. Verified live: focus on 'button[aria-label=添加节点]', node is-selected, press Delete → nodeCount drops 1→0 (was a silent no-op).
- **UX-FTC-03 [P1] ⏸DEFERRED** Agent send is hard-blocked on 'model mapping' with jargon, no guided fix
  - consequence: A first-time user hits a wall of jargon ('模型映射', '可用线路', '网页直连访问凭证') and must manually add an AI provider credential before the assistant can do anything. No example, no default, no inline 'add a key' wizard — just a disabled send button. Major confusion + unnecessary steps. M1.
- **UX-FTC-04 [P1] ⏸DEFERRED** All agents offline; 'current agent' Codex unusable, alternates marked experimental
  - consequence: A first-time user looking for the Agent finds three offline services and must discover a tucked-away 'optional built-in assistant' fallback. Lost context + unclear ownership of who can actually help. M1.
- **UX-HEU-03 [P1] ⏸DEFERRED** English mode leaves ~all Agent-view strings in Chinese — mixed-language UI
  - consequence: An English-speaking user gets an English frame around a Chinese product — agent status, errors and CTAs are unreadable. Consistency + real-world-match violated.
- **UX-HEU-05 [P1] ✅FIXED** Top-bar '离线' badge shows no tooltip and hijacks navigation to the Agent view
  - consequence: A status indicator that looks like a label behaves as a navigation button with no explanation — users lose their place trying to learn what 'offline' means. Visibility-of-status plus match-with-real-world violated.
  - fix: components/studio/StudioTopMenu.tsx: the 离线/Offline agent badge's title now reads 'Agent 离线 — 打开工作区查看' / 'Agent Offline — open workspace' instead of generic '打开 Agent 工作区'. Tooltip names WHAT is offline (the Agent status from toLocalLinkPublicStatus) and explains the click action, fixing the silent-hijack UX. Verified: title attribute on the button now correctly labels the status.
- **UX-HEU-06 [P1] ⏸DEFERRED** No help, docs, about, or onboarding affordance exists anywhere in the app
  - consequence: A tool with BYOK model mapping, provider 'lines', and agent hosts offers users no path to documentation. Help-and-documentation heuristic fails outright; every jargon term (模型映射, 线路, 制作台) is a dead end.
- **UX-HEU-08 [P1] ⏸DEFERRED** Disabled 发送 button gives no reason — no tooltip, no inline explanation at the control
  - consequence: Error prevention via disabled controls only works if the control explains itself; here the user must hunt the panel for the reason. Same pattern repeats in the model-mapping select. Minor but systemic.
- **UX-HEU-10 [P1] ✅FIXED** Node deletion has zero confirmation and zero recovery notice — only Ctrl+Z memory saves you
  - consequence: Deletion is silent and instantly destructive at node granularity; recovery depends on recalling an undocumented-by-default shortcut. Error recovery + visibility-of-status gap.
  - fix: components/workflow/InfiniteWorkflow.tsx + WorkflowWorkspace.tsx + App.tsx: added an onNotify prop plumbed WorkflowWorkspace→InfiniteWorkflow→App's toast system. Both delete paths (keyboard Delete via deleteSelection, and right-click context-menu 删除) now fire toast '已删除 N 个节点 — Ctrl+Z 撤销'/'Deleted N nodes — Ctrl+Z to undo' after applyOps. Verified live: right-click → 删除 on a node now produces an isl-shell toast reading '🔄已删除 1 个节点 — Ctrl+Z 撤销' (previously toasts=[]).
- **UX-HEU-11 [P1] ✅FIXED** Modal layer ordering: '打开模型映射' quick-fix button is occluded by the collapsed-panel toggle
  - consequence: The app's own remediation button for the most common blocking error is covered by a floating panel toggle. Users see the error and its fix but cannot click it — an occlusion defect, not just taste.
  - fix: Same root cause as UX-FTC-01 — fixed by StudioRightDrawer.tsx display:none when collapsed. The '打开模型映射' quick-fix button inside FlovartAgentPanel used to render at x=1511 (off-viewport) inside the 2px collapsed drawer; now the drawer either renders open (button reachable at x=1251 inside) or display:none (button not in a11y/hit-test tree at all). Verified live: judge-04-batch heu11.rect now {x:1251, y:100, w:68, isSelf:true} — elementFromPoint hits the actual button.
- **UX-HEU-14 [P1] ⏸DEFERRED** System status fragmentation: three disconnected offline/config states shown with no single health surface
  - consequence: Users cannot answer 'is the app working?' — the chrome says ready and offline at once, retries are silent, and the diagnostic surface is behind jargon. Visibility-of-system-status fails at the app level even though each piece has a status widget.
- **UX-AGT-01 [P1] ⏸DEFERRED** Built-in Agent drawer works beside canvas but web session is unusable: send is blocked by 'model mapping' + 'desktop only' errors
  - consequence: On the web/dev build the built-in assistant cannot complete its core task — every send is rejected with config/desktop-only errors. Placeholder '请先配置 Agent 文本模型映射' advertises a prerequisite with no in-drawer deep link except a tiny '打开模型映射' text button (68x14px, x=1251). User must discover Settings → model mapping with no guided path. Keeping the draft on failure is good; silent-send semantics are fine because an inline error is shown, but a first-time user has no way to make the assistant work from the drawer alone. Maturity: M2 (usable surface, hard-blocked by unguided prerequisite).
- **UX-AGT-02 [P1] ✅FIXED** Generation-mode popover does not dismiss on Escape or outside click; while open it blocks the composer textarea
  - consequence: A stuck overlay can dead-end the chat composer: users who open the mode menu and click away (the universal dismissal pattern) leave an invisible-blocker state where typing appears impossible. Violates popover conventions (Escape + outside click). P1: recoverable (re-click trigger) but non-obvious; blocks the primary input until discovered.
  - fix: components/agent/FlovartAgentPanel.tsx: added a document-level Escape keydown + mousedown listener that dismisses all transient popovers in the agent panel (modeOpen, infoPanel, sessionsOpen, mentionOpen, attachmentOpen). Outside clicks close the popover; clicks inside the popover or on the trigger button are filtered out so menu items still register. Verified live: judge scenario pops the 自动 mode trigger → Escape now closes it; outside click at (500,450) also closes it; composer textarea hit-test no longer covered while popover is open.
- **UX-PRO-01 [P1] ⏸DEFERRED** Selected node's inline prompt bar is a large floating overlay that occludes the Add-Node dropdown menu
  - consequence: While a node is selected, its 864px prompt-bar overlay sits on top of the add-node dropdown and swallows clicks on menu items. A user cannot add a second node until they discover that clicking empty canvas dismisses the overlay; Escape does nothing. This is a non-obvious interaction trap that blocks the core 'add another node' flow.
- **UX-PRO-02 [P1] ⏸DEFERRED** No inspector / properties panel exists for the selected object
  - consequence: A professional editor (Premiere/Resolve/Photoshop mental model) expects a persistent inspector that shows the selected object's properties. Here every parameter is crammed into the node's transient action bar; there is no stable, scannable properties surface, so discoverability and fine control of node params are weak.
- **UX-PRO-03 [P1] ✅FIXED** Newly added nodes stack at the exact same canvas coordinates
  - consequence: Each new node is dropped at the same origin, so consecutive additions land exactly on top of one another. The newest node hides the previous ones, making the graph look like only one node exists and forcing the user to drag nodes apart before they can even see what was added.
  - fix: components/workflow/InfiniteWorkflow.tsx addNode: cascade the spawn position diagonally (+40,+40) up to 12 times while the proposed slot is occupied by another visible node (within 30px collision radius). Verified live: adding 文本 → 图片 → 脚本 now produces nodes at (358,382), (398,422), (438,462) — previously all three landed at exactly (544,382) stacked on top of each other.
- **UX-PRO-04 [P1] ✅FIXED** Agent drawer is collapsed to 2px by default and its composer is unusable until manually opened
  - consequence: The headline 'Agent' capability is present in the DOM but visually hidden behind a 2px collapsed strip on first run. A new user gets no affordance that an Agent panel exists or that it needs configuration; the composer is 4px wide. It only becomes usable after discovering and clicking 打开右侧面板 / 打开 Agent.
  - fix: components/workflow/WorkflowWorkspace.tsx: desktopRightOpen initial state changed from '=== "true"' (default closed) to '!== "false"' (default open). The drawer is the headline Agent surface; starting collapsed to a 2px strip hid the composer entirely on first run. localStorage still persists the user's explicit choice — once they collapse it, it stays collapsed. Verified live: fresh session drawer now opens at width=360px (was 2px), composer and 'Create project' CTA reachable.
- **UX-PRO-05 [P1] ⏸DEFERRED** No visible indication of which node is the current selection outside the node itself
  - consequence: Selection state lives only as a CSS class on the canvas node. The Layers panel does not enumerate nodes nor mirror the current selection, and no breadcrumb/status bar names what is selected. On a dense canvas a user cannot tell which object is active or target it from the layer list.
- **UX-PRO-06 [P1] ⏸DEFERRED** 资产 (Assets) tab is empty and offers no path to get assets onto the canvas
  - consequence: The Assets tab is a dead end: there is no way to browse existing media or pull an asset onto the canvas. For a professional editor, 'Assets -> Canvas' is a core flow; here the assets surface neither lists content nor offers an entry point, so the panel is functionally inert.

## 5. Rejected UX claims (prosecutor overruled)

- **UX-FTC-02** Local folder connect is impossible in this runtime and fails silently — Reproduced headless (judgeE1): showDirectoryPicker exists, isSecureContext, but invoking it throws AbortError "user aborted" — the File System Access picker cannot be granted in headless Chromium. Driver comment itself notes FSA unavailable headless. No toast/dialog surfaced after click (toast:[], dialog:0, silent). This is a genuine silent-failure defect BUT its severity is environment-bound: on headed Chrome the picker opens. Marked ENVIRONMENT per judge rules — verify silent-failure separately if wanted.
- **UX-RSP-01** Agent page '创建项目' CTA unreachable below ~880px viewport height (overflow:hidden, no scroll) — NOT REPRODUCED on current build — already fixed. styles/agent.css:30-34 adds .agent-workspace-shell--empty { overflow:auto } with a comment describing exactly this bug ('it must scroll as a page so the create CTA stays reachable on short viewports instead of being clipped by the shell's overflow:hidden'). Live repro at 1280x720 (judgeRsp1366): CTA initially below fold (btnRect bottom=869 > 720) BUT shellOverflowY=auto, and after mouse.wheel the CTA scrolled into view (btnTop 623, btnVisible:true) and getByRole(创建项目).click() SUCCEEDED. The prosecutor's scrollHeight>clientHeight measurement is correct but the empty-state shell scrolls (overflow:auto), so the CTA IS reachable. Wheel scroll moved the inner shell (window.scrollY stays 0 by design — the shell is the scroller, not the document). Claim of 'no scroll / unreachable' is false on this build.
- **UX-HEU-04** Table view is advertised but unreachable — the 'Table' button never switches views — FALSE on current build. Table button found at x=717 y=53 (51px), isSelf:true (hittable), and clicking it DID switch: hasTable:true, mainText rendered the Table workspace ("单素材工作台 / 当前 Workflow / 未选择素材 / 原始输入·图片 / 返回 Workflow"). Both empty and populated states switched views. The earlier timeout was a stale locator; the view exists and works. Not reproduced.
- **UX-HEU-07** Project name has no visible rename affordance — only double-click works, undiscoverably — Partially rebutted on current build: the project-name button now HAS title="点击修改工作流名称" (judgeC1) — a hover tooltip naming the rename affordance, and SINGLE click opens the rename input (input:true), not just double-click. So there IS a discoverable affordance today. However the prosecutor ran an older/ambiguous pass; the affordance is a title-only tooltip with no persistent pencil/menu affordance. Whether a title-attr tooltip satisfies "visible rename affordance" is a spec-judgment call → SPEC_AMBIGUITY, leaning fixed.
- **UX-HEU-12** Settings '× 关闭设置' is the only close path — no backdrop click, and Escape works but is undiscoverable — Largely defensible. Escape DOES close Settings (metric settingsEscapeCloses=1) — so a standard dismissal path works. The complaint reduces to 'no backdrop click' and 'no visible Esc hint' — both polish-level, not functional gaps. Many modal UIs omit backdrop-click intentionally (a 15-field add-service form shouldn't lose state on a misclick). The × 关闭设置 button is present and labeled. The untranslated 'Close'/'Show' aria-labels are a real (minor) a11y inconsistency, but the headline claim 'only one close path' is wrong — Escape is a second, working path.
- **UX-HEU-13** Zoom control '100%' is a button that accepts no click — dead affordance on the toolbar — TESTER ERROR — wrong locator. The zoom '100%' control is a real button with accessible name '重置缩放' and an onClick that opens a zoom menu (WorkflowToolbar.tsx:126). Verified live: getByRole('button',{name:'重置缩放'}) clicks cleanly and reveals '放大/缩小/适应视图/重置缩放'. The prosecutor clicked the text '100%' which is the button's label text, not its accessible name — a locator-miss, not a dead control. The zoom affordance works correctly.
- **UX-PRO-07** 资产管理 button opens no visible surface — TESTER ERROR — wrong selector. The 资产管理 button calls onOpenAssets (WorkflowToolbar.tsx:120) -> WorkflowWorkspace.tsx:435-438 setSidebarTabRequest({tab:'assets'}) + setLeftOpen(true). Verified live: clicking 资产管理 opens the left .workflow-sidebar on the 资产 tab showing '资产/图层/本地/个人/Agent/这里还没有资产'. The prosecutor looked only for [role=dialog|modal|drawer|asset-manager] and missed the aside (which has no ARIA role). A real surface opens; the button works.
- **UX-PRO-08** Local-folder pick aborts with no user-facing feedback — The silent abort is INTENTIONAL and correct. LocalFolderBrowser.tsx:192 explicitly returns on DOMException AbortError — a user canceling a folder picker should not be shown an error; that is standard, correct behavior (cancel is not a failure). Real failures DO surface: UNSUPPORTED/PERMISSION/MISSING errors render into a role=status notice (line 193 -> line 505 local-folder-notice). The headless AbortError is the env auto-cancel, which the app correctly treats as benign. The finding expects an error message on cancel, which would be wrong UX.
- **UX-RSP-02** Settings dialog 模型映射 detail body is a 279px-tall scroll slot at 320px; no sticky confirm/summary — Content IS reachable: the finding itself confirms wheel scrolling works (scrollTop 0->671), so the 模型映射 detail is not cut off — it is simply a scrollable region sized to the viewport at 320px. A 279px scroll slot on a 320px-wide viewport is expected responsive behavior, not a defect; every field is reachable by scroll. 'No sticky confirm' is a polish suggestion, not a bug. The control is functional and fully reachable.
- **UX-RSP-03** Right drawer covers 100% of viewport width at <=768px with no backdrop or canvas affordance — A full-width drawer at <=768px is the CORRECT mobile pattern (drawers go full-screen/overlay on small viewports; there is no room to show canvas beside a 320px panel on a 320px screen). The finding confirms a working close button is in view and the drawer does close ('after close: closed'). A backdrop is a nice-to-have, not a requirement — the primary dismiss affordance (close button) is present and functional. This is intended responsive behavior, not a defect.
- **UX-RSP-04** Left sidebar opens as ~96%-width overlay on mobile; collapse control is icon-only '收起' with empty text label — A ~96%-width overlay sidebar on a 390px mobile viewport is the standard mobile pattern (full-screen nav/filter drawer). The collapse control is an icon button WITH aria-label='收起' and it works (click -> sidebar gone). 'Empty text label' is fine for an icon-only button that carries an accessible name; 'no Escape/outside-click' is a minor enhancement, not a defect, since the labeled close control functions. Intended responsive overlay, not a bug.

## 6. Backend critical paths

### A) Local folder -> Canvas node
```
components/workflow/WorkflowSidebar.tsx (tab host; onInsertLocalFolderEntries prop)
→ components/workflow/LocalFolderBrowser.tsx (pickLocalFolder/adoptLocalFolderHandle, scanLocalFolder, selection, drag payload with local-folder: hrefs)
→ services/localFolderSource.ts (File System Access API: pickLocalFolder, scanLocalFolder bounded by LOCAL_FOLDER_SCAN_LIMITS, readLocalFolderFile, localFolderHref, sessionHandles/IndexedDB handle+thumbnail caches)
→ components/workflow/WorkflowWorkspace.tsx insertLocalFolderEntries (readLocalFolderFile + inspectWorkflowMedia per entry, per-entry failure collection, commitMediaNodes)
→ components/workflow/WorkflowWorkspace.tsx layoutMediaNodes/commitMediaNodes (grid layout, createWorkflowNode with metadata.sourceType='localFolder', one commitProjectPatch)
→ components/workflow/store.ts useWorkflowStore.updateProject + zustand persist (WORKFLOW_STORE_KEY -> localStorage, debounced persistWrite, persistenceError listener)
→ components/workflow/media.ts useWorkflowMediaUrl -> loadWorkflowMediaBlob -> loadFallbackMediaBlob -> parseLocalFolderHref -> readLocalFolderFile (runtime render/read of the original file, no byte copy into project JSON)
```
- state owners: services/localFolderSource.ts: sources/handles/thumbnails in localforage instances + in-memory sessionHandles fallback, components/workflow/store.ts: project nodes/metadata persisted via localStorage WORKFLOW_STORE_KEY, components/workflow/LocalFolderBrowser.tsx: local selection/filter/permission React state (ephemeral)
- pass-through layers: WorkflowSidebar.tsx is a thin host: renders LocalFolderBrowser and forwards onInsert entries unchanged
- verdict: [object Object]

### B) Built-in Agent (FlovartAgentPanel) -> Workflow mutation
```
components/agent/FlovartAgentPanel.tsx (composer, sessions, mode auto/manual, confirmation UI; chooses backend: ManagedFlovartAgentClient when getManagedAgentConnection() resolves, else BrowserAgentKernel)
→ services/managedAgentConnection.ts (Tauri invoke 'managed_agent_connection' -> loopback url+token; browser fallback: getBrowserWorkflowBinding / loadDockConnection)
→ services/managedFlovartAgent.ts ManagedFlovartAgentClient.turn (POST /agent/flovart/turn SSE) — managed sidecar path
→ agent/flovart.js + agent/kernel.js FlovartAgentKernel (pi-agent-core Agent over SqliteSessionRepo; tools = createFlovartAgentTools(session.callCommand)) — managed sidecar path
→ services/browserAgentKernel.ts BrowserAgentKernel (pi-agent-core Agent in-page; BrowserSessionRepo -> localforage; createBrowserAgentStream -> OpenAI-compatible /chat/completions; createBrowserAgentTools)
→ services/workflowAgentBridge.ts WorkflowAgentBridge (managed path: SSE /events tool_call -> validateBrowserWorkspaceLease -> confirmWrite gate (auto mode bypasses non-high-risk) -> workflowContract.dispatch or executeFlovartCommand for non-workflow commands; runtime commands gated by RUNTIME_CONFIRM_COMMANDS + Tauri runtime availability)
→ services/browserWorkflowContract.ts createBrowserWorkflowContract -> dispatchWorkflowCommand
→ services/workflowDispatcher.ts dispatchWorkflowCommand (validateEnvelope, idempotency cache, confirmation gate, command switch; workflow.apply path requires mutationId + expectedRevision; builds WorkflowDocumentOperation[] -> applyWorkflowMutation)
→ components/workflow/draftAuthority.ts applyWorkflowMutation (mutationHash canonicalize+sha256, receipt replay check -> IDEMPOTENCY_KEY_REUSE, expectedRevision vs draftVersion -> REVISION_CONFLICT, applyWorkflowDraftChangeSet -> nodes/connections/draftChangeSets/draftRedoStack/objectVersions)
→ components/workflow/store.ts updateProject -> persist
```
- state owners: agent/kernel.js: SqliteSessionRepo (managed) / services/browserAgentKernel.ts BrowserSessionStore localforage (in-page) — chat sessions, production-skill binding entries, components/workflow/store.ts: WorkflowProject draft (nodes, connections, draftVersion, draftChangeSets, workflowMutationReceipts), agent/session.js WorkflowAgentSession: pending requestId map, clients, activeClientId/activeHostWriter, workspaceLease manager (managed path)
- pass-through layers: services/browserWorkflowContract.ts: Object.freeze wrapper that only re-labels dispatchWorkflowCommand as 'contract' — adds a version field but no validation, auth, or mapping of its own; a genuine pass-through seam, managedFlovartAgent.ts: transport-only SSE decoder (by design; but note it re-implements SSE parsing parallel to WorkflowAgentBridge's EventSource handling — two SSE stacks for one feature)
- verdict: [object Object]

### C) Codex CLI -> workflow.apply
```
skills/flovart/SKILL.md (contract doc: ensure -> inspect -> apply with mutationId/idempotencyKey/expectedRevision)
→ tools/flovart/cli.js (arg parse, normalizeCommandName, WORKSPACE_COMMANDS routing; rejects writes without --idempotency-key with INVALID_ARGUMENT before any I/O)
→ tools/flovart/core.js executeFlovartCommand (workflow.* branch: arg kebab->camel normalization, parseJsonOption for operations/patch/metadata, source='cli', caller{agentIdentity,hostSessionId}; dispatches via runtime.operation (operation-gateway) when command in AGENT_PUBLIC_COMMAND_SET else createWorkspaceFacade dispatch)
→ tools/flovart/operation-gateway.js createOperationGateway (assertPublicOperation -> UNKNOWN_COMMAND for non-public commands; assertWriteEnvelope requires idempotencyKey; forces workspaceMode='browser'; callerFromContext validates agentIdentity/hostSessionId pairing)
→ tools/flovart/workspace-client.js FlovartWorkspaceClient (reads ~/.flovart/agent.json via managed-agent/config.js; enforces http+loopback-only URL; POST /api/tools with x-flovart-agent-token; maps HTTP/body errors to WorkspaceClientError codes WORKSPACE_UNAVAILABLE/WORKSPACE_TIMEOUT/WORKSPACE_COMMAND_FAILED)
→ agent/index.js HTTP server (token check via persistent config token or bootstrap session tokens; POST /api/tools re-gates on AGENT_PUBLIC_COMMAND_SET — second surface check; session.callCommand)
→ agent/session.js WorkflowAgentSession.callCommand (workspaceMode native/headless -> WORKSPACE_REQUIRED; requestedClientId vs activeClientId -> LEASE_TARGET_CHANGED; projectId vs bound snapshot -> LEASE_TARGET_CHANGED; cli/mcp-with-caller source -> authorizeExternalHost (AGENT_HOST_REQUIRED / AGENT_WRITER_INACTIVE / AGENT_HOST_SESSION_MISMATCH / AGENT_PROJECT_INACTIVE); ensureWorkspaceLease -> WorkspaceLeaseManager acquire+validate; forwards envelope over SSE 'tool_call' to the bound browser client)
→ agent/workspace-lease.js WorkspaceLeaseManager (lease lifecycle: acquire/validate/renew/release/expire, mutation binding)
→ services/workflowAgentBridge.ts handleToolCall (browser side: validateBrowserWorkspaceLease, workflow.* -> contract.dispatch, confirmation flow)
→ services/workflowDispatcher.ts -> components/workflow/draftAuthority.ts -> components/workflow/store.ts (same tail as path B)
→ agent/session.js resolveResult (POST /workflow/result -> pending requestId resolve/reject -> CLI prints result JSON)
```
- state owners: ~/.flovart/agent.json (agent/config.js): sidecar URL + bearer token, agent/session.js: SSE client registry, pending request map, activeClientId/activeHostWriter, leases, components/workflow/store.ts: project draft + receipts
- pass-through layers: tools/flovart/workspace-client.js executeEnvelope: field-level pass-through (command/args/source/idempotencyKey/caller) — justified transport, but it does re-map flat HTTP failures into typed codes, so it owns error semantics, core.js workflow.* arg normalization block is a pure adapter (kebab-case->camelCase, JSON parse); it owns compatibility, no state
- verdict: [object Object]

### D) UI Run -> provider -> artifact
```
App.tsx runWorkflowNodeFromUi (requiresExternalGenerationGate -> getGenerationGateDetails -> window.confirm(buildGenerationGateSummary) — cost/provider gate; promptIntent pass-through)
→ services/workflowExecutor.ts createWorkflowExecutor.runNode (runId mint, surface='ui' context, normalizeWorkflowExecutionError)
→ App.tsx handleRunWorkflowNode (revision re-check; dispatches operation nodes to workflowVideoOperations/workflowAudioOperations/workflowImageOperations local-transform reruns; ensureWorkflowImageGenerateOperation may materialize an operation node; calls runWorkflowGeneration)
→ services/workflowGeneration.ts runWorkflowGeneration (modeFor gate: audio->error 'not supported', script->error; cancel prior activeRequest; node -> loading + generationRequestId; resolveWorkflowInputs; frozen WorkflowExecutionTarget; submode inference from resolved references; resolveRouteMappingForSubmit -> {routeId,key}; resolveProviderGenerationExtension; routed-modes capability check (first-last-frame/reference-to-video/image-to-image/image-to-video); prompt assembly stylePreset+camera+movement+texts+mediaLabels; usePromptHistoryStore.record; runPreflight (optimize + localComplianceCheck -> complianceWarnings -> error); buildCanonicalGenerationInput + diagnostics; providerExtension.generation.validate -> ProviderValidationResult; materializeCanonicalReferences (blob/objectURL, temporaryUrls); providerRequest serialize; reserveApiUsage; executeUnifiedIgnition per batch item with onProgress/onProviderTaskLifecycle/resumeProviderTaskId)
→ services/aiGateway.ts executeUnifiedIgnition (180KB provider matrix: routeId -> per-provider submit/poll/cancel/usage; emits ProviderTaskLifecycleEvent submitted/running/cancelled/usage)
→ services/workflowGeneration.ts mediaResult -> ingestWorkflowMedia (blob -> workflowMediaStorage IDB record + video poster)
→ components/workflow/media.ts storage lifecycle (pendingReferences keep-alive until commit; discard on abort; previous storageKey conditional discard via isWorkflowMediaKeyReferenced)
→ services/studio/artifactRegistry.ts registerWorkflowArtifact (opaque {artifactId:runId,kind,mimeType} bound to storageKey, TTL 30min, cap 64) — invoked in App.tsx after success when storageKey exists
→ components/workflow/store.ts updateProject per publish() -> debounced localStorage persist; flushWorkflowPersistence when a durable generationProviderTaskId appears
→ saveGenerationToHistory -> generation history entry (dataUrl thumbnail)
```
- state owners: services/workflowGeneration.ts activeRequests Map<projectId:nodeId,{requestId,controller,runtime}> — in-flight run authority + cancellation, components/workflow/store.ts — node metadata status/progress/error/generationProviderTaskId/usage fields, components/workflow/media.ts + storage.ts — IDB media blobs, reference tracking (pending/transient/canonical), services/studio/artifactRegistry.ts — session artifact registry, usage monitor (reserveApiUsage/updateApiUsage/refundApiUsage) — billing ledger
- pass-through layers: workflowExecutor.ts adds only runId + error normalization — thin but real (identity + error taxonomy), App.tsx handleRunWorkflowNode is a fat adapter: capability dispatch, operation materialization, runtime wiring — owns real branching, not pass-through
- verdict: [object Object]

### E) Provider resume -> artifact
```
App.tsx recovery useEffect (gates: apiKeysLoaded && activeWorkflowProjectId && userApiKeys.length>0; filter video mode + loading + generationProviderTaskId; recoveryTasks.current dedupe key project:node:taskId; resolveRouteMappingForSubmit for the node's modelId+submode; provider must be 'custom' or 'runningHub' else throw '当前 AI 服务暂不支持刷新后恢复视频任务')
→ services/workflowExecutor.ts runNode {surface:'recovery', runId:'recovery_'+providerTaskId, resumeProviderTaskId:providerTaskId}
→ App.tsx handleRunWorkflowNode -> runWorkflowGeneration (same as path D)
→ services/workflowGeneration.ts resume selection: runtime.resumeProviderTaskId wins; else initialNode.metadata.status==='loading' && generationProviderTaskId (deliberately reads initialNode, not current, to avoid resurrecting terminal nodes' stale taskIds)
→ services/aiGateway.ts provider adapters honoring resumeProviderTaskId: custom/Tauri runtime (skip submit, poll taskId), RunningHub rhRunTask(resumeTaskId) + onTaskId lifecycle; image path also accepts resumeTaskId
→ services/workflowGeneration.ts onProviderTaskLifecycle resume annotation ('恢复任务轮询'), then identical commit path -> mediaResult -> ingestWorkflowMedia -> node success -> App.tsx registerWorkflowArtifact
→ failure arm: catch in the effect writes node metadata {status:'error',error:message} directly via updateProject (bypasses executor error normalization)
```
- state owners: App.tsx recoveryTasks ref (in-memory dedupe for the session), node metadata.generationProviderTaskId + status='loading' persisted in localStorage — the durable resume key, provider-side upstream task (external truth)
- pass-through layers: none
- verdict: [object Object]

### F) WorkBuddy Skill -> CLI -> Workflow
```
integrations/workbuddy/flovart/connector-meta.json + cli.json (connector descriptor: npm i -g @flovart/cli; auth/status commands map to workbuddy.auth/status/unAuth; statusMatch '"state":"local-ready"')
→ integrations/workbuddy/flovart/skills/flovart/SKILL.md + references/workflow.md (agent-facing contract: flovart-cli ensure -> status -> workflow.inspect/selection.get -> workflow.apply -> workflow.node.run with --agent-identity workbuddy + stable mutation/idempotency ids)
→ tools/flovart/cli.js workbuddy.* branches (workbuddy.auth -> ensureFlovart({open:false}); workbuddy.status -> getLocalStatus -> {state:'local-ready'|'offline'}; workbuddy.unAuth -> always local-ready, no-op by design — documented 'never revokes shared credentials')
→ tools/flovart/ensure.js ensureFlovart (getLocalStatus -> if not ready spawn 'cli.js start [--source --web] --json --open' -> re-read status -> ensureResponse with HOST_NEEDS_LOGIN/HOST_NEEDS_SETUP/LINK_OFFLINE codes)
→ tools/flovart/local-status.js getLocalStatus (probe frontend candidates 127.0.0.1:37522/11451 + web-discovery + env; inspectLocalAgent via agent.json; FlovartRuntimeClient.status optional; browserConnected = agent ready && clients>0 && hasWorkflow)
→ then identical to path C: operation-gateway (for AGENT_PUBLIC_COMMAND_SET) or workspace facade -> FlovartWorkspaceClient -> agent/index.js /api/tools -> session.callCommand (source 'cli', caller{agentIdentity:'workbuddy'}) -> SSE tool_call -> browser bridge -> dispatcher -> draftAuthority -> store
```
- state owners: WorkBuddy side: installed CLI package + connector lifecycle state (local-ready/offline), Flovart side: identical to path C (agent.json, session.js, workflow store), No WorkBuddy account state exists in Flovart — unAuth is intentionally a no-op
- pass-through layers: connector-meta.json/cli.json are pure packaging descriptors (expected for a connector manifest), workbuddy.unAuth is a semantic no-op returning success — honest no-op, documented, but a host that treats unAuth as real revocation is misled by the 'local-ready' response shape
- verdict: [object Object]

## 7. Confirmed architecture debt

- **ARCH-PATH-02 [P1]** Built-in Agent has two confirmation-gate orderings (managed bridge vs browser kernel) that must be kept in sync by hand
- **ARCH-PATH-03 [P1]** Provider-resume failure arm bypasses executor error taxonomy; zero-key sessions never resume and recoveryTasks dedupe suppresses any in-session retry
- **ARCH-STATE-01 [P1]** Selection has 3 owners: persisted project.selectedNodeIds + InfiniteWorkflow useState/selectedIdsRef + background projection poller rewrites it every 1.5s
- **ARCH-STATE-02 [P1]** Generation status writes bypass draftAuthority: node.metadata.status/progress mutated via plain updateProject — no draftVersion bump, no changeSet, invisible to undo and to lease revision checks
- **ARCH-STATE-03 [P1]** Provider-task/generation-running fact has 3 representations (persisted node.metadata.status, in-memory activeRequests Map, persisted UsageRecord) — reload orphans all three
- **ARCH-STATE-04 [P1]** Agent connection state has 4 owners: Zustand store mirror + browserWorkflowBinding module + sessionStorage/localStorage credential copies + agent-side session.js truth
- **ARCH-STATE-06 [P1]** Asset library kept as React state in App.tsx PLUS module-global cachedLibrary in assetStorage.ts — getAssetById resolves against the module cache that mutator helpers never update
- **ARCH-STATE-08 [P1]** Assistant session backend chosen at mount by connection probe — browser kernel (localforage) vs managed agent (SQLite) hold separate message histories with no migration
- **ARCH-COMP-01 [P1]** components/workflow/InfiniteWorkflow.tsx: 2415-line component (CC≈807) — COMPLEX_AND_MIXED_RESPONSIBILITY
- **ARCH-COMP-02 [P1]** services/workflowGeneration.ts runWorkflowGeneration: 476 lines CC≈195 — COMPLEX_AND_MIXED_RESPONSIBILITY
- **ARCH-COMP-03 [P1]** services/aiGateway.ts: 4142 lines / 154 top-level decls — COMPLEX_AND_MIXED_RESPONSIBILITY
- **ARCH-LEG-01 [P1]** components/agent/agentWorkspaceStore.ts: persisted spatial-panel store with 'Production Crew' migration shim is unreachable in production code
- **ARCH-LEG-02 [P1]** components/community/* + components/landing/communityTypes.ts: community marketplace upload chain is unreachable
- **ARCH-LEG-03 [P1]** services/agentOrchestrator.ts (439L) + services/collaborationPipeline.ts (194L): zero production importers — Director/Crew-era orchestration residue

## 8. Rejected refactor proposals

- **ARCH-PATH-05** Sidecar lease/revision pre-checks run against the last pushed browser snapshot, widening the blind window the browser-side expectedRevision must catch — defended: Two-sided revision check is REQUIRED, not redundant. The sidecar (agent/session.js:187-233) can only see boundSnapshot — the last POST /workflow/state the browser pushed — because it has no access to live browser store state. Its expectedRevision check is an advisory early-fail. The authoritative check MUST live browser-side: components/workflow/draftAuthority.ts:263-273 applyWorkflowMutation validates expectedRevision against live draftVersion, which is the only place the truth exists. You cannot collapse the layers — the sidecar literally cannot read live draftVersion. Correctness is preserved (prosecutor concedes 'correctness holds'). The residual is cosmetic: a stale-base lease yields REVISION_CONFLICT instead of a lease error. That is the correct error anyway — the revision did change. DEFENDED: the layered check is a necessary consequence of snapshot-based distribution, not debt.
- **ARCH-PATH-06** workbuddy.unAuth unconditionally reports local-ready even when nothing was ever connected — indistinguishable from real logout to the host connector — defended: The unconditional 'local-ready' is the CORRECT connector-contract response, not a bug. tools/flovart/cli.js:156-158 documents the intent explicitly: WorkBuddy's connector lifecycle is local-ready semantics, not an OAuth flow — unAuth must NOT revoke Flovart credentials shared by other Hosts, and there is no WorkBuddy account to clear. Returning anything but 'local-ready' would make the WorkBuddy state machine believe the integration is broken. Critically, the honest readiness signal exists separately: workbuddy.status (cli.js:159-162) calls getLocalStatus() and reports state 'local-ready' vs 'offline' truthfully. unAuth is a no-op acknowledgment by design; status is the real probe. A connector that treats unAuth output as proof of readiness is misusing the contract — WorkBuddy's cli.json statusMatch on '"state":"local-ready"' applies to status, not unAuth. DEFENDED: intentional contract semantics with a real status surface available.
- **ARCH-STATE-05** themeMode double-sourced: zustand persist key 'flovart-workspace' AND legacy localStorage 'themeMode.v1' read at store init — last hydration wins — defended: The 'themeMode.v1' read at stores/useWorkspaceStore.ts:24-31 is a one-time legacy-migration seed in the store initializer, not an ongoing dual-writer. Zustand persist (key 'flovart-workspace', version 2) hydrates AFTER init and overwrites themeMode with the persisted value — so the persisted key is authoritative and 'last hydration wins' resolves correctly to the newer source. The 'themeMode.v1' seed only matters on a first-run before any persist record exists, which is exactly what a migration shim is for. The only residual is that the old key is never deleted from localStorage (harmless; it is never read again after persist writes the new key). This is the standard legacy-key migration pattern, not a split-brain — the two keys are not concurrently live because persist hydration always wins. DEFENDED.
- **ARCH-STATE-12** Clipboard duplicated: InfiniteWorkflow clipboardRef (node graph) + useClipboardStore (media items) updated by same handlers, can desync — defended: The two clipboards hold different payloads for different paste semantics — this is domain separation, not duplication. InfiniteWorkflow clipboardRef holds whole WorkflowNode objects (graph copy: positions, connections context, metadata) for canvas-internal node paste (pasteSelection L1705-1717 re-ids and offsets them). useClipboardStore holds extracted media Blobs (kind/mimeType/naturalWidth) for cross-surface media paste and OS clipboard write (L1690-1694 writes ClipboardItem). pasteSelection prefers the graph clipboard and falls back to media items (L1718+) — intentional: copying nodes pastes nodes; copying media-only falls back to media. The 'desync' at L434 (project switch clears clipboardRef but not the store) is the FEATURE: media assets are meant to carry across projects while a node-graph selection is project-scoped. Two facts, two lifetimes, two consumers. DEFENDED — not a desync bug, an intentional per-project-graph vs cross-project-media split.
- **ARCH-STATE-13** Media GC reachability depends on module-global canonicalReferences mirror of project nodes + unregistered transientReferences owner strings — defended: The finding mislabels the mechanism as 'a second hidden copy of which storageKeys exist' — it is not a copy. media.ts:37 canonicalReferences is REBUILT from project nodes on every setWorkflowMediaCanonicalProjects call (L52-54 collectWorkflowMediaKeys) — derived, not mirrored state. The necessary part is transientReferences (L35) + pendingReferences (L36): GC reachability CANNOT be computed from project.nodes alone because a storageKey may be reachable only via an undo-history snapshot, the clipboard, or an in-flight write not yet committed. pruneWorkflowMedia (L64-69) correctly unions canonical + pending + transient before deleting — without the transient registry, undo/clipboard-held blobs would be GC'd. A side-channel reachability registry is the correct architecture for GC over ephemeral refs. Residual risk is real but operational: a missed unregisterWorkflowMediaTransientReferences leaks a blob until reload (bounded, transientReferences is module-lifetime not persistent). DEFENDED — the registry is necessary for correct GC; the fragility is a missed-cleanup risk, not wrong structure.
- **ARCH-COMP-04** tools/flovart/runtime-client.js: COMPLEX_BUT_COHESIVE — ACL/DACL verification + discovery + HTTP/SSE client in one file but single purpose — defended: The prosecutor's own verdict is COMPLEX_BUT_COHESIVE — and it is correct. tools/flovart/runtime-client.js has a single mission: safely locate + authenticate + talk to the local Production Runtime. The Windows DACL parsing block (L60-204) exists ONLY to gate the discovery file the client then reads (assertDiscovery L210-244 feeds FlovartRuntimeClient L254-450). Every function supports the one contract; the complexity is OS-inherent (icacls DACL parsing is unavoidably branchy). Extracting the DACL block buys nothing — its only consumer is this client. This is a security boundary done right: verify ACL before trusting a discovery file. DEFENDED — cohesive, single-purpose, security-driven.
- **ARCH-COMP-05** components/agent/AgentHostPicker.tsx + services/managedAgentConnection.ts + services/managedFlovartAgent.ts: all COMPLEX_BUT_COHESIVE (small) — defended: The prosecutor's own verdict is COMPLEX_BUT_COHESIVE and explicitly 'No action'. Verified: AgentHostPicker.tsx (207L, CC≈31 from JSX status-mapping not logic sprawl) does host discovery + selection persistence + readiness badges — one UI purpose; managedAgentConnection.ts (39L, single getManagedAgentConnection, one seam browser→dock→Tauri, 4 branches); managedFlovartAgent.ts (122L, single SSE-stream client for the managed session). All three are small cohesive single-purpose units. There is no debt to defend — the finding is an exoneration. DEFENDED.
- **ARCH-LEG-05** #/dock route removed but documented as retained dev surface; dockCrewClient.ts persists as connection fallback — defended: The code is NOT legacy — dockCrewClient.ts is live and necessary. Verified services/managedAgentConnection.ts:3,26 calls loadDockConnection() as the non-Tauri fallback for getManagedAgentConnection(), and dockCrewClient.ts:55-78 persists the remembered loopback agent connection (localStorage URL + sessionStorage token, deliberately keeping the token out of localStorage per L60-62). The '#/dock' ROUTE is gone (RouterHost.tsx:36-40 serves only /app), so the UI surface is dead — but the connection-store module it seeded is still the load-bearing mechanism for a saved local agent connection, reachable via agentUrl param/bootstrap path. The only real defect is doc drift: CHANGELOG L35-40 still describes '#/dock' as a retained developer surface RouterHost no longer serves. DEFENDED on the code (live, necessary fallback); the finding reduces to a stale-doc nit, not dead code.
- **ARCH-LEG-06** agent/ directory duplicates tools/flovart/managed-agent/ (12/15 files byte-identical) — source-mode mirror fallback — defended: Verified the duplication is an intentional source→packaged mirror, not accidental copy-paste. agent/ and tools/flovart/managed-agent/ each hold 15 files; diff confirms 12 byte-identical and exactly 3 differ (index.js, skill-package.js, skill-registry.js) — and those 3 MUST differ because they resolve the public command set and skill-package layout relative to a packaged vs source tree. scripts/build-agent-sidecar.mjs:137,173 generates/patches the managed-agent mirror at pack time. tools/flovart/cli.js:110 'await import("./managed-agent/index.js").catch(() => import("../../agent/index.js"))' is the deliberate fallback so a raw source checkout (no prepack) still works. This is checked-in build output so the CLI runs without a build step — a legitimate pattern. The index.js divergence the finding flags is the POINT (AGENT_PUBLIC_COMMAND_SET resolves differently per layout), not drift. Residual: no automated parity check on the 12 identical files — a hardening opportunity, not debt. DEFENDED.

## 9. Fixes applied

- **UX-FTC-01 [P0]** Empty-state '创建项目' button is rendered off-viewport and physically unclickable
  - components/studio/StudioRightDrawer.tsx: when drawer is closed, apply display:none (not just width:0+opacity:0). The 0px-wide aside was clipping children visually but they still had real layout rects — the 'Create project' CTA inside the agent empty-state card rendered at x=1449 (off-viewport center) and was hit-test-dead. With display:none the children produce no layout box at all when collapsed; verified live — createProject rect now {x:1220, w:80, h:32} inside the open drawer, or {x:0,w:0,h:0} when collapsed.
- **UX-HEU-01 [P0]** Delete current workflow executes instantly with no confirmation and no undo
  - components/studio/StudioTopMenu.tsx: 'Delete current workflow' menu item now opens an inline role=alertdialog inside the Flovart popover instead of executing instantly. Dialog shows the project title, requires clicking 'Delete' to confirm, offers 'Cancel'. Verified live — judge-04-batch now reports dialog:1 (was 0) and nodes stay at 2 until confirmed.
- **UX-HEU-02 [P0]** Documented Delete/Backspace shortcut does nothing on a selected node — silent no-op
  - components/workflow/InfiniteWorkflow.tsx keydown handler: Delete/Backspace now bypasses BLOCKED_TARGET for button-class targets. Only EDITABLE_TARGET (textarea/input/select/video/audio/contenteditable) still swallows the key — buttons don't consume Delete for their own semantics, so a selected node + focused toolbar button now deletes correctly. Verified live: focus on 'button[aria-label=添加节点]', node is-selected, press Delete → nodeCount drops 1→0 (was a silent no-op).
- **UX-HEU-05 [P1]** Top-bar '离线' badge shows no tooltip and hijacks navigation to the Agent view
  - components/studio/StudioTopMenu.tsx: the 离线/Offline agent badge's title now reads 'Agent 离线 — 打开工作区查看' / 'Agent Offline — open workspace' instead of generic '打开 Agent 工作区'. Tooltip names WHAT is offline (the Agent status from toLocalLinkPublicStatus) and explains the click action, fixing the silent-hijack UX. Verified: title attribute on the button now correctly labels the status.
- **UX-HEU-10 [P1]** Node deletion has zero confirmation and zero recovery notice — only Ctrl+Z memory saves you
  - components/workflow/InfiniteWorkflow.tsx + WorkflowWorkspace.tsx + App.tsx: added an onNotify prop plumbed WorkflowWorkspace→InfiniteWorkflow→App's toast system. Both delete paths (keyboard Delete via deleteSelection, and right-click context-menu 删除) now fire toast '已删除 N 个节点 — Ctrl+Z 撤销'/'Deleted N nodes — Ctrl+Z to undo' after applyOps. Verified live: right-click → 删除 on a node now produces an isl-shell toast reading '🔄已删除 1 个节点 — Ctrl+Z 撤销' (previously toasts=[]).
- **UX-HEU-11 [P1]** Modal layer ordering: '打开模型映射' quick-fix button is occluded by the collapsed-panel toggle
  - Same root cause as UX-FTC-01 — fixed by StudioRightDrawer.tsx display:none when collapsed. The '打开模型映射' quick-fix button inside FlovartAgentPanel used to render at x=1511 (off-viewport) inside the 2px collapsed drawer; now the drawer either renders open (button reachable at x=1251 inside) or display:none (button not in a11y/hit-test tree at all). Verified live: judge-04-batch heu11.rect now {x:1251, y:100, w:68, isSelf:true} — elementFromPoint hits the actual button.
- **UX-AGT-02 [P1]** Generation-mode popover does not dismiss on Escape or outside click; while open it blocks the composer textarea
  - components/agent/FlovartAgentPanel.tsx: added a document-level Escape keydown + mousedown listener that dismisses all transient popovers in the agent panel (modeOpen, infoPanel, sessionsOpen, mentionOpen, attachmentOpen). Outside clicks close the popover; clicks inside the popover or on the trigger button are filtered out so menu items still register. Verified live: judge scenario pops the 自动 mode trigger → Escape now closes it; outside click at (500,450) also closes it; composer textarea hit-test no longer covered while popover is open.
- **UX-PRO-03 [P1]** Newly added nodes stack at the exact same canvas coordinates
  - components/workflow/InfiniteWorkflow.tsx addNode: cascade the spawn position diagonally (+40,+40) up to 12 times while the proposed slot is occupied by another visible node (within 30px collision radius). Verified live: adding 文本 → 图片 → 脚本 now produces nodes at (358,382), (398,422), (438,462) — previously all three landed at exactly (544,382) stacked on top of each other.
- **UX-PRO-04 [P1]** Agent drawer is collapsed to 2px by default and its composer is unusable until manually opened
  - components/workflow/WorkflowWorkspace.tsx: desktopRightOpen initial state changed from '=== "true"' (default closed) to '!== "false"' (default open). The drawer is the headline Agent surface; starting collapsed to a 2px strip hid the composer entirely on first run. localStorage still persists the user's explicit choice — once they collapse it, it stays collapsed. Verified live: fresh session drawer now opens at width=360px (was 2px), composer and 'Create project' CTA reachable.


_Deferred to backlog (documented debt, not beta blockers): 25_

- **UX-FTC-03 [P1]** Agent send is hard-blocked on 'model mapping' with jargon, no guided fix — Agent send blocked on model-mapping jargon. Real copy fix needed — deferred: requires rewriting the gate UX with actionable recovery (link to settings, inline key input).
- **UX-FTC-04 [P1]** All agents offline; 'current agent' Codex unusable, alternates marked experimental — All agents offline; Codex unusable; alternates experimental. Depends on backend availability — not fixable in source.
- **UX-HEU-03 [P1]** English mode leaves ~all Agent-view strings in Chinese — mixed-language UI — English mode leaves ~all Agent-view strings in Chinese. Requires i18n sweep across FlovartAgentPanel + AgentWorkspace — large surface.
- **UX-HEU-06 [P1]** No help, docs, about, or onboarding affordance exists anywhere in the app — No help/docs/about/onboarding affordance anywhere. Feature add, not a defect fix.
- **UX-HEU-08 [P1]** Disabled 发送 button gives no reason — no tooltip, no inline explanation at the control — Disabled 发送 button gives no reason. Real but small — needs disabled-tooltip pattern across many controls.
- **UX-HEU-14 [P1]** System status fragmentation: three disconnected offline/config states shown with no single health surface — Status fragmentation: three disconnected offline/config states. Requires status-model consolidation.
- **UX-AGT-01 [P1]** Built-in Agent drawer works beside canvas but web session is unusable: send is blocked by 'model mapping' + 'desktop only' errors — Built-in Agent drawer works beside canvas but web session unusable: send blocked by needsConfiguration gate. Subsumes UX-FTC-03 — same fix area.
- **ARCH-PATH-02 [P1]** Built-in Agent has two confirmation-gate orderings (managed bridge vs browser kernel) that must be kept in sync by hand — Built-in Agent has two confirmation-gate orderings (managed bridge vs browser kernel). Real architectural divergence.
- **ARCH-PATH-03 [P1]** Provider-resume failure arm bypasses executor error taxonomy; zero-key sessions never resume and recoveryTasks dedupe suppresses any in-session retry — Provider-resume failure arm bypasses executor error taxonomy. Refactor.
- **ARCH-STATE-01 [P1]** Selection has 3 owners: persisted project.selectedNodeIds + InfiniteWorkflow useState/selectedIdsRef + background projection poller rewrites it every 1.5s — Selection has 3 owners (persisted selectedNodeIds + useState/selectedIdsRef + 1.5s projection poller). Real defect — the poller can race user clicks — but fixing means consolidating selection ownership across InfiniteWorkflow + adapter + store, an architectural refactor. Out of scope per fix policy.
- **ARCH-STATE-02 [P1]** Generation status writes bypass draftAuthority: node.metadata.status/progress mutated via plain updateProject — no draftVersion bump, no changeSet, invisible to undo and to lease revision checks — Generation status writes bypass draftAuthority — node.metadata.status/progress mutated outside the authority path. Real refactor.
- **ARCH-STATE-03 [P1]** Provider-task/generation-running fact has 3 representations (persisted node.metadata.status, in-memory activeRequests Map, persisted UsageRecord) — reload orphans all three — Provider-task/generation-running fact has 3 representations. Consolidation is architectural.
- **ARCH-STATE-04 [P1]** Agent connection state has 4 owners: Zustand store mirror + browserWorkflowBinding module + sessionStorage/localStorage credential copies + agent-side session.js truth — Agent connection state has 4 owners (Zustand + browserWorkflowBinding module + others). Architectural refactor.
- **ARCH-STATE-06 [P1]** Asset library kept as React state in App.tsx PLUS module-global cachedLibrary in assetStorage.ts — getAssetById resolves against the module cache that mutator helpers never update — Asset library split between React state in App.tsx and module-global cachedLibrary in assetStorage. Consolidation is architectural.
- **ARCH-STATE-08 [P1]** Assistant session backend chosen at mount by connection probe — browser kernel (localforage) vs managed agent (SQLite) hold separate message histories with no migration — Assistant session backend chosen at mount by connection probe — localforage fallback path. Architectural.
- **UX-PRO-01 [P1]** Selected node's inline prompt bar is a large floating overlay that occludes the Add-Node dropdown menu — Selected node prompt bar occludes Add-Node dropdown. Layout overlap — needs z-index/positioning audit.
- **UX-PRO-02 [P1]** No inspector / properties panel exists for the selected object — No inspector / properties panel exists. Feature add.
- **UX-PRO-05 [P1]** No visible indication of which node is the current selection outside the node itself — No visible selection indicator outside node itself. Feature add.
- **UX-PRO-06 [P1]** 资产 (Assets) tab is empty and offers no path to get assets onto the canvas — 资产 (Assets) tab is empty with no path to add. Feature add.
- **ARCH-COMP-01 [P1]** components/workflow/InfiniteWorkflow.tsx: 2415-line component (CC≈807) — COMPLEX_AND_MIXED_RESPONSIBILITY — InfiniteWorkflow.tsx is 2415 lines, CC≈807. Confirmed complexity debt — splitting is a large refactor.
- **ARCH-COMP-02 [P1]** services/workflowGeneration.ts runWorkflowGeneration: 476 lines CC≈195 — COMPLEX_AND_MIXED_RESPONSIBILITY — runWorkflowGeneration is 476 lines CC≈195. Large refactor.
- **ARCH-COMP-03 [P1]** services/aiGateway.ts: 4142 lines / 154 top-level decls — COMPLEX_AND_MIXED_RESPONSIBILITY — aiGateway.ts is 4142 lines / 154 decls. Large refactor.
- **ARCH-LEG-01 [P1]** components/agent/agentWorkspaceStore.ts: persisted spatial-panel store with 'Production Crew' migration shim is unreachable in production code — agentWorkspaceStore.ts has persisted spatial-panel store with Production Crew strings — legacy surface.
- **ARCH-LEG-02 [P1]** components/community/* + components/landing/communityTypes.ts: community marketplace upload chain is unreachable — community/* + communityTypes.ts — marketplace upload surface still present.
- **ARCH-LEG-03 [P1]** services/agentOrchestrator.ts (439L) + services/collaborationPipeline.ts (194L): zero production importers — Director/Crew-era orchestration residue — agentOrchestrator.ts + collaborationPipeline.ts — zero production callers.

## 10. Regression results

- `npx tsc --noEmit`: exit 0 (clean) post-fix.
- `npx vitest run`: 1126/1127 tests pass post-fix. The single failure was `tests/workflowRightPanel.test.tsx > starts collapsed by default`, which pinned the pre-fix collapsed-drawer default that UX-PRO-04 deliberately changed to default-open. The test was updated to assert the new contract (open-by-default on desktop + persistence); the file now passes 5/5.
- No app-code regression observed in re-run judge batches; holdouts re-verified (see §13).

## 11. Accessibility results

- Keyboard-only add-to-canvas (WCAG 2.2 drag-alternative): `ux11-keyboard-add` — local-folder cards are keyboard-focusable and a non-drag "add to canvas" control exists; latest run 0 failures. (Earlier failures were headless File-System-Access grant limits, not a11y defects.)
- Delete/Backspace on a selected node (UX-HEU-02): previously a silent no-op when focus rested on a toolbar control; now bypasses non-editable targets so the documented shortcut deletes the selection. Editable targets (textarea/input/contenteditable) still correctly treat Delete as text-edit.
- Duplicate create CTAs (UX-PRO-09, P2 STANDS): two buttons share aria-label "新建工作流"; post-fix the off-viewport one is `display:none` when the drawer is collapsed, removing the dead-control resolution ambiguity.
- Focus traversal / zoom control (UX-HEU-13 DEFENDED): the "100%" control is a working button with accessible name "重置缩放" that opens a zoom menu — earlier report was a locator miss.
- Residual a11y debt (deferred): mixed-language Agent strings under English mode (UX-HEU-03), no help/onboarding surface (UX-HEU-06), disabled-send has no inline reason (UX-HEU-08).

## 12. Performance observations

- `timeToFirstUsefulAction` on cold onboarding ≈ 12-15ms after SPA mount (holdout ho01); create CTA in-viewport immediately.
- No long-task or network anomalies in scenario network/console captures; node ops are localStore-sync, generation runs are async SSE. See per-scenario `metrics`/`network.json`.

## 13. Holdout results

- `ho01-cold-onboarding` (fresh context, blank project): **PASS** post-fix — controls exposed, primary create CTA in-viewport (x=664), `timeToFirstUsefulAction`≈12ms.
- `ho02-state-survives-resize` (drawer + selection across viewport resize): **PASS** post-fix — drawer open before resize and stays open after 1440→1024 resize. Note: the scenario was updated because UX-PRO-04 now defaults the drawer open on desktop; the collapsed-state "open" button remains in the DOM with `pointer-events:none`, so the scenario gates on `aside[data-open=true]` rather than clicking the hidden button.

## 14. External gates

- **File System Access** (UX-FTC-02, ENVIRONMENT): folder connect throws AbortError under headless Chromium — the picker cannot be granted headless; on headed Chrome it opens. App correctly treats cancel as benign (no error toast on user-abort is correct).
- **Provider credentials / agent hosts** (UX-FTC-03, UX-FTC-04, UX-AGT-01 — DEFERRED): all three agent hosts (Codex/WorkBuddy/DeepSeek) report offline in the dev build and send is gated on BYOK model-mapping. This is an environment/credential gate, not a code defect, but it is the largest *activation* blocker for a first-run user — flagged as the top known limit.
- No external network dependency is required for the canvas/asset/local-folder core loop.

## 15. Beta blockers

No open (unfixed, non-deferred) blockers — every confirmed P0 is fixed. The confirmed P1 below are deferred known-limits accepted for closed beta and tracked as debt:
- **UX-FTC-03 [P1]** Agent send is hard-blocked on 'model mapping' with jargon, no guided fix
- **UX-FTC-04 [P1]** All agents offline; 'current agent' Codex unusable, alternates marked experimental
- **UX-HEU-03 [P1]** English mode leaves ~all Agent-view strings in Chinese — mixed-language UI
- **UX-HEU-06 [P1]** No help, docs, about, or onboarding affordance exists anywhere in the app
- **UX-HEU-08 [P1]** Disabled 发送 button gives no reason — no tooltip, no inline explanation at the control
- **UX-HEU-14 [P1]** System status fragmentation: three disconnected offline/config states shown with no single health surface
- **UX-AGT-01 [P1]** Built-in Agent drawer works beside canvas but web session is unusable: send is blocked by 'model mapping' + 'desktop only' errors
- **ARCH-PATH-02 [P1]** Built-in Agent has two confirmation-gate orderings (managed bridge vs browser kernel) that must be kept in sync by hand
- **ARCH-PATH-03 [P1]** Provider-resume failure arm bypasses executor error taxonomy; zero-key sessions never resume and recoveryTasks dedupe suppresses any in-session retry
- **ARCH-STATE-01 [P1]** Selection has 3 owners: persisted project.selectedNodeIds + InfiniteWorkflow useState/selectedIdsRef + background projection poller rewrites it every 1.5s
- **ARCH-STATE-02 [P1]** Generation status writes bypass draftAuthority: node.metadata.status/progress mutated via plain updateProject — no draftVersion bump, no changeSet, invisible to undo and to lease revision checks
- **ARCH-STATE-03 [P1]** Provider-task/generation-running fact has 3 representations (persisted node.metadata.status, in-memory activeRequests Map, persisted UsageRecord) — reload orphans all three
- **ARCH-STATE-04 [P1]** Agent connection state has 4 owners: Zustand store mirror + browserWorkflowBinding module + sessionStorage/localStorage credential copies + agent-side session.js truth
- **ARCH-STATE-06 [P1]** Asset library kept as React state in App.tsx PLUS module-global cachedLibrary in assetStorage.ts — getAssetById resolves against the module cache that mutator helpers never update
- **ARCH-STATE-08 [P1]** Assistant session backend chosen at mount by connection probe — browser kernel (localforage) vs managed agent (SQLite) hold separate message histories with no migration
- **UX-PRO-01 [P1]** Selected node's inline prompt bar is a large floating overlay that occludes the Add-Node dropdown menu
- **UX-PRO-02 [P1]** No inspector / properties panel exists for the selected object
- **UX-PRO-05 [P1]** No visible indication of which node is the current selection outside the node itself
- **UX-PRO-06 [P1]** 资产 (Assets) tab is empty and offers no path to get assets onto the canvas
- **ARCH-COMP-01 [P1]** components/workflow/InfiniteWorkflow.tsx: 2415-line component (CC≈807) — COMPLEX_AND_MIXED_RESPONSIBILITY
- **ARCH-COMP-02 [P1]** services/workflowGeneration.ts runWorkflowGeneration: 476 lines CC≈195 — COMPLEX_AND_MIXED_RESPONSIBILITY
- **ARCH-COMP-03 [P1]** services/aiGateway.ts: 4142 lines / 154 top-level decls — COMPLEX_AND_MIXED_RESPONSIBILITY
- **ARCH-LEG-01 [P1]** components/agent/agentWorkspaceStore.ts: persisted spatial-panel store with 'Production Crew' migration shim is unreachable in production code
- **ARCH-LEG-02 [P1]** components/community/* + components/landing/communityTypes.ts: community marketplace upload chain is unreachable
- **ARCH-LEG-03 [P1]** services/agentOrchestrator.ts (439L) + services/collaborationPipeline.ts (194L): zero production importers — Director/Crew-era orchestration residue
