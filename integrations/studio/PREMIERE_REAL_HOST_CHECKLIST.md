# Premiere real-host certification

Status: `EXTERNAL_GATE` until Premiere Pro 25.6+ and a Link-injected frame/import bridge are available on the test machine.

1. Install `dist-studio/premiere` with the current UXP Developer Tool and dock the `Flovart` panel.
2. Open a project and select a Project Item/clip; capture the panel context changing after selection changes.
3. Verify the selection maps to the shared `creative-host` resource locator.
4. Inject the Flovart Link host bridge, materialize the current frame with a local fixture provider, and click `生成并添加`.
5. Verify the returned artifact is imported into the Project without changing the source clip.

Expected evidence: panel screenshot, UXP console transcript, resource/canonical/wire fixture, and Project item before/after.
