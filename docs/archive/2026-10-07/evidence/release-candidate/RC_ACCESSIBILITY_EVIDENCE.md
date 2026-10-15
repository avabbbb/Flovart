# RC8 Accessibility Evidence

## Real browser smoke

- Target: `http://127.0.0.1:37522/`
- Browser: visible Chromium, isolated context
- Console/page errors: 0
- Screenshot: `C:\tmp\flovart-rc8-a11y-final.png`

Measured results:

- 31 visible buttons/links/inputs/selects/textareas inspected; unnamed controls: 0
- 36 sequential Tab stops inspected; 36 were visible and 35 had an explicit focus indicator (the remaining stop was the document body)
- Shortcut dialog: opened and closed with Escape
- Canvas tools menu: opened and closed with Escape
- Zoom menu: opened and closed with Escape
- Add-node menu: opened and closed with Escape after its exit animation settled
- Settings dialog: `role=dialog`, `aria-modal=true`, labelled by its heading, close button present
- Settings dialog initial focus was inside; 18 subsequent Tab presses stayed inside the dialog
- Settings dialog closed with Escape
- Default UI exposed none of the checked implementation terms (`ProviderAdapter`, `CredentialRef`, `CanonicalGenerationInput`, `mutationId`, `clientId`, `NativeWorkspace`, `serializer`, `runtime surface`)

The Canvas itself remains pointer-oriented. Node deletion is keyboard-accessible through the existing Delete command and layer/inspector controls; freeform drag remains a spatial interaction and is not claimed as a complete keyboard equivalent.
