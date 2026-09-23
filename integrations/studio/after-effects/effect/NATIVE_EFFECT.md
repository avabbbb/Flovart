# Flovart native effect — After Effects slice

This is the fixed-media source slice from the [main design](../../../docs/design/flovart-native-effects.md) §5.2. A generated artifact is first imported as a candidate footage layer. The user then explicitly applies that candidate to the source layer captured when generation started.

The CEP panel and native effect are separate packages. The panel is not itself a native effect.

## Files

| File | Role |
| --- | --- |
| `FlovartEffect.cpp` | AE Effect SDK entry point; exports only `EffectMain`, reads the selected footage layer at the current frame, and blends it with the effect input. |
| `FlovartEffect.r` | PiPL resource: display name `Flovart Scene Replace`, match name `FLOVART_SceneReplace`. |
| `asset-manifest.json` | Parameter and dataflow contract copied into the Studio package. |
| `../host.jsx` | Imports a candidate into the captured composition and applies or updates the effect on the captured source layer. |

## Persisted host state

The `Asset Version` control is a native `PF_Param_LAYER`. It references an imported footage layer, so the AEP owns the layer selection and path reference; the media bytes currently remain in CEP `USER_DATA`. The candidate layer is initially disabled so it cannot change the composition before the user applies it; whether AE still checks out disabled footage must be confirmed at the host gate. Reapplying V2 changes only this parameter; it keeps the effect instance, Blend keyframes, and the prior footage layer for undo/relink.

`PF_Param_PATH` is an AE mask-path parameter. It does not store an arbitrary filesystem path. The effect therefore does not parse paths, open files, decode media, or use a custom file cache in its render callback. AE checks out the selected layer at the requested frame and owns its media decode/relink behavior.

The Studio Workflow handoff computes SHA-256 over the generated Blob in 1 MiB chunks. The CEP bridge writes the candidate under CEP `USER_DATA` using `flovart-asset-<artifactId>-sha256-<digest>.<ext>` and stores a JSON version manifest in the imported layer comment: Workflow artifact ID, provider task ID when present, checksum, byte size, MIME type, media kind, name, prompt/model when available, artifact dimensions/duration, and the captured composition/layer IDs. After import, ExtendScript also records the footage dimensions, duration, frame rate, frame duration, pixel aspect ratio, alpha interpretation, and the active project's color-processing settings when the host exposes them. These are snapshots of AE's interpretation and project context; they do not identify an embedded source color profile or authoritative container frame count. The Workflow result sent back through the command surface remains an opaque artifact identity; these details stay in the local Studio registry and host project. When the panel's candidate tab opens, it reads comments from the bound composition and restores available candidates for reapplication. The manifest is provenance metadata; it is not read or verified by the render callback. These source changes do not yet package media with the project, implement relinking, or prove that the host preserves the path across project moves.

Reference capture freezes the selected composition, layer, and `Layer.time`, then copies that layer into a one-frame temporary composition. It requests a PNG Alpha output and temporarily unqueues only existing Render Queue items whose status is `QUEUED`, restoring their prior render flags during cleanup. The temporary composition may omit parent, camera, track-matte, or cross-layer effect dependencies; exact frame output, output naming, queue restoration, and whether add/remove marks the project dirty still require host validation.

The effect currently exposes the host layer reference and a keyframeable `Blend` slider. The CEP apply action refuses projects that are not 8 bpc because the render callback uses `PF_Pixel8`; changing an already-effected project to 16/32 bpc and render-error visibility still require real-host validation. When input and footage dimensions differ, the source resamples at pixel centers with bilinear interpolation before mixing all four channels. Render rejects missing callback parameters and NaN Blend values; before pixel access it checks positive world dimensions, positive rowbytes, the minimum bytes per row, and addressable final-row offsets, then obtains each pixel pointer through `PF_GET_PIXEL_DATA8`. These checks validate the `PF_EffectWorld` metadata, not the host allocation's true byte length, and remain uncompiled against the AE SDK. A failed layer checkout or a world without pixels returns a render error; it does not silently pass through the source and report a successful frame. A valid black or fully transparent frame is still valid media. The candidate list checks the source file and recorded byte size, and the apply action refuses to use a missing or size-mismatched file; relocation/relinking, disk hash verification, and render-log behavior remain real-host gates. Its only render dependencies are the current input frame, the selected footage frame, and the Blend value. The source advertises pixel independence only; it does not set `PF_OutFlag_USE_OUTPUT_EXTENT` because the render callback does not yet account for `in_data->extent_hint` and output-origin offsets. It also does not declare Multi-Frame Rendering support until re-entrancy and concurrent render behavior pass the real-host test.

## Build status

`asset-manifest.json` reports `buildStatus: "needs-native-sdk"`. This machine has no After Effects installation, AE SDK path, MSVC `cl`, `MSBuild`, CMake, or `clang-cl` on `PATH`. The Studio package build can copy source files, but it cannot produce an `.aex` here.

The Adobe SDK's Windows sample projects generate PiPL resources through their supplied resource toolchain. Do not substitute an ad hoc `.rc` resource or mark this source compiled until it has been built against an operator-provided SDK version and loaded by a real AE installation.

## External Gate

This source change is not a host certification. Required evidence:

1. Compile the effect against the Windows AE Effect SDK; verify declarations, PiPL, exported `EffectMain` symbol, and SDK version. The source uses the platform export annotation directly; the final build must still confirm the symbol table.
2. From CEP, import a generated artifact as a candidate, apply it to the exact captured composition/layer, and verify no fallback to the current selection occurs if the target disappears.
3. Verify Blend 0/50/100, keyframed Blend, alpha behavior, different footage dimensions, padded rowbytes, invalid/overflowing world metadata, NaN Blend rejection, cropped layers, masks, upstream buffer/origin changes, and pixel output against an independent 8-bit SDR reference. Do not enable output-extent handling until the clipped extent and output-origin cases pass.
4. Verify a cleared `Asset Version` parameter produces a render error while a valid black/transparent frame remains valid media.
5. Apply V1 then V2, undo/redo, save, close, and reopen the project. Confirm V1 remains available and V2 remains the applied layer.
6. Stop Flovart and disconnect the network, then preview and export. Missing footage must remain visible in the render log and must not be exported as a successful replacement.
7. Stress random-seek and concurrent frame requests with MFR enabled in AE. Set the MFR flag in PiPL and source only after the test passes.
8. Collect the project into another folder, reopen it, and verify the content-addressed CEP asset remains available; then move the asset and verify missing-footage detection and relink behavior.
9. Verify effect compatibility with the declared Premiere version separately; AE SDK compatibility does not certify PR behavior.
