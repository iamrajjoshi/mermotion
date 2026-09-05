# Project state

- Profile: standard
- Stage: M1 implementation and verification
- Active milestone: M1, animate one diagram (in progress)
- Completed milestone: M0, reproducible project
- Completed delivery unit: M1-U1, engine + local web workbench + Node-only CLI + motion polish
- Next delivery unit: M1-U2, sandboxed preview realm + browser-backed CLI target resolution
- Approved brief or PRD: `docs/project.md`
- Current-system view: `docs/architecture/system.md`
- Open decisions and owners: Raj chooses a license before public release; hosting remains deferred to
  M5 and server storage to M6
- Pending research returns: none

## Implemented state

- Standard `.mmd` source remains separate from optional declarative `motionDiagram-v1` source.
- Mermaid 11.17.2 renders in the browser with source-owned frontmatter themes.
- The engine parses, formats, validates, compiles, and deterministically samples motion.
- Named markers now use exact rendered edge geometry in root SVG coordinates, cross node interiors
  without position jumps, and allocate time by measured route distance.
- A named move renders as one screen-sized signal bead with a retained three-layer comet, a
  direction-correct edge wake, a persistent collision-scored callout, node-occupancy outlines, and
  a deterministic 200 ms arrival ring. These layers come from sampled timeline time rather than CSS
  or WAAPI state.
- Traces use a bright core, soft underlay, a small progress tip, and stable cue-based DOM identity.
  Muted Mermaid strokes fall back to a contrast-safe mint; saturated theme colors remain intact.
- The compiler rejects overlapping or discontinuous moves for the same marker. The player keeps
  overlay DOM and geometry caches alive across frames, while React runs one stable playback loop.
- Reduced-motion rendering keeps the semantic marker position while hiding comet, wake, halo, and
  arrival decoration. Transient missing SVG geometry is retried instead of cached as a failure.
- Browser target discovery covers flowchart nodes/edges and sequence participants/messages,
  including repeated-message occurrences and Mermaid arrow semantics.
- Unique sequence-diagram messages now support route-based marker movement and tracing; repeated
  same-direction messages produce an ambiguity diagnostic instead of choosing one silently.
- Mermotion-authored browser source avoids `toSorted`, `toReversed`, and `Array.at`; the web entry
  also supplies guarded `Array.at` and `structuredClone` fallbacks for Mermaid and its dependencies.
- The editor is organized as an animation desk: a 38/62 source and drafting-canvas split above
  separate State, Route, and Signal timeline lanes. It provides selection-to-pulse authoring,
  play/seek, zoom/pan/fit, command palette, responsive tabs, local persistence, and source-bundle
  download.
- Timeline cues are single lane-colored duration clips. Their selected, hover, and keyboard states
  reuse the clip perimeter instead of adding an inner rail, badge, or detached outline.
- The website and agent guide emit a small canonical M1 profile: bare Mermaid IDs, stable endpoint
  routes, implicit-dot markers, one defaults declaration, `for` on target effects, and `over` on
  paths. UI-authored source omits redundant first occurrences and never copies Mermaid-generated
  SVG IDs.
- The parser keeps older forms readable while diagnosing duplicate defaults, timing prefixes on
  statements that cannot use them, and effects without a selector. Formatting removes the legacy
  `shape dot` clause and preserves `over` on route traces.
- Appearance offers four local desk presets and 13 editable interface roles. Its Transport color is
  independent from source-owned Motion Signal, extreme colors get contrast-aware control ink, and
  the modal traps focus while the background is inert.
- Seven common Mermaid color roles are written to standard `config.themeVariables` frontmatter with
  `theme: base`. Mermaid background drives the visible diagram ground while the local Canvas frame
  remains a separate inset surround.
- `defaults color` and cue-level color modifiers live in `.motion`, compile into deterministic
  frames, and paint targets, traces, and retained route markers without changing Mermaid source.
- The CLI validates, checks/formats motion, compiles, and samples with stable JSON envelopes.
  Target-bearing commands are explicitly marked `inferred` and emit
  `CLI_TARGETS_NOT_VERIFIED` until M1-U2.

## Latest executable proof

- `npx --yes pnpm@11.25.0 install --frozen-lockfile`: passed from the locked dependency state.
- `pnpm verify`: formatting, Oxlint, dependency boundaries, strict TypeScript, 91 Vitest
  tests, and all workspace builds passed.
- `CI=1 pnpm test:e2e` and a final `PLAYWRIGHT_REUSE_SERVER=1 pnpm test:e2e`: the production build
  passed 76 product tests across Chromium and Firefox, including screen-space
  marker/edge agreement, reverse and repeated routes, persistent collision-checked labels, aligned
  traces, retained overlay identity, byte-identical reseeking, arrival phases, reduced motion,
  sequence-message movement and tracing, repeated-edge traces, missing-native compatibility,
  content-sized timelines, themes, click-to-author,
  deterministic seeking, invalid-source retention, local draft restoration, repeated sequence
  messages, command palette, mobile regions, appearance persistence, declarative Mermaid and motion
  color writes, preview-ground and canvas-frame ownership, transport/signal isolation, modal focus
  containment, and preset contrast.
- `pnpm audit --audit-level high`: no known vulnerabilities found.
- CLI smoke: validate/check/format-check/compile/sample all exited 0; target-bearing JSON carried
  the expected warning, and the Mermaid source SHA-256 remained
  `c7c9f54fb517338b2524e631b1b7f881f5d77fdc3805d58ed5c817bb5686c09d`.
- Fresh-agent canary: independently found setup/check commands, explained the source/engine/web/CLI
  boundaries, authored a valid node pulse, and identified CLI rendered-target truth as the next gap.
- Graphite desktop, the full Appearance sheet, source-owned color controls, Paper/Midnight, mobile
  layouts, and the revised timeline clips were captured from the production build and visually
  inspected. The current workbench still is committed at `docs/assets/mermotion-workbench.png`.
- The polished starter was scrubbed and played in the production build; the exact legacy starter in
  IndexedDB migrates without replacing edited drafts.

## Readiness scan

The required pre-code `@kodus/agent-readiness@0.1.3` baseline ran against the empty repository.
The post-U1 scan recognized 7 of 8 checks toward Level 2 but remained Level 1 because that version
does not recognize the selected Oxc tools and missed several present configurations. See
`.ai/project/agent-readiness.md` for the exact false negatives and intentional omissions.

## Known gaps

- Preview SVG currently lives in the application document under Mermaid strict security; sandboxed
  iframe rendering and a typed bridge remain M1-U2.
- CLI target keys are inferred without rendering; an opt-in Playwright target resolver remains M1-U2.
- Browser compatibility proof covers current Chromium and Firefox; the wider supported-browser
  matrix belongs to M2. M2-U1 also owns same-direction sequence-message disambiguation and authored
  node dwell timing.
- The production build reports large Mermaid-related chunks; M2 owns an initial-load budget rather
  than treating that warning as an M1 correctness blocker.
- GIF/video/static rendered export, Notion integration, stories, sharing, accounts, MCP, server, and
  PostgreSQL remain later or conditional milestones.

## Next gate

M1-U2 must prove isolated browser rendering, real CLI target inventory for flowchart and sequence
fixtures, failure on missing/ambiguous CLI targets, a shipped browser bridge, and unchanged
browser-free syntax/format commands before M1 is called complete.
