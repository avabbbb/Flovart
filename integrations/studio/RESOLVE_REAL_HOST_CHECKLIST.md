# DaVinci Resolve host certification

Status: `EXTERNAL_GATE`. `dist-studio/resolve` is a Resolve Studio Workflow
Integration panel package; the installed Studio edition and bridge still need
real-host verification.

Verify the current Blackmagic Workflow Integration API and the installed
edition. Inject `window.__FLOVART_RESOLVE_BRIDGE__` with `getContext`,
`getSelection`, `materializeClip` and `importArtifact`. The first target is
Resolve Studio's supported Workflow Integration surface, not a claimed native
Inspector plug-in for free Resolve.

The first tracer must be limited to:

```text
selected clip
  -> provider-neutral reference
  -> Flovart Workflow generation
  -> artifact
  -> Media Pool import
```

Timeline insertion is out of scope until the host API can safely identify the
same project and selection at import time. Expected evidence: package
build/install output, selected-clip context, canonical/wire fixture, Media Pool
item before/after, and an explicit Resolve-versus-Resolve Studio support note.
