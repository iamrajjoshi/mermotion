# Mermotion project brief

## Product outcome

A developer or technical writer can paste or type a Mermaid diagram, add motion visually or in a
small declarative language, inspect any point on the timeline, and keep the Mermaid source portable.
Coding agents use the same pair of files through a local CLI. The website and CLI share one parser,
compiler, sampler, and browser player.

## Authoring contract

`diagram.mmd` is standard Mermaid and owns structure, layout, configuration, and theme.
`diagram.motion` starts with `motionDiagram-v1` and owns timing, effects, routes, marker names, and
motion color. The website presents them as one document and can write a motion statement from a
selected rendered element; hand-editing the sidecar remains quick.

Diagram color edits write Mermaid's `config.themeVariables` frontmatter with `theme: base`. The
frontmatter background supplies the diagram ground. Graphite, Blueprint, Paper, and Midnight are
local desk settings stored in IndexedDB, so they never leak into either source file.

## Product boundary

Mermotion is a local engine, website, and CLI. It will not add accounts, hosted saves, public share
links, collaboration, an application server, or a server database. PostgreSQL has no role in the
product. An agent skill may teach the CLI workflow, but an MCP server would duplicate that surface
and is out of scope.

The CLI's parse, check, format, compile, and sample work stays in plain Node. Faithful diagram
rendering needs real browser layout, so `mermotion render` manages Chromium internally. Playwright
supplies the renderer driver and repository browser tests, and contributors install its Chromium
binary during setup. Mermotion exposes neither a browser selector nor a separate target-discovery
command.

Mermotion uses the [MIT License](../LICENSE).

## Milestone plan

| Milestone                    | Status   | Outcome and exit gate                                                                                                                                                          |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0: Reproducible project     | Complete | A fresh contributor or agent can install, run, check, and understand the repository from its instructions.                                                                     |
| M1: Animate one diagram      | Complete | A flowchart or sequence diagram can be authored locally, animated without visible jumps or unstable labels, and rendered as a sampled SVG or PNG through the CLI.              |
| M2: Stable semantic coverage | Complete | Motion survives ordinary Mermaid edits and supported Mermaid upgrades across the fixture matrix. Deleted, renamed, or ambiguous semantic references fail instead of rebinding. |
| M3: Animated export + Notion | Complete | The website and CLI export animated GIFs locally, with explicit playback metadata and a tested Notion-oriented preset and size report.                                         |
| M4: Scenes                   | Complete | An author can arrange several diagram states into a multi-step sequence, preview it as a presentation, and return to editing without source loss.                              |

These milestones define the local v1. Video and new per-family semantic adapters are optional later
work, not unfinished v1 gates.

## M1 delivery units

### M1-U1: Local authoring and deterministic playback — implemented

The current slice renders themed flowcharts and sequence diagrams, inventories semantic elements in
the browser, parses and samples declarative motion, plays and scrubs through the same sampler, writes
a cue from a selected element, retains local drafts and appearance settings, and exposes a
searchable in-app reference for canonical syntax. Reference statements can be copied or inserted at
a safe line boundary in `diagram.motion`; insertion uses semantic IDs from the current rendered
inventory, and the view is not a stored third file. The current Node CLI uses the same language.
Browser-free compile and sample inspect timeline state; the render command performs the actual SVG
binding check.

### M1-U2: Motion clarity and frame performance — implemented

- Movement is linear by default and measured across the complete rendered route, including bends,
  intermediate nodes, reverse legs, and repeated legs.
- One retained marker bead carries its authored identity and color. Two bounded tails end at the
  bead; there are no ambient particles, edge wakes, or node-occupancy clones.
- Arrival uses one zero-to-peak-to-zero ring. Callout placement is chosen from the whole route and
  stays fixed relative to the marker while it moves.
- Trace progress and marker tails share root SVG coordinates. Paint-level browser assertions guard
  against a trail appearing ahead of its marker or a trace drawing the wrong section after zoom.
- Geometry and overlay elements are cached. Warm-frame tests reject bounding-box rescans and child
  rebuilding; Chromium and Firefox checks cover exact reseeking, reverse/cyclic routes, zoom, and
  reduced motion.

### M1-U3: One-command sampled rendering — implemented

- `mermotion render diagram.mmd --at 1.2s -o frame.svg` reads an optional same-name `.motion`
  sidecar, renders Mermaid, discovers the actual semantic SVG inventory, compiles, samples, and
  writes one exact frame. A `.png` output path selects PNG.
- `render --check --json` runs the same path without writing an artifact. Missing or ambiguous
  references return stable diagnostics and never create the requested output.
