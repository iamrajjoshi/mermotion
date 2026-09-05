# Mermotion

Mermotion pairs an ordinary Mermaid diagram with an optional `.motion` sidecar. Mermaid owns the
diagram; the sidecar says what moves and when. The web editor opens both as one document, previews
the result, and stores drafts locally.

![Mermotion workbench with source, animated Mermaid preview, and timeline](docs/assets/mermotion-workbench.png)

## Canonical M1 profile

```text
checkout.mmd       standard Mermaid: structure, layout, frontmatter, theme
checkout.motion    optional Mermotion: timing and effects
```

```motion
motionDiagram-v1
  defaults duration 480ms easing ease-out color #ff5470
  marker request as "Request"

  highlight client
  with pulse api for 600ms
  move request along client --> api --> worker over 1.8s
  trace api --> worker over 800ms
```

Keep one `defaults` line and use bare Mermaid IDs. Unprefixed cues run in sequence; `with` overlaps
the preceding cue, while `at 2.4s` pins a cue to an exact time. Effects take `for`, paths take `over`,
and colors use six hexadecimal digits. A marker is a dot in M1, so its declaration does not need a
shape clause.

The website and agents write this profile. They never emit Mermaid-generated SVG IDs, YAML, JSON,
CSS selectors, keyframes, or keywords that are not part of the motion language. The editor can write
a cue from a selected rendered node or connection without touching the Mermaid file.

Named markers follow Mermaid's measured edge geometry, pass continuously through intermediate
nodes, and keep their identity after arrival. See
[`docs/design/motion-behavior.md`](docs/design/motion-behavior.md) for the motion rules and proof
thresholds. [`docs/motion-language.md`](docs/motion-language.md) separates canonical M1 source from
the wider parser compatibility surface.

## M1 status

M1 is in progress. The current slice includes delegated Mermaid rendering, verified flowchart and
sequence targeting, the `motionDiagram-v1` language, deterministic playback, local persistence, an
editable appearance model, and a non-interactive CLI. A sandboxed preview realm and browser-backed
CLI target verification remain. Target-bearing CLI commands currently succeed with
`targetResolution: "inferred"` and a `CLI_TARGETS_NOT_VERIFIED` warning.

`Download sources` saves the `.mmd` and `.motion` text in a JSON bundle. Rendered image/video export,
stories, Notion integration, accounts, hosted sharing, an MCP server, and PostgreSQL are later or
conditional work.

## Appearance and color ownership

Open **Appearance** to choose Graphite, Blueprint, Paper, or Midnight, then override individual interface roles. Those desk settings belong to the local workspace and stay in IndexedDB; they never alter exported source.

Diagram colors belong to `diagram.mmd`. Editing them writes Mermaid's standard
`config.themeVariables` frontmatter and sets `config.theme` to `base`, so Mermaid remains the
renderer of record. Its `background` value also colors the preview underlay. The motion signal lives
on the single `defaults` line in `diagram.motion` as a six-digit hexadecimal color.

**Reset all colors** restores the Graphite desk, the starter Mermaid palette, and the default
raspberry motion signal. It preserves diagram structure and motion cues; compatibility-only cue
colors remain untouched.

## Development

Requirements:

- Node.js 24.20.0 or a compatible newer release
- pnpm 11.25.0

After dependencies are installed:

```sh
pnpm dev
pnpm verify
pnpm exec playwright install chromium firefox
pnpm test:e2e
```

The CLI pairs a Mermaid file with a same-name motion sidecar:

```sh
pnpm mermotion validate checkout.mmd --json
pnpm mermotion motion fmt checkout.motion --check
pnpm mermotion motion compile checkout.mmd --json
pnpm mermotion sample checkout.mmd --time 1.25s --json
```

Read [`docs/motion-language.md`](docs/motion-language.md) for the authoring syntax and
[`docs/architecture/mermaid-upgrades.md`](docs/architecture/mermaid-upgrades.md) for the pinned
upgrade path. See [`docs/project.md`](docs/project.md),
[`docs/architecture/system.md`](docs/architecture/system.md), and
[`.ai/project/state.md`](.ai/project/state.md) for scope and current proof.
