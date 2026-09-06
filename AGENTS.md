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
- `fixtures`: current flowchart and sequence parser/motion smoke fixtures
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
- Keep project content local unless the user explicitly exports or publishes it.
- Use semantic targets, never user-authored DOM selectors.

## Motion source that agents should write

Keep generated `.motion` files inside the small M1 authoring profile:

- Start with `motionDiagram-v1`, followed by at most one `defaults` line.
- Prefer bare Mermaid IDs: `highlight api`, not `highlight node api`.
- Use `highlight`, `pulse`, `trace`, and `move`. Use `at` for an exact timestamp and `with` only when cues must overlap.
- Use `for` on an effect, `over` on a path, and six-digit hex colors.
- Declare a marker as `marker request as "Request"`; `dot` is the implicit shape.
- Describe connections by stable endpoints such as `trace client --> api`. Never write Mermaid-generated SVG IDs such as `L_client_api_0`.
- Use the longer sequence-message selector only when sender, receiver, label, and occurrence are needed to identify one rendered message.

The parser retains extra forms for existing files, but agents and UI writers must not invent YAML, JSON, CSS selectors, keyframe blocks, or new keywords. Run `pnpm mermotion motion check <diagram.mmd>` and `pnpm mermotion motion fmt <diagram.motion> --check` before handing back authored source.

## Git and proof

Preserve unrelated changes. Stage named paths only. Do not commit, push, publish, or deploy without explicit authority. Every completion claim must include the exact commands and state that were tested.
