# Photoshop real-host certification

Status: `EXTERNAL_GATE` until Photoshop and a Link-injected layer export/import bridge are available on the test machine.

1. Install `dist-studio/photoshop` through the current UXP Developer Tool and dock the `Flovart` panel.
2. Open a PSD, select two different pixel layers, and capture the panel context changing for each layer.
3. Verify `materializeSelection()` returns a `creative-host` locator with the active document and layer IDs; no Provider key is present.
4. Inject the Flovart Link host bridge and click `生成并添加` with a local I2I fixture provider.
5. Record the final canonical input and provider wire payload containing the image reference.
6. Verify a new Photoshop layer is created and the selected source layer remains unchanged.

Expected evidence: panel screenshot, UXP console transcript, canonical/wire fixture, and before/after layer list.
