# Project state

- Profile: standard
- Stage: public v0.1.0 implemented through M4
- Completed milestones: M0, reproducible project; M1, animate one diagram; M2, stable semantic
  coverage; M3, animated export and Notion-oriented output; M4, scenes
- Next milestone: none required for v0.1.0
- Approved brief: `docs/project.md`
- Current-system view: `docs/architecture/system.md`
- License: MIT
- Live editor: `https://rajjoshi.me/mermotion/`
- Public repository: `https://github.com/iamrajjoshi/mermotion`
- Open decisions: none blocking v0.1.0

## Settled scope

- Mermotion is a local website, engine, and CLI. Accounts, hosted saves, public share links,
  collaboration, an application server, and server databases are permanent non-goals.
- Agents use the CLI through `.agents/skills/mermotion`. MCP and agent-only syntax are out of scope.
- Mermaid remains the renderer of record. `.mmd` owns structure and theme; optional `.motion` owns
  timing and effects.
- Parse, check, format, compile, and sample stay browser-free. `mermotion render` owns the Chromium
  layout needed for authoritative target binding and sampled SVG/PNG output. Playwright remains an
  implementation dependency, although contributors install its Chromium binary during setup.

## M1 result

### Motion

- `move` defaults to linear travel. One cumulative distance table covers the source center,
  Mermaid's measured connections, intermediate centers, reverse legs, and the destination.
- A named marker keeps one bead, its authored color and label, and two retained full-route tail
  paths. The tails end at the bead; ambient particles, edge wakes, and node-outline clones are gone.
- Tail and trace paint uses normalized route geometry without `non-scaling-stroke`. Widths are
  converted to root user units, which keeps screen size stable without shifting paint after zoom.
- Arrival uses one finite zero-to-peak-to-zero ring. The label lane is chosen from the whole route
  and stays fixed relative to the marker.
- Geometry, target centers, overlay elements, route plans, and source colors are cached. Steady-frame
  checks reject bounding-box rescans and child rebuilding.
- Reduced motion preserves marker position and authored state while hiding the halo, tails, trace
  glow, and arrival ring.

### CLI and agent path

- `mermotion render diagram.mmd --at 1.2s -o frame.svg` renders Mermaid, discovers real semantic
  targets, compiles the optional sibling sidecar, samples the requested time, and writes SVG or PNG.
- `render --check --json` runs the same authoritative path without writing output. Missing or
  ambiguous targets fail with diagnostics before a file is created.
- Each render uses a fresh Chromium context, blocks unexpected network requests, and loads the
  bundled browser renderer. There is no resolver command or browser option in the public interface.
- The portable Mermotion skill preserves ordinary Mermaid, writes only canonical `.motion`, runs
  rendered checks, and requires inspection of a sampled artifact.

### Website authoring

- Source includes `diagram.mmd`, `diagram.motion`, and a non-persisted Syntax reference view. The
  reference searches only canonical M1 forms, copies examples, and inserts complete statements at a
  safe motion-source line boundary. Insertions adapt to semantic IDs from the current preview and do
  not modify Mermaid. Move insertion declares a fresh marker, and stale or failed previews expose no
  insertion targets.
- The three source views use tab and tabpanel semantics with arrow, Home, and End navigation.
  `Cmd/Ctrl+/` and the command palette open Syntax, including from the mobile Source region.

## M2 result

- Semantic bindings for flowchart and sequence diagrams survive changes to labels, declaration
  order, layout, and theme. Missing, renamed, duplicate, and ambiguous targets fail instead of
  binding by visible label or DOM position.
- A sequence-message selector can omit `occurrence` only when its participant and message signature
  is unique. Repeated signatures require one-based occurrences, including `occurrence 1`.
- The Mermaid 11.17.2 compatibility matrix renders 30 user-facing families and 33 syntaxes in both
  Chromium and Firefox. Families without a stable subtarget adapter still support whole-diagram
  motion.
- Dependabot checks the pinned Mermaid release weekly. An upgrade is accepted only after the engine,
  semantic stability, render compatibility, and product browser suites pass.

## M3 result

- The website Export panel produces `checkout.gif` from the current valid Mermaid and motion pair.
  It offers width presets of 640, 960, and 1280 pixels at 10, 20, or 25 fps.
- Playback metadata supports forever, once, or an explicit total play count. Looping exports may add
  a 0.25, 0.5, 1, or 2 second hold on the final frame.
- Sampling, canvas rasterization, and `gifenc` encoding happen in the browser against a sanitized,
  off-screen SVG. Export uploads nothing and does not use the CLI, an application server, a hosted
  project store, or PostgreSQL.
- Animated-bounds sampling fixes one export view box that contains moving labels, tails, markers,
  and effect paint across the whole timeline.
