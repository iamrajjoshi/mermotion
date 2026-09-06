# Mermotion visual direction

**State:** implemented local v1 through scenes and animated export
**Audience:** developers and technical writers authoring Mermaid diagrams
**Primary job:** make source, semantic targets, and time inspectable in one view

## Concept: an animation desk

Mermotion opens directly into the editor. Source occupies the left side, the Mermaid canvas gets the larger right side, and the timeline spans both below. The canvas and timeline carry the product's identity; the surrounding controls stay compact.

The canonical authoring reference shows the small M1 profile rather than every syntax form the
parser accepts:

```motion
motionDiagram-v1
  defaults duration 480ms easing ease-out color #ff5470
  marker request as "Request"

  highlight brief
  with pulse render for 600ms
  move request along brief --> render --> cue over 1.8s
  trace cue --> preview over 800ms
```

Bare Mermaid IDs keep the source legible. Unprefixed cues run in sequence; `with` overlaps the
preceding cue, and `at` appears only when exact placement matters. Effects use `for`, paths use
`over`, and the interface writes six-digit hexadecimal colors.

```text
┌ Mermotion  checkout.mmd              Fit  Appearance  Export  Commands  Play ┐
├──────────── source ─────────────┬────────────── preview ──────────────────────┤
│ diagram.mmd  diagram.motion  Syntax                                           │
│                                │           rendered Mermaid                  │
│ editor and diagnostics         │           selected target controls          │
│                                │                                             │
├────────────────────────────────┴─────────────────────────────────────────────┤
│ State   highlight ━━━ pulse      Route   move ━━━━━━   Signal       │ 01:20 │
└──────────────────────────────────────────────────────────────────────────────┘
```

Desktop starts at a 38/62 Source/Preview split, with 77% of the height for that work area and 23% for the timeline. The separators remain keyboard-focusable and their positions persist locally. Mobile turns the regions into Source, Preview, and Timeline tabs without discarding editor state.

## Color ownership

Color has three owners, and the UI should make the boundary obvious.

| Scope   | Stored in        | What it controls                                                       |
| ------- | ---------------- | ---------------------------------------------------------------------- |
| Desk    | IndexedDB        | application chrome, text, controls, selection, feedback, and transport |
| Diagram | `diagram.mmd`    | Mermaid fills, text, borders, connections, groups, and background      |
| Motion  | `diagram.motion` | the default animation signal                                           |

The Appearance sheet exposes all three scopes in that order. Choosing Graphite, Blueprint, Paper, or Midnight replaces the local desk palette; changing an interface field then adds a per-role override. Diagram controls write standard Mermaid frontmatter under `config.themeVariables` and set `config.theme` to `base`. The `background` variable drives both Mermaid and the preview underlay.

Transport and Motion Signal happen to share `#ff5470` in the starter state, but they are different values. Transport belongs to the local desk; Motion Signal is source and travels with `diagram.motion`. The Appearance sheet edits the single canonical `defaults` line.

## Graphite starter palette

Graphite uses quiet, near-black chrome around a light drafting surface. Cobalt marks selection and focus. Raspberry marks playback and motion, which keeps editing state separate from animation state.

| Role                 | Value                 | Use                                      |
| -------------------- | --------------------- | ---------------------------------------- |
| Workspace            | `#15171c`             | application ground                       |
| Surface / raised     | `#1d2027` / `#272b34` | editors and active controls              |
| Canvas frame         | `#f4f6f8`             | inset surround around the diagram ground |
| Text / muted         | `#f2f4f7` / `#9ca4b2` | primary and secondary text               |
| Rule                 | `#383e49`             | pane and control separation              |
| Header / header text | `#101217` / `#f7f8fa` | top bar                                  |
| Selection            | `#5b8cff`             | focus, selected targets, and state cues  |
| Transport            | `#ff5470`             | Play and timeline transport              |
| Timing / error       | `#e4a951` / `#ef6a72` | warnings and invalid source              |

IBM Plex Sans Variable handles application text. JetBrains Mono Variable is reserved for source, target identities, timestamps, diagnostics, and document metadata.

## Interaction rules

- Source tabs use the filenames `diagram.mmd` and `diagram.motion`; they aren't rounded pills.
- Syntax is a distinct, non-persisted Source view rather than a third file. It is a searchable,
  ruled reference for canonical M1 syntax, with Copy on every example and Insert only on complete
  motion statements adapted to semantic IDs in the current preview.
