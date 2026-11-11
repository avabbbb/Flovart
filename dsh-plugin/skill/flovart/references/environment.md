# Readiness: four layers

A Flovart task is ready only when all four layers hold, checked in this order.
Never check a lower layer before the one above it passes, and never tell the
user something is ready that you have not checked in this session.

| Layer | How to check | Ready when | If not |
| --- | --- | --- | --- |
| 1. Flovart is running | `flovart ensure --json` | `ok: true`, `state: "ready"` | Report the public state and error action it returned. Do not guess a port, read local config, or open a URL by hand. |
| 2. You are on the user's canvas | `flovart status --json`, then `flovart workflow.inspect --agent-identity <host> --json` | The user's tab is connected, no leftover agent tab, and the project title, node titles and node count match what the user sees | Close any agent-opened tab. Reopen with `flovart ensure` (or `web.open`), then inspect again. Never write until this matches. |
| 3. The needed AI service is set up | `flovart provider.status --json` | The route the task needs is listed (see `providers.md`) and `ready` is true | Tell the user which service to add and where (`providers.md`). Wait for them, then check again. |
| 4. The user agreed to the cost | Ask in the conversation | The user said yes to the run count, model and purpose you named | Do not run. Offer a cheaper option only if one exists. |

Layer 3 applies only to tasks that generate. Editing nodes, layout and
prompts needs layers 1 and 2 only. Layer 4 applies to every paid run,
including reruns.

## Reading `provider.status`

- When the local Runtime is up, the result comes from it.
- When the Runtime is offline, the CLI falls back to the local Agent's
  credential mirror and returns `source: "agent-vault"` with
  `mirrorOf: "browser-settings"`. That mirror is filled from browser Settings,
  so it shows what the user has added there.
- The result never contains a key: only provider names, counts and masked
  values. Do not try to get more.
- `keyring.available: false` means this computer cannot store keys securely;
  report it, do not work around it.

## `doctor`

`flovart doctor --json` summarizes the same layers for a person debugging a
setup. Its `nextSteps` are written for the user and can be passed on as they
are. Use the four checks above for task work; doctor is for diagnosis.
