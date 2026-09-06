# Contributing to Mermotion

Read `AGENTS.md`, `docs/project.md`, and `.ai/project/state.md` before changing code. Keep changes inside one observable delivery unit and preserve the boundary between standard Mermaid source and Mermotion's optional motion source.

## Setup

Use Node.js 24.20.0 and pnpm 11.25.0. Install with:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium firefox
pnpm mermotion setup
```

Run `pnpm dev` for the editor. Run `pnpm verify` before requesting review, and run `pnpm test:e2e`
for changes to rendering, targeting, playback, persistence, or workbench interaction. Changes to the
CLI renderer or its browser adapter also require `pnpm --filter @mermotion/cli test:render`; changes
that cross both boundaries require both browser gates.

## Code style

Oxfmt is the only repository formatter. Use `pnpm format`, then verify with `pnpm format:check`. Oxlint and strict TypeScript own static analysis. Do not add a second formatter or linter to make an external score pass.

The basic `.mmd` fixtures are byte-preserving parser cases. The render matrix covers all pinned
Mermaid diagram families, while the semantic matrix owns stable flowchart and sequence identities;
Playwright checks both in real browsers. Format `.motion` fixtures with
`pnpm mermotion motion fmt <file.motion>`.

Playwright supplies browser testing and the private driver behind `mermotion render`. Do not expose
it through a public option or add a separate target-discovery command. Plain Node owns parse, check,
and format.

## Changes

- Prefer a narrow vertical outcome over a layer-only change.
- Add a focused test for new parser, compiler, target, or playback behavior.
- Keep browser-only code outside the pure compiler and sampler.
- Do not depend on Mermaid's unpublished source modules at runtime.
- Record any changed public contract or architecture boundary in the owning document.
- Keep Mermotion local. Accounts, hosted projects, public links, an application server, server
  storage, and MCP are permanent non-goals unless the product brief changes first.

Keep commits focused and stage only the paths that belong to the change. Do not push unrelated work.
