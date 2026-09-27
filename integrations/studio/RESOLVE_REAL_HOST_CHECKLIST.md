# Iris — DaVinci Resolve Studio 21.1 host certification

Status: `EXTERNAL_GATE`.

Current first path: **Resolve native MCP → external Agent (for example, Codex) → Iris Skill + legacy `flovart` CLI → durable artifact → Resolve Media Pool**. Resolve owns its MCP control plane; Iris must not add a second Resolve MCP server. The Iris Resolve light panel is a human review/generation surface and a measured fallback adapter. The existing Workflow Integration Electron package remains Experimental. A future OFX effect is a separate later deliverable.

Product/UI contract: [resolve/PRODUCT_UI_SPEC.md](resolve/PRODUCT_UI_SPEC.md).

## Current local discovery (2026-09-27)

These are observations from the current Windows checkout, not host certification:

| Check | Observed | Limit |
| --- | --- | --- |
| OS | Windows 11 Pro for Workstations, version `10.0.26200`, build `26200` | One local machine only |
| Resolve registry version | `21.0.00020` | This is not the target 21.1 build and does not establish Studio license/edition or the running host version |
| Node / npm | `v24.14.0` / `11.9.0` | Toolchain inventory only |
| Resolve process | Not running during this check | No live-host version or behavior was observed |
| Workflow Integration native module | `WorkflowIntegration.node` was absent from both checked build-discovery locations: the Resolve installation path and the default ProgramData sample-plugin path | The current panel package cannot be treated as runnable in Resolve on this machine; recheck the actual SDK/example install path before host testing |
| Native MCP / Agent | No connection, tool list, project read, or selection read was captured | No native MCP evidence |

The current machine has not verified Resolve Studio 21.1, a Studio license, `File > Setup AI Assistants`, or any Media Pool operation. Recheck this inventory on the actual target environment before starting the gates below.

## 0. Environment

Record before any claim:

- OS and build;
- DaVinci Resolve **Studio 21.1** exact build;
- license type/status sufficient for the native AI assistant integration;
- external Agent name/version;
- Iris commit;
- Node/runtime versions needed by Iris;
- actual MCP tools exposed by this installed Resolve build.

Do not infer Studio behavior from Free Resolve.

## 1. Native MCP connection

In real Resolve Studio 21.1:

1. launch the external Agent at least once if Resolve discovery requires it;
2. use `File > Setup AI Assistants`;
3. restart the relevant Agent/Resolve process if the installed build asks for it;
4. verify the Agent can query the running Resolve project;
5. capture the exact MCP tool list and connection evidence.

The exact tool names/count are not an Iris compatibility contract. Community reports describe a small API/doc-search + script-execution surface, but the installed build is authoritative.

### Windows UTF-8 tracer

Test at least:

- ASCII project/bin/marker names;
- Chinese project/bin/marker names;
- Chinese text written by generated scripting code.

A community 21.1 test reports Python/CJK encoding failures on Windows and a `PYTHONUTF8=1` mitigation for some Agent hosts. Do **not** add that workaround unless reproduced on the target machine. If reproduced, record host, command, stderr and the narrowest fix.

## 2. Read-only target identity

Before Iris generation:

- read current project identity;
- read current timeline identity if applicable;
- read current selected Media Pool clip or timeline item;
- capture name, media kind, source path/reference when permitted, and time range/current frame;
- change selection after capture and prove the captured identity does not silently follow the UI.

Read-only discovery may run without extra approval.

## 3. P0 deterministic Golden Task — no paid Provider

First real-host success condition:

~~~text
Resolve selection
  -> capture immutable target identity
  -> Iris deterministic fixture artifact
  -> durable local artifact file
  -> import to correct Resolve Media Pool
  -> original timeline unchanged
~~~

Required evidence:

- source clip/timeline state before;
- target identity captured;
- artifact path/hash/size;
- Media Pool state after;
- original timeline unchanged;
- no second Resolve MCP server or hidden project state created.

If the native MCP cannot perform the required import operation, document the exact missing capability before using the existing Workflow Integration bridge.

## 4. Iris Resolve panel

The panel must follow [PRODUCT_UI_SPEC.md](resolve/PRODUCT_UI_SPEC.md).

### Current worktree source status — not real-host evidence

The current vertical worktree contains source changes for a compact Resolve-specific Inspector path: English/Chinese labels, Current Clip, Generate, References, Model, `Output: Media Pool`, Task, Candidate cards, and a persistent `Open in Iris` footer. The old Resolve `制作` / `本次记录` tab navigation is removed from that path. Candidate state distinguishes confirmed import, explicit rejection, and unknown outcome; an unknown outcome disables blind retry.

The panel/controller source contains frozen-target and durable-candidate contracts, but they are not production-wired: `installStudioBrowserLink()` has no production caller, while `resolve/index.js` only reads `__FLOVART_STUDIO_CONTROLLER__`. The CLI/Browser JSON/SSE bridge cannot carry the bounded 64 MiB artifact payload (36 MiB request cap; roughly 27 MiB binary if base64 encoded). The `Open in Iris` footer also calls `onOpenCanvas()` without workflow/project/task/artifact/target context. Component tests and package output therefore do not establish a reachable panel generation/import path. The current local registry reports Resolve `21.0.00020`, and the Workflow Integration native module is missing from the checked install path, so this worktree has no real Resolve 21.1 panel evidence.