- Each render uses a sandboxed Chromium process and a fresh browser context with unexpected network
  requests blocked. Setup, rendering, and cleanup have bounded deadlines, and exported SVG is
  stripped of active external resources. The browser mechanism remains behind the command, while
  parse, check, format, compile, and sample retain their plain-Node paths.
- Real-browser integration tests cover animated flowchart SVG/PNG, sequence participants/messages,
  and target failure.

## M2 result: Mermaid compatibility

- Flowchart and sequence bindings survive label, declaration-order, layout, and theme changes.
  Deleted, renamed, duplicate, or ambiguous references produce errors instead of binding by label
  or DOM order.
- A sequence-message selector may omit `occurrence` only while its signature is unique. Repeated
  messages require explicit one-based occurrences, including `occurrence 1`.
- Dependabot checks the exact Mermaid pin each week. Every update runs the semantic matrix and a
  30-family, 33-syntax render matrix in Chromium and Firefox. Mermotion uses whole-diagram motion
  for families that don't yet have stable subtarget identity rules.

## M3 result: local animated export

### Website GIF export

- The Export panel samples the current valid Mermaid and motion pair into an animated GIF. Available
  width presets are 640, 960, and 1280 pixels; frame rates are 10, 20, and 25 fps.
- Playback can run once, loop forever, or stop after an explicit total number of plays. Looping
  exports may add a 0.25, 0.5, 1, or 2 second hold on the final frame.
- The website copies the sanitized rendered SVG into an off-screen host, applies the shared sampler
  at each timestamp, rasterizes through canvas, and encodes the GIF in the browser. It uploads
  nothing and needs no application server or database.
- Before rasterizing, export settles one view box at the requested output size. It samples every
  frame and includes transformed labels, tails, markers, strokes, and Mermotion shadow paint, so
  downscaled and height-capped GIFs are not cropped.
- A GIF can contain up to 600 sampled frames. Tall diagrams keep their aspect ratio and scale down
  when the requested width would make them exceed the 2,400 pixel encoder height limit. A separate
  120 million pixel-frame ceiling rejects expensive combinations before canvas allocation.
- **Use 640px · 10fps** applies the Notion preset. The result reports whether it is under the 5 MB
  upload target; the user uploads the downloaded GIF through Notion's normal file control.

### CLI GIF export

- A `.gif` output path selects the full timeline: `mermotion render diagram.mmd -o diagram.gif`.
  `--loop` accepts `forever`, `once`, or a total play count, and `--hold` sets the pause between
  loops.
- The CLI renders and binds Mermaid once, seeks the shared sampler for each frame, expands animated
  bounds, and encodes inside one isolated Chromium page. Its default is 960 pixels at 20 fps with a
  500 ms final hold.
- GIF-only options fail on SVG or PNG output, while `--at` fails on GIF output. Machine-readable
  results include dimensions, duration, playback length, and frame count.

## M4 result: client-only scenes

- A scene owns one ordinary Mermaid source and one ordinary motion sidecar. The scene rail adds,
  renames, duplicates, deletes, reorders, and switches these pairs without adding story grammar to
  either file.
- Presentation mode uses the same preview and sampler, with previous, next, play, and direct scene
  controls. Leaving presentation returns to the editor with every source intact.
- IndexedDB v2 stores ordered scenes and migrates the old single-pair record. The downloadable
  `workspace.mermotion.json` bundle contains all scenes plus top-level mirrors of the active file
  pair for older consumers.
- IndexedDB writes use revision compare-and-swap. A stale tab cannot replace newer work, and a
  blocked or failed store leaves the current in-memory sources editable and downloadable.

## Deliberate limits after v1

Repeated parallel connections remain an error for endpoint-only `move` and route-based `trace`; a
future syntax decision must identify one connection without exposing Mermaid's generated SVG IDs.
Semantic subtargets outside flowchart and sequence need their own stable identity contract and
fixture group. Video export can be added after choosing a browser and codec support contract; GIF is
the portable animated output in v1.

## Settled decisions

- The repository uses MIT. The public `mermotion` package bundles the CLI and portable agent skill;
  internal engine, CLI, and website workspace packages stay private.
- Project state stays in local files, browser IndexedDB, and explicit downloads. There is no remote
  project model.
- Agents use the CLI plus a thin instructional skill. There is no MCP server or alternate agent-only
  syntax.
- Browser layout is an internal renderer dependency. Playwright drives that adapter and tests the
  website; installing Chromium is a setup prerequisite, but no browser choice or resolver command is
  exposed through Mermotion.

The Appearance sheet edits local shell roles, Mermaid frontmatter, and the declarative motion default
without blurring which file owns each value.
