# After Effects host certification

Status: `EXTERNAL_GATE`. `dist-studio/after-effects` is a CEP panel package;
the installed After Effects version and its CEP/ExtendScript bridge still need
real-host verification.

Verify the installed Adobe-supported extensibility route and inject
`window.__FLOVART_AFTER_EFFECTS_BRIDGE__` with `getContext`, `getSelection`,
`materializeLayer` and `importArtifact`. The package uses the same
`CreativeHostAdapter` contract without an After Effects-specific Provider input
type.

The first tracer must be limited to:

```text
selected layer
  -> provider-neutral reference
  -> Flovart Workflow generation
  -> artifact
  -> new footage/layer
```

Expected evidence: package build/install output, panel context changes after a
selection change, canonical input and Provider wire fixture, and a before/after
layer list proving the source layer was not overwritten.
