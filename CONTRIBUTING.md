# Contributing to Mermotion

Read `AGENTS.md`, `docs/project.md`, and `.ai/project/state.md` before changing code. Keep changes inside one observable delivery unit and preserve the boundary between standard Mermaid source and Mermotion's optional motion source.

## Setup

Use Node.js 24.20.0 and pnpm 11.25.0. Install with:

```sh
pnpm install --frozen-lockfile
```

Run `pnpm dev` for the editor. Run `pnpm verify` before requesting review, and run `pnpm test:e2e` for changes to rendering, targeting, playback, persistence, or workbench interaction.

## Code style

Oxfmt is the only repository formatter. Use `pnpm format`, then verify with `pnpm format:check`. Oxlint and strict TypeScript own static analysis. Do not add a second formatter or linter to make an external score pass.

The current `.mmd` fixtures are parser smoke cases for basic flowchart and sequence syntax and must remain byte-preserving. Browser rendering and target compatibility are covered separately by Playwright. Format `.motion` fixtures with `pnpm mermotion motion fmt <file.motion>`.

## Changes

- Prefer a narrow vertical outcome over a layer-only change.
- Add a focused test for new parser, compiler, target, or playback behavior.
- Keep browser-only code outside the pure compiler and sampler.
- Do not depend on Mermaid's unpublished source modules at runtime.
- Record any changed public contract or architecture boundary in the owning document.

Commits and pushes require explicit authorization. When authorized, use the repository's configured commit convention and stage named paths only.
