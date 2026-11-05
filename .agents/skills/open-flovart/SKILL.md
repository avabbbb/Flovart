---
name: open-flovart
description: Open Flovart and make it ready for the user's Workflow task. Use when the user asks to open, start or prepare Flovart.
---

# Open Flovart

This is the entry point only. All Workflow work follows the `flovart` Skill;
read it before the first write.

1. Run `flovart ensure --json` (in this source checkout, when the packaged
   command is not installed: `npm run flovart:cli -- ensure --json`). Never
   fall back to `npx flovart-cli`.
2. Continue only when it returns `ok: true` and `state: "ready"`. Otherwise
   tell the user the public state and error action it returned and stop. Do
   not guess a port, read local config, or open a URL by hand.
3. Confirm you are on the user's canvas:
   `flovart status --json`, then
   `flovart workflow.inspect --agent-identity <host> --json` with your host's
   identity (`codex`, `claude-code`, `opencode`, `workbuddy`). Use the same
   identity on every later write; without it writes fail with
   `AGENT_HOST_REQUIRED`.
4. Continue with "Prepare for this job" in the `flovart` Skill.

Never open the WebUI in your own or a headless browser, read Agent
configuration or private Runtime files, call a Provider directly, write
browser storage, or configure an MCP server yourself. The optional MCP
projection is described in the `flovart` Skill's `references/hosts.md`.