Required real-host states:

- no project;
- project but no selection;
- ready selection;
- running generation;
- candidate ready;
- Resolve disconnected;
- Iris disconnected;
- failure/retry.

Required UI evidence:

- Current Clip is first and matches the actual host selection;
- pending task keeps its captured target if the user selects another clip;
- one dominant CTA;
- `Output: Media Pool` is an actual selectable/default option;
- no raw port/token/MCP JSON is shown;
- no embedded Agent chat;
- narrow/wide resizing without horizontal scrolling;
- candidate primary action is `Add to Media Pool`;
- `Open in Iris` carries workflow/project/task/artifact/target through an explicit context handoff; the current source does not pass these arguments.

Still to verify in the real host: the Media Pool option must render and remain selected at the target panel widths; selection/context and task target must match Resolve; the panel must load and recover correctly inside Studio 21.1. The former source mismatch between `{ kind: 'media-pool' }` and the shared select is fixed in the current worktree, but only source/component checks are available so far.

## 5. Artifact lifetime

### Current worktree source status — not real-host evidence

The current source contains code to write Resolve candidates below Electron `app.getPath('userData')/artifacts/resolve`, using a content-addressed path and sidecar provenance. The IPC receipt omits the local file path. Before import, the main process checks the frozen Resolve project identity and verifies persisted metadata, byte size and SHA-256; import input is capped at 64 MiB. It keeps the durable file after `ImportMedia` returns and classifies an exception after the import call as an unknown outcome. Since the production controller wiring is absent, these are isolated modules/contracts rather than a reachable product path. The artifact-store/import tests use a fake Resolve API and filesystem fixtures; they do not establish Resolve's file ownership or reopen behavior.

Do not assume that Resolve copies/owns the bytes. The previous implementation's “temporary file then unlink” behavior has been replaced in the current worktree, but the durable-path behavior still needs real-host validation.

Verify:

- imported media remains online after the Iris import call returns;
- closing/reopening the project retains readable media;
- restarting Resolve retains readable media;
- Iris can map the Media Pool item to a durable artifact/version;
- missing/moved artifact fails visibly.

Do not delete or garbage-collect the durable source until real project close/reopen and Resolve restart tests establish whether and when it is safe. The actual Media Pool API binding and whether the project references or copies the file remain unverified.

## 6. One real Provider tracer

Only after sections 1–5 pass.

Use one approved RunningHub route:

~~~text
selected clip/frame
  -> materialize reference
  -> one paid generation
  -> durable Iris artifact
  -> Media Pool import
~~~

Record:

- model/route;
- task/provider task ID;
- cost/usage evidence when available;
- input artifact/reference identity;
- result hash/size;
- cancellation behavior;
- 429 behavior if encountered;
- unknown-after-submit recovery;
- reconnect/query behavior.

Do not run a model matrix.

## 7. P1 — add to new track

After P0:

- add a candidate to a new video track;
- do not delete/replace the original;
- verify timeline, track and insertion range immediately before commit;
- verify resulting clip duration/frame-rate interpretation;
- verify Undo or an equivalent recoverable path where the API supports it.

## 8. P2 — Replace / Commit

Only after P1:

- explicit user/Agent instruction;
- fresh project/timeline/item identity recheck;
- conflict if the original target changed/disappeared;
- no fallback to “whatever is currently selected”;
- preserve source media and recovery information;
- verify save/reopen.

## 9. Unsafe scripting boundary

If the installed native MCP exposes both bounded and unsafe arbitrary script execution:

- use bounded execution by default;
- do not enable filesystem/network escape to make a demo pass;
- destructive timeline/project actions require the product approval rules;
- redact generated scripts/logs when they contain local private paths or credentials.

## 10. Workflow Integration fallback

The existing `integrations/studio/resolve/` Electron package remains valid as an Experimental host surface.

When it is used:

- sandbox enabled;
- `contextIsolation: true`;
- renderer `nodeIntegration: false`;
- narrow preload/contextBridge;
- use Promise scripting APIs when supported;
- clean up native integration on quit;
- add API timeout/recovery;
- never read Provider credentials in the panel.

Do not make the custom Workflow Integration a mandatory Agent control layer if native MCP already solves the operation.

## 11. OFX boundary

OFX is later and independent.

Do not begin until a measured workflow requires host-persisted fixed-version effect parameters, keyframes or offline effect rendering.

Future OFX certification requires independently:

- effect installation;
- parameter persistence/keyframes;
- fixed artifact version;
- random-frame playback/export;
- missing/moved artifact behavior;
- offline rendering;
- color/alpha/frame-rate/time-base evidence.

MCP, panel or Media Pool success does not certify OFX.

## Evidence wording

Allowed after native MCP + Iris artifact handoff + P0 have all passed in the real host:

> Resolve Studio 21.1 native MCP and Iris durable-artifact-to-Media-Pool flow were real-host validated on the recorded environment.

Do not say:

- Resolve fully supported;
- Free Resolve supported;
- OFX supported;
- automatic safe timeline replacement supported;

until each corresponding gate has real evidence.