- Exports cap at 600 sampled frames. Tall diagrams keep their aspect ratio and scale down when the
  requested width would exceed the 2,400 pixel encoder height limit. A 120 million pixel-frame
  preflight rejects unsafe dimension, cadence, and duration combinations before canvas allocation.
- **Use 640px · 10fps** sets a Notion-oriented GIF preset. After encoding, the result reports
  whether the local file is under the 5 MB upload target; there is no Notion API integration.
- The CLI writes the full timeline when output ends in `.gif`. It uses the same sampler and one
  isolated Chromium page, with explicit `--loop` and `--hold` playback controls and machine-readable
  frame, dimension, duration, and playback metadata.

## M4 result

- The website holds an ordered scene workspace. Add, rename, duplicate, delete, reorder, and switch
  operate on independent Mermaid and motion source pairs.
- Presentation mode reuses the existing preview and sampler, hides editing chrome, and provides
  previous, next, direct scene, and play or pause controls.
- IndexedDB v2 stores the scene workspace and migrates the original single source pair. The explicit
  `workspace.mermotion.json` download contains every scene plus top-level mirrors of the active pair.
- Browser saves use an IndexedDB revision check, so an older tab cannot overwrite a newer workspace.
  A blocked or failed store leaves the in-memory sources editable and exportable instead of saving
  starter content over the existing record.
- Scene storage, preview, presentation, GIF creation, and source download all stay in the browser.

## Public repository preparation

- `LICENSE` contains the MIT text and every workspace manifest declares MIT.
- Repository and bug metadata point to `iamrajjoshi/mermotion`; homepage metadata points to the live
  editor. The root `@iamrajjoshi/mermotion@0.1.0` package bundles the CLI and portable skill;
  internal workspace packages remain private.
- CI actions are commit-pinned. Dependabot covers npm and GitHub Actions, and the browser job runs the
  CLI renderer before the full product suite.
- Browser concurrency is capped at two because parallel Mermaid startup made Firefox and IndexedDB
  checks flaky on shared runners.

## Latest executable proof

- `pnpm verify`: Oxfmt, Oxlint, dependency boundaries, strict TypeScript, 213 Vitest tests, and every
  workspace build passed. Nine opt-in browser cases were skipped by this Node-only gate.
- `pnpm --filter @mermotion/cli test:render`: nine real-Chromium cases passed for flowchart and
  sequence SVG, PNG, and GIF output, loop metadata, output-scale animated bounds, target failure,
  and inert SVG export.
- `CI=1 pnpm test:e2e`: 142 product tests passed across Chromium and Firefox with two workers. The
  run covered 30 Mermaid families, semantic stability, scenes, presentation, local persistence,
  browser isolation, motion paint, responsive UI, and GIF bytes plus playback metadata.
- `pnpm test:package`: a packed `@iamrajjoshi/mermotion@0.1.0` tarball installed outside the checkout,
  validated source, and rendered an animated SVG with no dependency on the private engine workspace.
- `pnpm audit --audit-level high`: no known vulnerabilities. The portable skill passed the
  `skill-creator` validator, `git diff --check` passed, and the desktop workbench, active motion,
  presentation, and export panel were inspected from a production build.
- Paint-level tests prove each tail is behind its marker and each trace draws the completed portion.
  Route tests cover multi-hop continuity, reverse and repeated legs, exact reseeking, retained DOM,
  arrival endpoints, stable labels, deterministic layer order, hostile Mermaid theme CSS, zoom,
  reduced motion, and a unique sequence message.
- Preview security tests prove the renderer has an opaque origin with no parent-DOM access, recovers
  with a fresh isolated document after a timeout, and prevents form navigation. Remote image syntax,
  HTML image labels, external links, and CSS URLs make no requests while the original Mermaid source
  remains unchanged.
- Persistence tests prove blocked upgrades time out and recover after reload, valid v2 scene names
  survive migration, and a stale second tab cannot overwrite a newer workspace revision.
- Warm-frame browser assertions seek twice after setup and reject bounding-box reads, computed-style
  reads, child-list rebuilding, or more than two screen-transform reads.

## Deliberate limits after local v1

- Semantic subtarget adapters remain limited to flowchart and sequence diagrams; all covered Mermaid
  families can still animate as a whole diagram.
- Repeated parallel flowchart connections remain ambiguous for endpoint-only route selectors. A
  future syntax decision must identify one without exposing Mermaid-generated SVG IDs.
- GIF is the local animated format in v1. Video can be considered after a browser and codec support
  contract is chosen.

The user authorized the public repository, release commit, site deployment, and package publishing.

## Readiness scan note

The required pre-code `@kodus/agent-readiness@0.1.3` baseline and M1-U1 reassessment are historical
structural snapshots. That scanner did not recognize the selected Oxc tools and missed several
present configurations. See `.ai/project/agent-readiness.md` for the recorded results and current
interpretation.
