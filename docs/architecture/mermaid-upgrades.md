# Mermaid upgrade policy

Mermotion treats Mermaid as a compatibility boundary, not a floating implementation detail.

## What is automated

- Mermaid is pinned to one exact version in the pnpm catalog.
- Dependabot checks npm dependencies every Monday and opens a separate Mermaid pull request.
- The policy check requires the reviewed engine version constant to match the catalog pin.
- CI installs from the frozen lockfile, runs parser/compiler tests, validates the dependency boundary,
  builds every workspace, runs the CLI renderer against real Chromium, and runs browser tests against
  Mermaid's user-facing diagram families in Chromium and Firefox.
- Browser proof covers frontmatter themes, representative flowchart nodes and edges, sequence participants, repeated messages, click-to-author motion, and sampling at a scrubbed timestamp. Unit tests prove that repeated sampling at the same timestamp is deterministic.
- `fixtures/mermaid/semantic-matrix.json` is the upgrade contract. Its flowchart and sequence
  variants keep semantic structure fixed while changing labels, declaration order, layout, and
  theme. The browser suite renders every variant with the installed Mermaid version, asserts the
  exact normalized target keys, and compiles the same checked-in motion source against each one.
- `fixtures/mermaid/render-compatibility.json` is the broader render contract. It contains one
  minimal source fixture for each built-in diagram syntax documented by the pinned Mermaid release.
  The browser suite requires each fixture to render without diagnostics and expose the whole-diagram
  target.

There is intentionally no automatic merge for Mermaid. Static rendering uses Mermaid's public package entry point, but semantic target discovery reads attributes from rendered SVG. A minor Mermaid release can change that SVG without changing its public syntax.

Dependabot supplies the update PR; it does not decide compatibility. The exact pin means normal
installs remain reproducible, while the matrix makes the review mechanical: a compatible update
stays green, and SVG drift fails with the affected diagram family and variant. The separate reviewed
`MERMAID_VERSION` constant prevents a dependency-only update from merging unnoticed.

## Render compatibility contract

Render compatibility and semantic motion compatibility are separate promises:

- **Render compatibility** means Mermaid accepts the source, returns SVG without editor diagnostics,
  and Mermotion binds that SVG to the `diagram` target. The smoke matrix covers this contract.
- **Semantic motion compatibility** means a sub-element has a stable declarative identity across
  Mermaid renders and upgrades. Only flowchart and sequence diagrams currently have that contract.

The render matrix covers 30 user-facing families and 33 syntax variants from Mermaid 11.17.2:
architecture, block, C4, class, Cynefin, entity relationship, event modeling, flowchart, Gantt, Git
graph, Ishikawa, Kanban, mindmap, packet, pie, quadrant, radar, railroad, requirement, Sankey,
sequence, state, swimlane, timeline, tree view, treemap, user journey, Venn, Wardley, and XY chart.
Railroad is represented by all four built-in variants: IR, EBNF, ABNF, and PEG.

The manifest marks a family `provisional` when its declaration includes `-beta` or the pinned
Mermaid documentation explicitly calls it experimental. Those families are architecture, C4,
Cynefin, Ishikawa, mindmap, radar, railroad, Sankey, swimlane, timeline, tree view, treemap, Venn,
and Wardley. They remain in the smoke gate so an upgrade exposes breakage, but a green smoke test is
not a promise that Mermaid has stabilized their grammar.

This is a representative render gate, not exhaustive grammar conformance. It intentionally excludes:

- ZenUML, which is an external Mermaid integration rather than a registered diagram in the pinned
  core package.
- `error`, `info`, and `---`, which are internal error, utility, and frontmatter detectors rather
  than authored diagram families.
- Renderer aliases such as `graph`, `flowchart-v2`, `class`, and `stateDiagram`; their canonical
  families are covered. `flowchart-elk` is not a separate compatibility claim because Mermaid 11
  moved ELK to an external package and the core renderer falls back to Dagre.

Adding a fixture here proves only whole-diagram rendering. A family needs explicit identity rules,
adapter coverage, and stability variants before Mermotion may advertise semantic node or connection
targeting for it.

## Stable binding contract

- Flowchart node IDs and endpoint-based edge keys survive display-label, source-order, direction,
  layout, and theme changes.
- Sequence participant IDs survive alias-label, declaration-order, and theme changes. Message keys
  use sender, arrow, receiver, exact message text, and occurrence rather than Mermaid's generated SVG
  ID.
- A message selector may omit `occurrence` only when that signature is unique. Repeated signatures
  require an explicit one-based occurrence, including `occurrence 1` for the first message.
- Deleted or renamed IDs and messages fail with `motion.target-not-found`. Duplicate semantic IDs,
  omitted occurrences on repeated messages, and endpoint-only routes with multiple rendered
  connections fail as ambiguous. Nothing falls back to a label or the first DOM match.

The matrix covers the currently supported semantic families, not every Mermaid diagram grammar.
When a new diagram family gains motion bindings, add its stable identity rules and at least four
matrix variants before calling it supported.

## Reviewing an upgrade

1. Update the exact `mermaid` catalog entry and `MERMAID_VERSION` together.
2. Install with pnpm so the lockfile records the selected release.
3. Run `pnpm verify`, `pnpm --filter @mermotion/cli test:render`, and `pnpm test:e2e`. The browser
   suite must pass both the semantic stability matrix and the full render compatibility matrix.
4. Render one sampled SVG and PNG through the CLI.
5. Inspect the flowchart and sequence fixtures in the editor, including one repeated sequence message
   and one moving marker crossing a route segment.
6. If intentional SVG drift changes the normalized adapter, update the adapter and matrix expectation
   in the same pull request. Never update expected keys merely to make a renamed binding pass.
7. Add a fixture before merging if the Mermaid release changes an SVG convention or fixes a newly
   supported diagram form.

The pin mismatch fails with a direct policy diagnostic, so an update cannot silently change the library while leaving the editor's runtime status stale.
