# DaVinci Resolve Studio 21.1 host certification

Status: `EXTERNAL_GATE`.

Current first path: **Blackmagic native MCP + Flovart Skill/CLI**, followed by the Flovart Resolve light panel. The existing Workflow Integration Electron package remains Experimental and may be used as a human-review surface or a measured fallback. A future OFX effect is a separate later deliverable.

Product/UI contract: [resolve/PRODUCT_UI_SPEC.md](resolve/PRODUCT_UI_SPEC.md).

## 0. Environment

Record before any claim:

- OS and build;
- DaVinci Resolve **Studio 21.1** exact build;
- license type/status sufficient for the native AI assistant integration;
- external Agent name/version;
- Flovart commit;
- Node/runtime versions needed by Flovart;
- actual MCP tools exposed by this installed Resolve build.

Do not infer Studio behavior from Free Resolve.

## 1. Native MCP connection

In real Resolve Studio 21.1:

1. launch the external Agent at least once if Resolve discovery requires it;
2. use `File > Setup AI Assistants`;
3. restart the relevant Agent/Resolve process if the installed build asks for it;
4. verify the Agent can query the running Resolve project;
5. capture the exact MCP tool list and connection evidence.

The exact tool names/count are not a Flovart compatibility contract. Community reports describe a small API/doc-search + script-execution surface, but the installed build is authoritative.

### Windows UTF-8 tracer

Test at least:

- ASCII project/bin/marker names;
- Chinese project/bin/marker names;
- Chinese text written by generated scripting code.

A community 21.1 test reports Python/CJK encoding failures on Windows and a `PYTHONUTF8=1` mitigation for some Agent hosts. Do **not** add that workaround unless reproduced on the target machine. If reproduced, record host, command, stderr and the narrowest fix.

## 2. Read-only target identity

Before Flovart generation:

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
  -> Flovart deterministic/fake artifact
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

## 4. Flovart Resolve panel

The panel must follow [PRODUCT_UI_SPEC.md](resolve/PRODUCT_UI_SPEC.md).

Required real-host states:

- no project;
- project but no selection;
- ready selection;
- running generation;
- candidate ready;
- Resolve disconnected;
- Flovart disconnected;
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
- `Open in Flovart` preserves task/artifact context.

Known implementation issue to verify/fix before certification: the current Resolve adapter passes `{ kind: 'media-pool' }`, while the generic shared output select currently creates only non-Resolve options and may leave the select value unmatched.

## 5. Artifact lifetime

The current experimental Workflow Integration writes a temporary result file and removes it after calling Media Storage import. Do not assume Resolve has copied/owned the bytes.

Verify:

- imported media remains online after the Flovart import call returns;
- closing/reopening the project retains readable media;
- restarting Resolve retains readable media;
- Flovart can map the Media Pool item to a durable artifact/version;
- missing/moved artifact fails visibly.

If Resolve references the source file, switch the implementation to the Flovart durable artifact location rather than deleting a temp file.

## 6. One real Provider tracer

Only after sections 1–5 pass.

Use one approved RunningHub route:

~~~text
selected clip/frame
  -> materialize reference
  -> one paid generation
  -> durable Flovart artifact
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

Allowed after MCP + P0 only:

> Resolve Studio 21.1 native MCP and Flovart Media Pool generation/import flow were real-host validated on the recorded environment.

Do not say:

- Resolve fully supported;
- Free Resolve supported;
- OFX supported;
- automatic safe timeline replacement supported;

until each corresponding gate has real evidence.
