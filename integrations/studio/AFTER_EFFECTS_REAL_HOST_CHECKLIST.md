# After Effects host certification

Status: `EXTERNAL_GATE`. The workspace contains a CEP panel and an uncompiled
AE Effect SDK source prototype. Neither package build output nor source presence
certifies a native effect. The current development machine has no detected AE
installation, AE SDK path, or Windows C++ build toolchain.

## Package and target binding

- Record Windows, After Effects 22.0 or newer, CEP, AE Effect SDK, and compiler
  versions. Exact document/layer binding uses the persistent `Item.id` and
  `Layer.id` scripting APIs introduced in AE 22.0.
- Build and install `dist-studio/after-effects`; verify the CEP panel loads in
  the declared After Effects version.
- Confirm selection changes update the panel context. Generate from layer A,
  switch to layer B while generation runs, and prove the candidate is imported
  into A's captured composition. If A or its composition disappears, import
  must fail visibly and must not fall back to the active composition/layer.
- Set the playhead to a known source frame and keep another item queued in the
  Render Queue. Confirm reference materialization uses the captured frame,
  writes exactly one PNG with alpha, restores the queued item's render state
  without re-queuing completed/unqueueable items, and leaves no temporary comp
  or queue item behind. Confirm a
  missing PNG-alpha output template fails visibly. Repeat with a nonzero
  composition start time and a selected layer that has a parent, track matte,
  camera, or layer-dependent effect; confirm the isolated reference preserves
  the expected pixels or record which source configurations must be rejected.
- Confirm the imported candidate layer starts disabled so it cannot alter the
  composition before the explicit apply action; verify the native layer
  parameter can still read its footage when disabled.
- Move or rename a candidate file. Confirm the candidate tab reports the
  missing source after its refresh action, refuses to apply it, and AE reports
  an already-applied missing source as a render failure. Relocation/relinking
  still needs a content-hash verification path before it can be implemented.
- Inspect a candidate's CEP `USER_DATA` filename and layer-comment manifest.
  Confirm artifact ID, SHA-256, byte size, provider task ID when present, and
  dimensions/duration match the generated Blob. Compare the stored AE footage
  interpretation (frame rate, frame duration, pixel aspect, alpha mode) and
  project color context (working space, gamma, bit depth, linear settings) with
  the host UI, and confirm the candidate row displays those values. These are
  AE interpretation/context snapshots, not proof of the file's embedded color
  profile or authoritative frame count. Ensure no provider key or other
  credential is stored. The checksum currently identifies the source Blob;
  persisted-file readback verification remains unimplemented.
- Confirm the panel refuses to apply the effect in 16/32 bpc projects. Apply it
  in an 8 bpc project, change the project depth, then verify the existing effect
  either renders a visible error or is otherwise blocked; that post-apply depth
  change is not handled by the current CEP guard.
- Close and reopen the panel with the same composition active. Open the
  candidate tab and confirm it restores each saved candidate and its original
  source layer binding from the layer comments.
- Switch to a different composition while the panel stays open. Confirm the
  candidate list and the one-click apply action only show entries bound to the
  active composition; switch back and confirm its saved candidates return.
  Triggering an apply from a stale captured entry after switching must fail
  without modifying either composition.
- Verify the independent **Apply as Scene Replace** action targets A and does
  not modify B. Inspect the composition before/after and verify the original
  footage remains available.

## Native effect

- Compile `effect/FlovartEffect.cpp` and `effect/FlovartEffect.r` with the
  operator-provided Windows AE SDK and its PiPL resource toolchain. Verify the
  exported entry point, PiPL flags, match name, and parameter names against the
  compiled plugin loaded by After Effects.
- On synthetic 8-bit SDR input, compare Blend 0/50/100 against an independent
  reference. Cover pixel-center bilinear samples for equal, upscaled, and
  downscaled source dimensions, alpha, padded rowbytes, random
  frame order, malformed world dimensions/rowbytes, NaN Blend, cropped layers,
  masks, upstream buffer/origin changes, and missing footage/error display.
  Verify a valid all-black or fully transparent frame is still rendered as
  media. Record unsupported project bit depths explicitly. The source does not
  request `PF_OutFlag_USE_OUTPUT_EXTENT`; only add it after the effect correctly
  handles clipped extents and output origins.
- The source currently does not declare Multi-Frame Rendering support. Stress
  re-entrant and concurrent frame requests with MFR enabled before setting the
  threaded-rendering flag in both PiPL and source; record per-frame differences
  and crashes/hangs.
- Apply V1 then V2, keyframe Blend, undo/redo, save, close, and reopen. Confirm
  the selected version and host keyframes persist and both candidate footages
  remain available.
- With Flovart and the network stopped, preview and export. Collect the project
  to another folder, reopen it, and verify every applied footage reference;
  separately move/relink a source asset and confirm missing media cannot be
  mistaken for a successful render.
- Confirm a project reopened on the same machine resolves its CEP `USER_DATA`
  candidate. Until project collection and relinking are implemented and tested,
  do not assume the layer-comment manifest makes the media portable.
- Verify Premiere compatibility independently for the exact Premiere and AE
  versions; sharing source or SDK lineage is not compatibility evidence.

The CEP bridge still depends on the existing Browser-bound Workflow generation
path. Source code now records a version manifest and Blob checksum, but this
slice does not certify independent plugin generation, project-portable media
versions, relinking, disk-file checksum readback, video time mapping, or masks.