- Hover outlines a Mermaid target. Click pins it and places `Animate`, `Copy target`, and `Inspect` beside the selection.
- The timeline uses State, Route, and Signal lanes to separate target changes, marker travel, and
  short signals.
- A duration appears as one clip with a restrained wash and perimeter. Color identifies the cue
  family: highlight uses cobalt, move and trace use violet-blue, and pulse uses amber.
- Compatibility-only release and removal cues use coral. Their keywords remain plain inline text.
- Cue text stays one plain inline phrase, such as `highlight brief`. The effect keyword is not a badge, pill, separate label, or accent block.
- Hover, selection, and keyboard focus adjust the existing wash and perimeter. They never add a nested selection outline around the clip.
- Selecting a cue seeks to its timestamp and opens motion source. The DSL stays authoritative;
  direct cue dragging and timing fields remain outside v1. Scenes sequence complete source pairs
  instead of rewriting cue timing.
- `Cmd/Ctrl+K` opens commands for rendering, validation, fit, source focus, the Syntax reference,
  cue insertion, and playback. `Cmd/Ctrl+/` opens Syntax directly.
- Interface transitions normally finish within 180ms. Pane resizing doesn't animate, and the shell has no page-load cascade, parallax, glass, confetti, glow field, or 3D tilt.
- Reduced motion removes interface travel and scale. Diagram playback never starts on its own and always keeps Pause plus deterministic seeking available.

## Export panel

The header's **Export** control opens one modal panel for rendered output and editable source. It
keeps the local boundary visible in plain text: rendering happens in the browser and no file is
uploaded.

- **Animated GIF** leads with a width preset (640, 960, or 1280 pixels), cadence (10, 20, or 25 fps),
  and playback controls for forever, once, or a stated total number of plays.
- **Use 640px · 10fps** applies a Notion-oriented preset without adding an integration. After
  encoding, the panel reports whether the local file is under the 5 MB upload target.
- **Pause on final frame** is optional for looping exports, with 0.25, 0.5, 1, and 2 second choices.
  It stays disabled for **Play once**.
- A compact readout shows sampled-frame count, output dimensions, and playback length before export.
  While encoding, that area shows progress and a cancel action; completion reports the local
  `checkout.gif` download.
- The readout shows the scaled dimensions when a tall diagram would exceed the 2,400 pixel encoder
  height limit. Exports stop at 600 sampled frames and explain which setting to reduce if the total
  pixel workload is still too large for a browser tab.
- Export measures the complete animated extent before encoding and uses one fixed view box, so
  marker labels, tails, and effect paint stay within the frame instead of shifting the crop.
- **Project source** remains a separate row in the same panel and downloads
  `workspace.mermotion.json` with every scene plus an active top-level source pair.

The panel traps focus, closes on Escape, returns focus to the Export control, and fits the mobile
viewport without horizontal scrolling.

Website authoring controls and agents write only canonical M1 source. They use stable Mermaid IDs
and endpoint routes, never Mermaid-generated SVG IDs. They do not emit YAML, JSON, CSS selectors,
keyframes, or new keywords into `diagram.motion`; richer parser forms stay an input-compatibility
surface.

**Reset all colors** restores Graphite, the starter Mermaid palette, and the raspberry motion
default. It does not remove diagram statements, motion cues, markers, or compatibility-only cue
colors.

## Scene and presentation controls

The scene rail is one compact strip between the header and split workbench. Numbered scene tabs are
useful order markers, not decoration. A selected scene exposes move, duplicate, rename, and delete
controls; Add scene and Present stay at the end of the strip. Rename happens inline. Delete asks for
confirmation and is unavailable when only one scene remains.

Each scene owns one `diagram.mmd` and `diagram.motion` pair. Switching scenes clears transient
selection and playback state, then renders that pair through the existing preview. The rail does not
introduce a third story language, hidden transitions, or global animation settings.

Presentation mode removes the source, timeline, and editing controls. It keeps the same preview
renderer and offers Exit, previous, play or pause, next, and a bottom scene strip. Scene changes are
manual in v1; there is no automatic cross-scene transition or playback cascade.

## Reference decisions

- Use the nested, keyboard-resizable workbench pattern from shadcn's resizable primitive, styled locally.
- Borrow timing-ruler and reversible-editing ideas from Transitions.dev, not its visual skin.
- Follow Rare UI's replay-at-end behavior, adapted to a continuous timeline.
- Keep the command palette small and keyboard-first, using shadcn and beUI as interaction references.
- Treat Beautiful UI, beUI, Rare UI, and shadcn as references rather than a component bundle or house style.
