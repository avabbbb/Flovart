# Iris brand migration

Status: active public-brand migration.

## Decision

The public product name is now **Iris**.

Iris is positioned as an open-source, local-first **AI creative layer for professional editing tools**, starting with DaVinci Resolve Studio 21.1. The full Canvas/Table/Agent workspace remains part of the product, but the canvas is a power surface rather than the product premise.

## Compatibility boundary

This migration intentionally separates **brand names** from **technical identifiers**.

### Change now

Use **Iris** in:

- README and website copy;
- browser/app titles;
- host-panel labels;
- screenshots and future demo captions;
- public product descriptions;
- new product-design prose.

### Keep for compatibility

Keep `flovart` for now in:

- CLI commands such as `npm run flovart:cli`;
- package names and package scopes;
- `.agents/skills/flovart/` and mirrored Skill paths;
- `tools/flovart/`;
- internal event names and globals;
- CSS/data attributes;
- repository URL `avabbbb/Flovart` until a separate repository-rename step is approved.

Do not mass search-and-replace these identifiers.

## Future migration order

1. Public brand cutover — **this phase**.
2. Add new Iris aliases for CLI/package/Skill entry points while preserving `flovart` compatibility.
3. Update automation, documentation, release assets and external integrations to consume the Iris aliases.
4. Rename the GitHub repository only after Pages, Actions, badges, external links and local remotes have an explicit migration plan.
5. Deprecate legacy `flovart` identifiers only after a compatibility window and real-user migration evidence.

## Positioning

Preferred short description:

> **AI creative agents inside the tools you already use — starting with DaVinci Resolve.**

Preferred technical description:

> **Iris is an open-source, local-first AI creative layer for professional editing tools.**

The current Resolve integration remains Experimental until the native MCP → durable candidate → Media Pool real-host gate passes. Do not turn the rebrand into a support-status upgrade.
