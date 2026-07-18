# Product model and provider route notes

Flovart separates user-facing product identity from provider execution:

- **Product Model**: the stable model identity shown to users.
- **Generation Mode**: text-to-image, image-to-video, reference-to-video, and similar input/output intent.
- **Provider Route**: the executable provider endpoint bound to a Product Model and mode.
- **Route Capability Schema**: the verified parameters, media roles, limits, and serialization contract for one route.

Agents select Product Models and express generation intent. Provider adapters own route payloads and credentials.

```bash
npm run flovart:cli -- models.list --purpose all --json
npm run flovart:cli -- provider.status --json
npm run flovart:cli -- provider.select-model --image-model flovart:gpt-image-2 --video-model flovart:seedance-2 --json
```

If provider setup is missing, open the browser setup flow:

```bash
npm run flovart:cli -- provider.begin-setup --purpose both --json
```

Never edit provider payloads, route bindings, or secrets through invented agent commands. Confirm every generation argument with `command.schema`.
