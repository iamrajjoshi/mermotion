# Motion behavior

Mermotion should explain a declared event, not make a diagram look busy. The `.motion` file decides
what moves and when; an untouched Mermaid diagram stays still.

## What went wrong in the first player

The first marker renderer mixed two SVG coordinate spaces. It transformed a path point with the
child element's screen-facing matrix, then wrote that point into a root-level overlay where the root
matrix ran again. On the starter diagram, that put `Request` about 116 CSS pixels below its real
edge. Trace clones had the same fault.

Two other jumps remained after accounting for that offset. Mermaid paths stop at node boundaries,
so switching straight from one edge to the next skipped the inside of the node. The starter also
moved the same marker to `cue`, then restarted it at `render` on another branch. That last cue implied
one request had teleported backward.

The player now converts every measured point into root SVG user coordinates:

```text
root screen matrix⁻¹ × child screen matrix
```

That cancels the Mermaid `viewBox`, browser letterboxing, nested group transforms, and workbench
zoom. A route joins the source center, its rendered edge samples, each intermediate center, and the
destination center. One cumulative distance table controls the whole trip, so a 200-pixel leg gets
twice the time of a 100-pixel leg under linear motion.

## The behavior contract

1. Motion only exists when the author declares it. There are no random phases or automatic traffic.
2. A named marker keeps its DOM node, color, label, and identity until `remove` runs.
3. `move` and `trace` follow Mermaid's rendered geometry. A missing or ambiguous route produces a
   diagnostic instead of a center-to-center guess.
4. A later move for the same marker must start where the prior move ended. Overlaps and discontinuous
   restarts fail compilation.
5. Playback and seeking are pure functions of time. Re-seeking a timestamp returns the same frame and
   the same position.
6. Literal travel should use `linear`. Easing belongs on state changes such as `pulse`, `reveal`, and
   `hide`, where acceleration doesn't claim a changing transfer rate.

| Effect                      | Job                                      | Suggested motion                       |
| --------------------------- | ---------------------------------------- | -------------------------------------- |
| `move`                      | Carry one named thing through the system | Linear, measured across the full route |
| `trace`                     | Show which connections participate       | Linear draw, removed when its cue ends |
| `pulse`                     | Mark an arrival or state change          | One short cycle, then stop             |
| `reveal` / `hide`           | Control reading order                    | Brief eased transition                 |
| `highlight` / `unhighlight` | Hold or release attention                | Restrained color or shadow change      |

## What we took from Fanfa

[Fanfa](https://fanfa.dev/) gets several interaction choices right: Mermaid remains editable beside
the result, movement uses the actual SVG path, and pause plus canvas controls sit close to the
diagram. Mermotion keeps those ideas and makes the source file authoritative. A GUI action must write
readable `.motion` text rather than create state that only the editor understands.

The [launch discussion](https://news.ycombinator.com/item?id=46147329) asked for trackable objects,
scheduled routes, node behavior, sequence support, speed controls, and selective animation. It also
reported Firefox load and mobile failures. We won't copy random negative particle delays, equal time
per edge, or a field of always-running dots. Those choices make motion lively, but they blur identity
and can imply traffic that the diagram never declared.

## Runtime limits

Geometry gets measured once per rendered SVG and cached. The overlay, marker groups, and trace paths
stay mounted while a cue updates transforms and dash offsets. Mermaid re-rendering creates a new SVG,
which naturally invalidates those caches.

Reduced-motion mode preserves the semantic marker position while removing its decorative trail,
halo, wake, and arrival ring. Browser tests cover state effects plus marker and trace travel on one
unique sequence message. M2 owns optional authored node dwell and a selector that can distinguish
one of several same-direction repeated message routes.

## Proof required for changes

- Marker position matches the rendered route within 1.5 CSS pixels during a seek and at its
  destination.
- A multi-hop route sampled every 20ms has no node-boundary displacement spike.
- Trace source and clone agree at the start, midpoint, and end under their screen transforms.
- Marker and overlay DOM identities survive repeated seeks.
- Compiler tests cover continuous, discontinuous, and overlapping moves.

The geometry model comes from the [SVG coordinate-system
specification](https://www.w3.org/TR/SVG/coords.html). Long-running automatic motion will also need the
pause and reduced-motion behavior described in [WCAG 2.2's motion
guidance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html).
