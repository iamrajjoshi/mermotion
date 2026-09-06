# Mermotion agent guide

Mermotion is a local-first editor and engine for adding deterministic motion to standard Mermaid diagrams.

## Read first

- Product scope and milestones: `docs/project.md`
- Current architecture: `docs/architecture/system.md`
- Visual contract: `docs/design/visual-direction.md`
- Active work and proof: `.ai/project/state.md`

## Repository map

- `apps/web`: React and Vite editor
- `packages/engine`: document model, motion language, Mermaid adapter, compiler, sampler, and browser player
- `packages/cli`: non-interactive local CLI
- `fixtures`: Mermaid render/semantic compatibility matrices and motion fixtures
- `.agents/skills/mermotion`: portable authoring and rendered-proof workflow for coding agents
- `e2e`: browser-level product proof

Keep document, language, adapter, compiler, and player boundaries as internal modules in `packages/engine`. Do not create another workspace without a real independent consumer or release boundary.

## Commands

- `pnpm dev`: run the web editor
- `pnpm format`: format supported repository files with Oxfmt
- `pnpm format:check`: check formatting without writes
- `pnpm lint`: run Oxlint
- `pnpm typecheck`: run TypeScript project checks
- `pnpm test`: run unit tests
- `pnpm test:e2e`: run Playwright product tests
- `pnpm build`: build all workspaces
- `pnpm verify`: run the required local gate

## Invariants

- Use pnpm only. Keep `packageManager` and shared versions pinned.
- Oxfmt is the only repository formatter. `.mmd` remains byte-preserving; `.motion` uses the engine-owned formatter.
- Mermaid owns syntax, layout, and theme. Runtime code imports only Mermaid's public package entry point.
- Motion is opt-in. A missing or empty motion source cannot animate or restyle the diagram.
- Playback is a pure function of document plus time. Play and scrub use the same sampler.
- Mermaid source is never silently rewritten by motion commands.
- Project content stays in local files, IndexedDB, or an explicit export. Do not add accounts,
  hosted saves, public share links, collaboration, an application server, or server storage.
- The agent surface is the CLI plus an instructional skill. Do not add MCP or an agent-only syntax.
- Parse, check, and format commands stay browser-free. `mermotion render` owns browser layout behind
  its adapter; do not expose the driver, test runners, or a separate discovery step.
- Use semantic targets, never user-authored DOM selectors.

## Motion source that agents should write

Keep generated `.motion` files inside the small M1 authoring profile:

- Start with `motionDiagram-v1`, followed by at most one `defaults` line.
- Prefer bare Mermaid IDs: `highlight api`, not `highlight node api`.
- Use `highlight`, `pulse`, `trace`, and `move`. Use `at` for an exact timestamp and `with` only when cues must overlap.
- Use `for` on an effect, `over` on a path, and six-digit hex colors.
- Declare a marker as `marker request as "Request"`; `dot` is the implicit shape.
- Describe connections by stable endpoints such as `trace client --> api`. Never write Mermaid-generated SVG IDs such as `L_client_api_0`.
- A unique sequence message may omit `occurrence`. Generated source should keep it explicit, and repeated signatures must use `occurrence 1`, `occurrence 2`, and so on.

The parser retains extra forms for existing files, but agents and UI writers must not invent YAML,
JSON, CSS selectors, keyframe blocks, or new keywords. Run `pnpm build`, then use
`node packages/cli/dist/index.js motion check <diagram.mmd> --json`,
`pnpm mermotion motion fmt <diagram.motion> --check`, and
`node packages/cli/dist/index.js render <diagram.mmd> --check --json` before handing back authored
source. Inspect a sampled SVG or PNG when motion changes; inspect the GIF when animated export
changes.

## Git and proof

Preserve unrelated changes. Stage named paths only. Do not commit, push, publish, or deploy without explicit authority. Every completion claim must include the exact commands and state that were tested.
