# Mermotion motion language

Keep structure, layout, labels, IDs, frontmatter, and themes in an ordinary Mermaid `.mmd` file.
Put optional timing and animation in a same-name `.motion` file.

```text
checkout.mmd
checkout.motion
```

## Canonical form

```motion
motionDiagram-v1
  defaults duration 480ms easing ease-out color #ff5470
  marker request as "Request"

  highlight client
  with pulse api for 600ms
  move request along client --> api --> worker over 1.8s
  trace api --> worker over 800ms
```

The first non-comment line is the version header. Use one `defaults` line, two-space indentation,
one statement per line, and six-digit hexadecimal colors. Use bare Mermaid IDs unless an ID contains
spaces or collides with a motion keyword, in which case quote it.

Unprefixed cues run in sequence. `with` overlaps the preceding cue. `at 2.4s` pins a cue to an exact
time. Durations accept `ms` or `s`; effects use `for`, while `trace` and `move` use `over`. Omitting
a duration uses the default.

Supported easing values are `linear`, `ease`, `ease-in`, `ease-out`, and `ease-in-out`. Linear
easing is usually best when marker travel represents distance rather than decoration.

## Effects and routes

Canonical source uses `highlight`, `pulse`, `trace`, and `move`:

```motion
motionDiagram-v1
  defaults duration 400ms easing ease-out color #ff5470
  marker request as "Request"

  highlight client
  pulse api for 500ms
  trace client --> api --> worker over 1.2s
  move request along client --> api --> worker over 1.8s
```

Use IDs such as `client`, `api`, and `worker`, not display labels. A route lists adjacent Mermaid IDs
and follows Mermaid's measured connections. A marker keeps its identity and position after arrival.
A later move for the same marker must start from its prior destination and must not overlap the
earlier move.

## Sequence messages

Repeated sequence messages require a semantic selector with a one-based occurrence on every match:

```motion
pulse message Worker->>API: "GET /status" occurrence 1 for 300ms
pulse message Worker->>API: "GET /status" occurrence 2 for 300ms
```

Include the sender, Mermaid arrow, receiver, exact quoted message text, and occurrence. Omit the
occurrence only when that signature matches exactly one rendered message.

## Boundaries

Do not write YAML, JSON, CSS selectors, generated SVG IDs, keyframes, or invented keywords in a
`.motion` file. The parser accepts some legacy and advanced forms for compatibility, but generated
and agent-authored files should use only the canonical form above.
