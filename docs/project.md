# Mermotion project brief

## Product outcome

A developer or technical writer can paste or type a Mermaid diagram, add explicit motion visually or in a compact declarative language, preview it at any timestamp, and keep the original Mermaid source portable. A coding agent can author the same pair of source files and use the local CLI for syntax, formatting, compilation, and deterministic sampling.

## M1: Animate one diagram (in progress)

M1 includes:

- static rendering delegated to Mermaid 11.17.2, with browser proof for flowchart and sequence diagrams;
- semantic motion for flowchart nodes and selected routes;
- semantic motion for sequence participants and ordinary messages;
- `motionDiagram-v1`, diagnostics, formatting, compilation, and deterministic sampling;
- a static local-first editor with source, preview, timeline, appearance controls, and IndexedDB persistence;
- four local desk palettes with per-role overrides, plus source-backed Mermaid and motion color editing;
- CLI validation, motion checks, formatting, compilation, sampling, and JSON output;
- browser-backed CLI target inventory and existence checks;
- a sandboxed preview rendering boundary;
- an exact Mermaid pin, an automated pin/import-boundary check, and a reviewed flowchart/sequence upgrade checklist.

M1 excludes GIF/video export, stories, accounts, hosted saves, public links, collaboration, MCP, an application server, and PostgreSQL.

## M1 delivery status

- M1-U1 is implemented: engine, motion language, web workbench, local persistence, target-aware browser playback, and Node-only CLI.
- M1-U2 remains: move preview rendering into a sandboxed browser realm and add an opt-in browser-backed CLI target resolver. Until then, target-bearing CLI commands report `targetResolution: "inferred"` and `CLI_TARGETS_NOT_VERIFIED`.

## Authoring contract

`diagram.mmd` is standard Mermaid and owns structure, layout, configuration, and theme. Diagram color edits use Mermaid's `config.themeVariables` frontmatter with `theme: base`; the background also drives the preview underlay. `diagram.motion` starts with `motionDiagram-v1` and owns time, effects, and motion color. The website shows one logical document and can generate motion statements from selections, so authors do not need to maintain the sidecar manually.

Application chrome stays outside both source files. Graphite, Blueprint, Paper, and Midnight plus any per-role overrides persist with the local workspace in IndexedDB. The shell's Transport role and the source-owned Motion Signal are separate even when they use the same starter color.

## Milestone plan

| Milestone                    | Status       | Outcome and exit gate                                                                                                                                                                                |
| ---------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0: Reproducible project     | Complete     | A fresh contributor or agent can install, run, check, and understand the repository from its own instructions.                                                                                       |
| M1: Animate one diagram      | In progress  | One flowchart or sequence diagram can be authored and animated through the website and CLI. M1 closes after M1-U2 proves sandboxed rendering and browser-backed CLI target resolution.               |
| M2: Stable semantic coverage | Planned next | Motion survives ordinary Mermaid edits and supported Mermaid upgrades across the fixture matrix. Flowchart and sequence ambiguities fail clearly instead of rebinding silently.                      |
| M3: Export and Notion        | Planned      | The same sampled timeline exports deterministic SVG and PNG, then GIF and video. At least one documented Notion workflow is verified against the exported result.                                    |
| M4: Stories                  | Planned      | An author can arrange several diagram states into a multi-step sequence, preview it as a presentation, and return to editing without source loss.                                                    |
| M5: Hosted sharing           | Conditional  | Consider read-only hosted links only if M3 and M4 usage shows local files and Notion exports are insufficient. Raj owns the continue or stop decision.                                               |
| M6: Cloud projects           | Conditional  | Consider accounts, cross-device storage, and collaboration only after M5 demonstrates demand. Server and database choices, including whether PostgreSQL is needed, remain undecided until this gate. |

There are no target dates yet. The order is intentional, but M5 and M6 are option points rather than promised scope.

## Delivery units

### M1-U1: Local authoring and deterministic playback — implemented

The current slice renders themed flowcharts and sequence diagrams, inventories browser targets,
parses and samples declarative motion, plays and scrubs deterministically, adds a cue from a selected
target, retains local drafts and appearance settings, and exposes the browser-free CLI with explicit
target-resolution metadata.

### M1-U2: Isolated rendering and verified CLI targets — next

- Move Mermaid rendering into a sandboxed browser realm behind a typed bridge.
- Add an opt-in Playwright resolver that returns the real rendered target inventory to the CLI.
- Fail target-bearing CLI commands on missing or ambiguous targets while keeping syntax and format
  commands browser-free.
- Re-run the flowchart and sequence browser matrix. M1 closes only when those checks pass at one
  commit.

### M2-U1: Rebinding and ambiguity rules — first M2 unit

- Preserve motion bindings when Mermaid labels, order, layout, or theme change but semantic IDs do
  not.
- Add an explicit selector for one of several same-direction sequence messages.
- Define and test authored node dwell timing.
- Prove failures for deleted, renamed, or ambiguous targets instead of choosing a rendered element
  silently.

M2 then adds automated Mermaid candidate-version fixtures, the supported browser matrix, and an
initial-load budget for Mermaid's larger chunks. Those compatibility and performance gates belong to
M2 rather than blocking the local M1 path.

M3 proceeds in three cuts: SVG/PNG from the sampled frame, deterministic GIF/video from the same
sampler, then a tested Notion path. M4 starts with multi-step editing before adding presentation
controls. M5 and M6 are not implementation-ready until their demand gates are met.

## Deferred decisions

- The release license must be chosen before making the repository public or publishing a package; it
  does not block private development or M1 verification. Raj owns the decision.
- Hosting is deferred to the M5 gate. No application server is part of M1 through M4.
- Persistent server storage is deferred to M6. Local-first files and IndexedDB remain the default;
  PostgreSQL is not assumed.

The Appearance sheet in M1-U1 edits local shell roles, Mermaid frontmatter, and the declarative
motion default without hiding which file owns each value.
