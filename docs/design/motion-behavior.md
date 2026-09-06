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
2. A named marker keeps its DOM node, color, label, and identity until the compatibility-only
   `remove` verb runs. A later move after `remove` starts a new marker incarnation.
3. `move` and `trace` follow Mermaid's rendered geometry. A missing or ambiguous route produces a
   diagnostic instead of a center-to-center guess.
4. A later move for the same marker must start where the prior move ended. Overlaps and discontinuous
   restarts fail compilation.
5. Playback and seeking are pure functions of time. Re-seeking a timestamp returns the same frame and
   the same position, color, lifecycle, and paint order.
6. `move` and `trace` default to linear travel, even when the document default uses another easing
   for state changes such as `pulse`. A route needs no redundant `easing linear` clause.

## Marker treatment

A moving marker has four authored-time layers:

- one 9-pixel signal bead that stays visible through nodes and remains at the destination;
- a 19-pixel core tail and 34-pixel soft tail, both ending at the bead;
- one label plaque whose direction is selected from the complete route and does not flip at a node;
- one 200-millisecond arrival ring with zero opacity at both endpoints and a restrained midpoint
  peak.

The tails are two retained full-route paths. Their `d` values never change during a move; only the
paint interval, width, and opacity change. They use a four-part normalized dash pattern so each
painted interval has one bounded start and end. They do not use `non-scaling-stroke`: in a scaled SVG,
that property makes normalized dash positions diverge from route positions. Width and tail length
are instead converted to root user units from the current screen scale. Browser tests sample the
paint itself on both sides of the bead, so a tail that moves in front of its marker fails.

| Effect      | Job                                      | Suggested motion                       |
| ----------- | ---------------------------------------- | -------------------------------------- |
| `move`      | Carry one named thing through the system | Linear, measured across the full route |
| `trace`     | Show which connections participate       | Linear draw, removed when its cue ends |
| `pulse`     | Mark an arrival or state change          | One short cycle, then stop             |
| `highlight` | Hold attention                           | Restrained color or shadow change      |

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

Geometry gets measured once per rendered SVG and cached. The overlay, marker groups, marker-tail
paths, and trace paths stay mounted while a cue updates transforms and paint attributes. Mermaid
re-rendering creates a new SVG, which naturally invalidates those caches. Source colors are cached
after their first computed-style read. An implicit marker color is tied to the first rendered route
source in its current incarnation, so a direct seek and a played seek resolve to the same color.

Mermaid `themeCSS` still owns the diagram, but broad rules such as `path { ... }` must not rewrite
the motion overlay's dash geometry, scale behavior, or reduced-motion visibility. Mermotion writes
those overlay-only presentation properties as isolated inline declarations; browser tests include a
hostile broad theme rule and inspect the resulting paint. Trace groups always paint below marker
groups, and authored event order determines order within each layer even after a backward seek has
removed and recreated elements.

Mermaid-authored CSS transitions and animations are paused while a frame is sampled. Mermotion only
overrides the activation longhands, preserves authored durations and timing functions, and restores
the original inline values and priorities when motion is removed. The final sampled value is committed
before those transitions resume, so deleting the last cue does not create a several-second drift back
to the diagram's original appearance.

Reduced-motion mode preserves the semantic marker position while removing its decorative trail,
halo, and arrival ring. Browser tests cover state effects plus marker and trace travel on unique and
repeated sequence messages. Repeated signatures use explicit one-based occurrences. Authored node
dwell and a stable selector for parallel same-endpoint flowchart connections remain optional later
work.

## Proof required for changes

- Marker position matches the rendered route within 1.5 CSS pixels during a seek and at its
  destination.
- Tail paint ends at the marker rather than appearing ahead of it, including after preview zoom.
- A multi-hop route sampled every 20ms has no node-boundary displacement spike.
- Trace source and clone agree at the start, midpoint, and end under their screen transforms.
- Marker and overlay DOM identities survive repeated seeks.
- Direct and played seeks resolve the same implicit marker color; compatibility-only `remove` starts
  a new DOM incarnation.
- Broad Mermaid `themeCSS` cannot override overlay dash geometry, screen scaling, or reduced-motion
  visibility, group transforms, opacity, or hit testing.
- Compiler tests cover continuous, discontinuous, and overlapping moves, including rescheduling later
  implicit cues after an invalid move is rejected.

The browser suite seeks two frames after warm-up and rejects bounding-box reads, computed-style
reads, child-list rebuilding, or more than two screen-transform reads. This is a repeatable regression
guard for the warmed sampling path, not a frame-rate claim.

The geometry model comes from the [SVG coordinate-system
specification](https://www.w3.org/TR/SVG/coords.html). Long-running automatic motion will also need the
pause and reduced-motion behavior described in [WCAG 2.2's motion
guidance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html).
