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
statements on separate lines, two-space indentation, bare Mermaid IDs, and six-digit hexadecimal
colors. The marker declaration above creates a dot; M1 has no other marker shape.

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
pulse message Worker->>API: "GET /status" occurrence 2 for 300ms
```

It includes the sender, Mermaid arrow, receiver, exact quoted message text, and one-based occurrence.
Leave `occurrence` off when the message is unique.

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
cue stays readable as motion source, and the `.mmd` file remains unchanged.

## Compatibility and advanced forms

The parser accepts a wider input surface so older and hand-written files keep working. That surface
includes cue labels paired with `after`, `wait`, visibility and story verbs (`unhighlight`, `reveal`,
`hide`, and `remove`), all-message reveals, edge ID lists, explicit target-kind prefixes, per-cue
easing or color, `color inherit`, semicolons, alternate Mermaid arrows, short or alpha-bearing
hexadecimal colors, and legacy explicit marker-shape clauses.

These forms are compatibility or advanced syntax, not canonical M1 output. Do not put them in starter
files, primary examples, website insertions, or agent-authored source. The repeated-message selector
described above is the exception: its full form is required when sequence messages repeat.

## CLI

```sh
pnpm mermotion validate checkout.mmd
pnpm mermotion motion check checkout.mmd --json
pnpm mermotion motion fmt checkout.motion --check
pnpm mermotion motion compile checkout.mmd --json
pnpm mermotion sample checkout.mmd --time 1.25s --json
```

The CLI looks for a same-name `.motion` sibling. Validation and formatting never rewrite `.mmd`.
Target binding is verified in the rendered web path. The first CLI delivery validates Mermaid,
motion syntax, timing, cue labels, and marker references without launching Chromium; target-bearing
`validate`, `motion compile`, and `sample` responses include `targetResolution: "inferred"` and the
warning `CLI_TARGETS_NOT_VERIFIED`.

See [`design/motion-behavior.md`](design/motion-behavior.md) for the geometry, timing, and performance
rules behind these semantics.
