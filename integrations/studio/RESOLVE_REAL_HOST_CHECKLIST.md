# DaVinci Resolve host certification

Status: `EXTERNAL_GATE`.

The current target is **DaVinci Resolve Studio Workflow Integration**. A future OFX effect is a separate deliverable and must not inherit certification from the panel.

## Workflow Integration tracer

Verify the installed Resolve Studio version and its bundled Developer / Workflow Integration documentation. The first target is the supported `Workspace > Workflow Integrations` surface, not a claimed native Inspector plug-in and not free-Resolve compatibility.

Security/runtime baseline for current Resolve 20.x integrations:

- Electron sandbox enabled;
- `contextIsolation: true`;
- renderer `nodeIntegration: false`;
- native `WorkflowIntegration.node` loaded outside the renderer and exposed through a narrow preload/contextBridge;
- use Promise scripting APIs when the installed Resolve developer package supports them;
- clean up the integration on quit;
- use an API timeout/recovery policy for calls that can stall.

First tracer:

```text
selected Media Pool clip or current timeline item
  -> provider-neutral reference
  -> Flovart generation path
  -> durable artifact
  -> Media Pool import
```

Timeline insertion/replacement remains out of scope until the host API can safely prove project identity, selection identity and undo/recovery semantics at commit time.

Required evidence:

- real Studio install and plugin registration;
- context and selection changes observed in the panel;
- selection identity rechecked immediately before materialization;
- canonical input and Provider wire fixture;
- artifact imported into Media Pool;
- temp-file lifetime survives long enough for Resolve to own/read the imported media;
- disconnect, timeout and app-close cleanup;
- narrow/wide window resize remains usable;
- explicit Resolve vs Resolve Studio support note.

## OFX boundary

A future Flovart OFX effect is for persisted parameters + fixed artifact rendering. It must not start generation from the render callback.

Its certification requires, independently:

- effect installation;
- parameter persistence and keyframes;
- fixed artifact/version reopening;
- random-frame playback/export;
- missing/moved artifact behavior;
- offline render;
- tested color space, alpha, frame-rate and time-base behavior.

## Evidence wording

Allowed after package/mock checks:

> Resolve Studio Workflow Integration package exists and is Experimental; real-host certification remains open.

Do not describe the current Workflow Integration panel as an OFX/native effect or as support for free Resolve.
