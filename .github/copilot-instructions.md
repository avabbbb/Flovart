# Flovart Copilot Instructions

Read [AGENTS.md](../AGENTS.md) first. The canonical document map is [docs/index.md](../docs/index.md). If an older report, audit, ADR, plan, or comment conflicts with those files, treat the older text as historical.

## Current product truth

- Top-level surfaces: Canvas | Reverse (逆向) | Agent. The old Table view has been removed.
- Canvas owns GenAI generation and the base Workflow: nodes, generation tasks, assets, versions.
- Reverse is the all-in-one assistant: a prompt-first workspace where a strong model operates the computer and the canvas as tools, with labeled multi-agent cursors, a docked trace/plan/approval panel, and review rounds as versions. The Hypit-style reverse breakdown is one of its tools/panels. It writes to Canvas only through the same `workflow.*` commands. It is not a chat-only page.
- Agent manages agent connections and state: runtimes, models/providers, external agents (Codex, Claude Code, DSH), health and per-agent status. It supplies the agents and models Reverse runs; no chat, no run editing.
- The Canvas Assistant drawer is a lightweight contextual entry that hands multi-step work off to the same run in Reverse. Do not embed it inside Agent and do not put Host connection management in it.
- Visual tokens live in [DESIGN.md](../docs/design/DESIGN.md); interaction behavior in [01-interaction.md](../docs/design/01-interaction.md). Glass only on floating chrome. Check references (Inspora, Awwwards, GSAP Showcase, Refero) before UI/motion work and cite them in the PR.
- Do not restore Production Crew / Director / Operator, Production Skill Marketplace, old Canvas/Art dual state, or enterprise org/credits/approval as mandatory product layers.

## Code boundaries

- Root App.tsx composes the Studio surfaces; components/studio/StudioTopMenu.tsx owns the visible Canvas/Reverse/Agent switch.
- Workflow UI/state lives under `components/workflow/`.
- Reverse UI lives under components/reverse/; Reverse logic lives under services/reverse/.
- Agent connection UI lives under `components/agent/`.
- Shared contextual drawer/chrome lives under `components/studio/`.
- Provider and execution logic stays in `services/`; do not duplicate it in UI or transports.
- Cross-page state uses existing stores; do not add forwarding Manager/Facade/Coordinator layers without a reproduced need.

## Agent integration

The stable baseline operations are `status`, `workflow.inspect`, `workflow.selection.get`, `workflow.apply`, and `workflow.node.run`. CLI + Agent Integration Skill is the default external-agent path; stdio MCP is an optional projection of the same contract.

External agents must not write React/Zustand state, browser storage, Provider private APIs or Runtime databases directly.

## Layout

The current Studio layout is container-driven (#15). Follow the layout section of [Interaction Design](../docs/design/01-interaction.md).

Do not restore JS drawer-inset math, fixed structural viewport patches, legacy `rightPanelInset`/`rightInset`, or page-level absolute columns. Canvas coordinate overlays are a separate concern from page composition.

## Build and validation

Use the repository scripts in `package.json`. Match validation to the touched surface; for documentation changes run `npm run docs:check`. Build/mock success is not evidence that a real Provider, coding-agent Host, or Creative Host is certified.

Keep changes narrow, protect existing user changes, and update current-truth docs when a product decision changes.
