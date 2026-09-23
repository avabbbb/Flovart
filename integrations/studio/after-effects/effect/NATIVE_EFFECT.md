# Flovart native effect — After Effects slice

Status: **PLANNED / READY FOR REAL SDK PROTOTYPE, NOT CERTIFIED**.

This slice implements the fixed-artifact side of the [creative-host / native-effect design](../../../docs/design/flovart-native-effects.md#8-创作软件宿主与原生效果): prove that an AE effect can persist a durable local media version and render it deterministically before connecting generation.

The sibling CEP panel is a separate Experimental light-panel path. A panel build does not certify this native effect, and a native-effect compile does not certify the panel.

## Product/UI contract

The first effect should feel like a normal After Effects effect, not a miniature Flovart web app.

Use host-native Effect Controls / Timeline behavior wherever possible:

| Control | Behavior | Keyframable | Notes |
| --- | --- | --- | --- |
| Source / Version | Pins a durable local artifact/version | no | Changing it never performs network generation inside render |
| Blend / Mix | Mixes Flovart result with source | yes | Standard host parameter |
| Status | Missing/unreadable/version state | no | Must fail visibly |
| Open in Flovart / New Version | Optional command outside render | no | Only if current SDK/host integration can implement it safely |

Do not duplicate Position, Scale, Mask, Feather, Tracking or generic transform tools that AE already provides.

Only add custom Effect Controls or Composition/Layer UI if standard parameters cannot express the required interaction. Custom UI must use AE SDK event/coordinate callbacks and be tested under zoom, downsample and transformed layers.

## Files

| File | Role |
| --- | --- |
| `FlovartEffect.cpp` | Single-entry-point AE Effect SDK skeleton (`EffectMain`). |
| `FlovartEffect.r` | PiPL resource: name `Flovart Scene Replace`, match name `FLOVART_SceneReplace`. |
| `asset-manifest.json` | Machine-readable parameter/build manifest. |

## Current skeleton parameters

| # | Name | Type | Persisted | Keyframable | Default | Role |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Asset Path | path | yes | no | none | Pinned local media file. This is a prototype representation of Source/Version and must be verified against the real SDK. |
| 2 | Blend | float slider 0–100 % | yes | yes | 100 | Mix intensity: 0 = original frame, 100 = asset. |
| 3 | Version | int slider 1–9999 | yes | no | 1 | Prototype version slot. Durable artifact identity must not depend on this integer alone. |

The production UI may replace `Asset Path + Version` with a safer artifact/version parameter representation after the real SDK prototype. Do not expose an editable raw path merely because the current skeleton stores one.

## Render dataflow

```text
fixed durable artifact/version
  -> decode source frame for current output time
  -> blend over input frame by Mix
  -> return composited frame
```

Hard boundary:

- render performs **no network access, generation call, Agent call or service wait**;
- missing/unreadable media must be visible and must not silently export a wrong frame;
- pixel decode uses a maintained decoder/library rather than a handwritten codec;
- artifact metadata must eventually cover frame rate/time base, color space/transfer, alpha and pixel format.

## Build status

`asset-manifest.json` currently reports `buildStatus: "needs-native-sdk"`. The repository build does not contain an AE SDK/toolchain, so `npm run studio:build` copies the source package instead of producing a certified `.aex`.

When a real toolchain + SDK exist, verify all `SDK-VERIFY` markers against the installed/current Adobe SDK rather than assuming the skeleton signatures are final.

## External Gate

Nothing here certifies After Effects, Premiere Pro, Photoshop or Resolve.

Required real-host evidence is defined in [AFTER_EFFECTS_REAL_HOST_CHECKLIST.md](../../AFTER_EFFECTS_REAL_HOST_CHECKLIST.md), including:

- real SDK compile;
- Effect Controls/Timeline behavior;
- parameter save/reopen;
- keyframes;
- random-frame pixel reference;
- missing/moved artifact handling;
- offline export;
- color/alpha/pixel-format evidence.

Only after those pass should `SUPPORT_MATRIX.md` be upgraded.
