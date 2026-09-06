# Mermotion visual direction

**State:** accepted implementation direction for M1
**Audience:** developers and technical writers authoring Mermaid diagrams
**Primary job:** make source, semantic targets, and time inspectable in one view

## Concept: an animation desk

Mermotion opens directly into the editor. Source occupies the left side, the Mermaid canvas gets the larger right side, and the timeline spans both below. The canvas and timeline carry the product's identity; the surrounding controls stay compact.

The starter motion file shows the small M1 profile rather than every syntax form the parser accepts:

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
│ diagram.mmd   diagram.motion    │                                             │
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
- Hover outlines a Mermaid target. Click pins it and places `Animate`, `Copy target`, and `Inspect` beside the selection.
- The timeline uses State, Route, and Signal lanes so a user can separate target changes, path travel, and the current animation color at a glance.
- A duration appears as one clip with a restrained wash and perimeter taken from its lane color. State uses cobalt, Route uses violet-blue, and Signal uses raspberry.
- Cue text stays one plain inline phrase, such as `highlight brief`. The effect keyword is not a badge, pill, separate label, or accent block.
- Hover, selection, and keyboard focus adjust the existing wash and perimeter. They never add a nested selection outline around the clip.
- Selecting a cue seeks to its timestamp and opens motion source. The DSL stays authoritative; direct cue dragging and timing fields belong to the M4 story editor.
- `Cmd/Ctrl+K` opens commands for rendering, validation, fit, source focus, cue insertion, and playback.
- Interface transitions normally finish within 180ms. Pane resizing doesn't animate, and the shell has no page-load cascade, parallax, glass, confetti, glow field, or 3D tilt.
- Reduced motion removes interface travel and scale. Diagram playback never starts on its own and always keeps Pause plus deterministic seeking available.

The website and agents write only canonical M1 source. They use stable Mermaid IDs and endpoint
routes, never Mermaid-generated SVG IDs. They do not emit YAML, JSON, CSS selectors, keyframes, or
new keywords into `diagram.motion`; richer parser forms stay an input-compatibility surface.

**Reset all colors** restores Graphite, the starter Mermaid palette, and the raspberry motion
default. It does not remove diagram statements, motion cues, markers, or compatibility-only cue
colors.

## Reference decisions

- Use the nested, keyboard-resizable workbench pattern from shadcn's resizable primitive, styled locally.
- Borrow timing-ruler and reversible-editing ideas from Transitions.dev, not its visual skin.
- Follow Rare UI's replay-at-end behavior, adapted to a continuous timeline.
- Keep the command palette small and keyboard-first, using shadcn and beUI as interaction references.
- Treat Beautiful UI, beUI, Rare UI, and shadcn as references rather than a component bundle or house style.
