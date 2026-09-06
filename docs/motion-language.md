# Mermotion motion language

Keep the diagram in an ordinary Mermaid file. Motion is optional and lives beside it:

```text
checkout.mmd
checkout.motion
```

The `.mmd` file owns diagram type, structure, IDs, labels, layout, frontmatter, and theme. The
`.motion` file owns timing and animation. Mermotion never inserts private syntax into Mermaid.

## Canonical M1 profile

```motion
motionDiagram-v1
  defaults duration 480ms easing ease-out color #ff5470
  marker request as "Request"

  highlight client
  with pulse api for 600ms
  move request along client --> api --> worker over 1.8s
  trace api --> worker over 800ms
```

The first non-comment line is the version header. Canonical source has one `defaults` line,
statements on separate lines, two-space indentation, and six-digit hexadecimal colors. Mermaid IDs
stay bare when they are unambiguous; IDs that contain spaces or collide with syntax words are quoted.
The marker declaration above creates a dot; M1 has no other marker shape.

Unprefixed cues start after earlier cues finish. `with` starts a cue alongside the preceding one.
Use `at 2.4s` only when a cue needs an exact timeline position. Durations accept `ms` or `s`: use
`for` with `highlight` and `pulse`, and `over` with `trace` and `move`. Omitting a duration uses the
single default.

Easing may be `linear`, `ease`, `ease-in`, `ease-out`, or `ease-in-out`. Literal marker travel
usually uses a `linear` default because the route represents distance rather than a decorative
transition.

## Effects and targets

The canonical M1 verbs are `highlight`, `pulse`, `trace`, and `move`.

```motion
motionDiagram-v1
  defaults duration 400ms easing ease-out color #ff5470
  marker request as "Request"

  highlight client
  pulse api for 500ms
  trace client --> api --> worker over 1.2s
  move request along client --> api --> worker over 1.8s
```

Use IDs from Mermaid source, such as `client`, `api`, and `worker`, rather than display labels. A
route names adjacent Mermaid IDs and resolves each connection against the rendered diagram. Missing
or ambiguous targets produce diagnostics; a route is never a CSS selector or a center-to-center
guess.

Repeated sequence messages need the full semantic selector:

```motion
pulse message Worker->>API: "GET /status" occurrence 1 for 300ms
pulse message Worker->>API: "GET /status" occurrence 2 for 300ms
```

It includes the sender, Mermaid arrow, receiver, exact quoted message text, and one-based occurrence.
You may omit `occurrence` only when that signature matches one message. When it repeats, every cue
uses an explicit occurrence—including `occurrence 1`—so inserting another identical message cannot
silently rebind existing motion.

## Markers and paths

A marker keeps its identity for its entire route:

```motion
motionDiagram-v1
  defaults duration 480ms easing linear color #ff5470
  marker request as "Request"

  move request along client --> api --> worker over 1.8s
  pulse worker for 500ms
```

The renderer joins the source center, Mermaid's measured connections, intermediate centers, and the
destination center into one path. It allocates time by distance, so a longer leg takes longer under
linear easing. After arrival, the marker keeps its identity and position.

A later move for the same marker must start at its prior destination and cannot overlap the earlier
move. Mermotion rejects a discontinuous or ambiguous path instead of making the marker jump.

## Color

Put the canonical motion color on the defaults line:

```motion
defaults duration 480ms easing ease-out color #ff5470
```

The website's **Motion → Signal** field edits that line and writes a six-digit value. If a file has no
motion color, Mermotion keeps the rendered Mermaid color. Transport controls belong to the local desk
palette, so changing the Play button does not change exported source.

## Generated source

Website authoring controls and agents emit only the canonical M1 profile. They derive targets from
Mermaid source and the semantic target inventory; they never copy Mermaid-generated SVG IDs into a
sidecar. They also never emit YAML, JSON, CSS selectors, keyframes, or invented keywords. A generated
cue stays readable as motion source, quotes an ID only when the parser requires it, and leaves the
`.mmd` file unchanged.

## Compatibility and advanced forms

The parser accepts a wider input surface so older and hand-written files keep working. That surface
includes cue labels paired with `after`, `wait`, visibility and story verbs (`unhighlight`, `reveal`,
`hide`, and `remove`), all-message reveals, edge ID lists, explicit target-kind prefixes, per-cue
easing or color, `color inherit`, semicolons, alternate Mermaid arrows, short or alpha-bearing
hexadecimal colors, and legacy explicit marker-shape clauses.

These forms are compatibility or advanced syntax, not canonical M1 output. Do not put them in
canonical examples, website insertions, or agent-authored source. The repeated-message selector
described above is the exception: its full form is required when sequence messages repeat.

## CLI

```sh
mermotion validate checkout.mmd
mermotion motion fmt checkout.motion --check
mermotion render checkout.mmd --at 1.25s -o checkout-frame.svg
```

Use `pnpm exec mermotion` when Mermotion is a project dependency, or
`pnpm dlx @iamrajjoshi/mermotion@0.1.0` for a one-off command. Inside the Mermotion source checkout,
`pnpm mermotion` rebuilds the engine and CLI before running. After `pnpm build`, contributors can
invoke the built entry point directly when stdout must contain one JSON envelope:

```sh
node packages/cli/dist/index.js motion check checkout.mmd --json
node packages/cli/dist/index.js motion compile checkout.mmd --json
node packages/cli/dist/index.js sample checkout.mmd --time 1.25s --json
node packages/cli/dist/index.js render checkout.mmd --check --json
```

The CLI looks for a same-name `.motion` sibling. Validation and formatting never rewrite `.mmd`.
`render` is the authoritative target-binding check because it discovers Mermaid's actual SVG
inventory before compilation; use a `.png` output name for PNG. `validate`, `motion compile`, and
`sample` stay browser-free and do not claim that authored IDs exist in the rendered diagram.

See [`design/motion-behavior.md`](design/motion-behavior.md) for the geometry, timing, and performance
rules behind these semantics.
