# Mermaid upgrade policy

Mermotion treats Mermaid as a compatibility boundary, not a floating implementation detail.

## What is automated

- Mermaid is pinned to one exact version in the pnpm catalog.
- Dependabot checks npm dependencies every Monday and opens a separate Mermaid pull request.
- The policy check requires the reviewed engine version constant to match the catalog pin.
- CI installs from the frozen lockfile, runs parser/compiler tests, validates the dependency boundary, builds every workspace, and runs browser tests against real flowchart and sequence SVG output.
- Browser proof covers frontmatter themes, representative flowchart nodes and edges, sequence participants, repeated messages, click-to-author motion, and sampling at a scrubbed timestamp. Unit tests prove that repeated sampling at the same timestamp is deterministic.

There is intentionally no automatic merge for Mermaid. Static rendering uses Mermaid's public package entry point, but semantic target discovery reads attributes from rendered SVG. A minor Mermaid release can change that SVG without changing its public syntax.

## Reviewing an upgrade

1. Update the exact `mermaid` catalog entry and `MERMAID_VERSION` together.
2. Install with pnpm so the lockfile records the selected release.
3. Run `pnpm verify` and `pnpm test:e2e`.
4. Inspect the flowchart and sequence fixtures in the editor, including one repeated sequence message and one moving marker crossing a route segment.
5. Add a fixture before merging if the Mermaid release changes an SVG convention or fixes a newly supported diagram form.

The pin mismatch fails with a direct policy diagnostic, so an update cannot silently change the library while leaving the editor's runtime status stale.
