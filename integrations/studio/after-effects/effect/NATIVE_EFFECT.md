# Flovart native effect — After Effects slice

Milestone 1 of the [main design](../../../docs/design/flovart-native-effects.md) §5.2:
prove host integration with a **fixed local asset** before any generation call.
The panel package (`../`, CEP) is unchanged — a panel is not a native effect.

## Files

| File | Role |
| --- | --- |
| `FlovartEffect.cpp` | Single-entry-point AE Effect SDK skeleton (`EffectMain`). |
| `FlovartEffect.r` | PiPL resource: name `Flovart Scene Replace`, match name `FLOVART_SceneReplace`. |
| `asset-manifest.json` | Machine-readable parameter manifest, also copied into the build output and stamped by `studio:build`. |

## Parameter manifest

| # | Name | Type | Persisted | Keyframable | Default | Role |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Asset Path | path | yes | no | none | Pinned local media file this instance renders. Written by the generation pipeline; the render path only reads it. |
| 2 | Blend | float slider 0–100 % | yes | yes | 100 | Mix intensity: 0 = original frame, 100 = asset. |
| 3 | Version | int slider 1–9999 | yes | no | 1 | Applied asset-version slot (V1, V2, …). Full version ids arrive with the generation pipeline. |

## Dataflow

```text
Asset Path (pinned local file — the only file read in the render path)
  -> decode source frame for the current integer output frame
  -> blend over the input frame by Blend percent
  -> return composited frame
```

- The render path performs **no network access, no generation calls, and no
  dependency on an agent, browser, or service being online** (main design §4.3).
- A missing or undecoded asset passes the input frame through unchanged and
  raises `PF_OutFlag_DISPLAY_ERROR_MESSAGE` — it never silently exports wrong
  content (main design §3.3).
- Pixel decode is not hand-rolled. The decoder library (OpenImageIO is the
  candidate) and pixel format are locked at the real-SDK prototype; until then
  `FLOVART_HAS_ASSET_DECODER` is undefined and the asset reports as missing.
- Position, scale, mask, feather and keyframes stay on host-native controls;
  this effect deliberately adds no transform/keying/tracking editor.

## Build status

`asset-manifest.json` reports `buildStatus: "needs-native-sdk"`. There is no
AE Effect SDK or C++ toolchain on this build machine, so `npm run studio:build`
copies the source package and marks it in the build log instead of producing an
`.aex`. When a toolchain + SDK exist, set `FLOVART_AE_SDK_ROOT` (and
`FLOVART_AE_EFFECT_CL` for the compiler if it is not on `PATH`) and rebuild.

## External Gate — required before claiming host support

This code is **ready for compile, not certified**. Nothing here certifies AE,
PR, PS, or Resolve. Required real-host evidence:

1. **Real AE SDK compile** — build `FlovartEffect.cpp` + `FlovartEffect.r`
   against the Adobe AE Effect SDK on Windows; verify every `SDK-VERIFY` mark
   (path-param suite/signature, `PF_Param_PATH` naming, PiPL flag values).
2. **Parameter save/reopen** — apply the effect to a layer, set all three
   parameters, save the project, quit AE, reopen, and confirm the values
   persist exactly.
3. **Random-frame render** — scrub to arbitrary frames (not just frame 0) and
   compare output pixels against an independently computed reference
   (8-bit SDR, ≤1 per channel); confirm no wrong-frame or black-alpha output.
4. **Offline export** — unplug the network, render/export the composition, and
   verify the output is produced with zero generation requests and no missing
   asset silently exported.
