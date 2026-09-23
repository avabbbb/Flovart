# After Effects host certification

Status: `EXTERNAL_GATE`.

There are **two different AE deliverables** and they must be certified independently:

1. `dist-studio/after-effects`: Experimental CEP/ExtendScript light panel;
2. `integrations/studio/after-effects/effect`: planned C++ Effect SDK native effect.

Do not report either one as evidence for the other.

## A. Light panel tracer

The installed After Effects version must still support the chosen CEP/ExtendScript path. Do not infer UXP support from Photoshop/Premiere or from Adobe's general UXP migration direction; verify After Effects' current official host documentation first.

Inject `window.__FLOVART_AFTER_EFFECTS_BRIDGE__` with `getContext`, `getSelection`, `materializeLayer` and `importArtifact`. The panel uses the shared `CreativeHostAdapter` and does not own Provider credentials.

First tracer:

```text
selected layer
  -> provider-neutral reference
  -> Flovart generation path
  -> durable artifact
  -> new footage / new layer
```

Required evidence:

- package install and visible docked/resizable panel;
- context and selection update when the active layer changes;
- canonical input + Provider wire fixture;
- result is **added**, not silently replacing the source;
- before/after layer or Project item list;
- disconnect/reconnect state is actionable and does not expose internal transport details;
- narrow/wide panel resize remains usable.

## B. Native C++ effect tracer

Use the current After Effects C++ Effect SDK and validate against the installed AE release.

The first native effect should stay small:

- fixed durable Source/Version;
- keyframable Blend/Mix;
- explicit missing/unreadable asset status;
- optional command to open Flovart / request a new version **outside** the render callback.

Do not duplicate Position, Scale, Mask, Feather or Tracking controls that AE already owns.

Required evidence:

1. real SDK compile on Windows;
2. effect appears in AE and uses host Effect Controls / Timeline correctly;
3. save → quit → reopen preserves parameters and fixed artifact identity;
4. random-frame rendering matches an independent reference;
5. keyframes behave correctly;
6. missing/moved artifact fails visibly rather than exporting wrong content;
7. offline export completes with no network, Provider or Agent dependency;
8. color depth / alpha / pixel format behavior is recorded for the tested project.

Custom Effect Controls or Composition/Layer UI is only justified when standard host parameters cannot express the interaction. If custom UI is used, verify zoom/downsample/coordinate transforms using the SDK callbacks rather than OS assumptions.

## Evidence wording

Allowed after only package/mock checks:

> After Effects integration package exists and is Experimental; real-host certification remains open.

Do **not** say “AE plugin supported”, “native effect ready”, or “UXP-compatible” without the corresponding real evidence.
