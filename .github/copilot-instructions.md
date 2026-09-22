# Flovart Copilot Instructions

Read [AGENTS.md](../AGENTS.md) first. The canonical document map is [docs/index.md](../docs/index.md). If an older report, audit, ADR, plan, or comment conflicts with those files, treat the older text as historical.

## Current product truth

- Top-level surfaces: **Canvas | Table | Agent**.
- Canvas is the spatial Workflow.
- Table is structured media processing with explicit commit back to Workflow/assets.
- Agent is the local/external coding-agent connection hub: discovery, preparation, status and switching.
- Built-in **Assistant / Context / History** is a contextual right drawer beside Canvas/Table. Do not embed it inside Agent and do not put Host connection management in the Assistant drawer.
- Do not restore Production Crew / Director / Operator, Production Skill Marketplace, old Canvas/Art dual state, or enterprise org/credits/approval as mandatory product layers.

## Code boundaries

- Root `App.tsx` composes the Studio surfaces; `components/studio/StudioTopMenu.tsx` owns the visible Canvas/Table/Agent switch.
- Workflow UI/state lives under `components/workflow/`.
- Table lives under `components/table/`.
- Agent connection UI lives under `components/agent/`.
- Shared contextual drawer/chrome lives under `components/studio/`.
- Provider and execution logic stays in `services/`; do not duplicate it in UI or transports.
- Cross-page state uses existing stores; do not add forwarding Manager/Facade/Coordinator layers without a reproduced need.

## Agent integration

The stable baseline operations are `status`, `workflow.inspect`, `workflow.selection.get`, `workflow.apply`, and `workflow.node.run`. CLI + Agent Integration Skill is the default external-agent path; stdio MCP is an optional projection of the same contract.

External agents must not write React/Zustand state, browser storage, Provider private APIs or Runtime databases directly.

## Layout

The current Studio layout is container-driven (#15). Follow [Adaptive Layout](../docs/design/adaptive-layout.md).

Do not restore JS drawer-inset math, fixed structural viewport patches, legacy `rightPanelInset`/`rightInset`, or page-level absolute columns. Canvas coordinate overlays are a separate concern from page composition.

## Build and validation

Use the repository scripts in `package.json`. Match validation to the touched surface; for documentation changes run `npm run docs:check`. Build/mock success is not evidence that a real Provider, coding-agent Host, or Creative Host is certified.

Keep changes narrow, protect existing user changes, and update current-truth docs when a product decision changes.
