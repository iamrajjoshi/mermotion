---
name: mermotion
description: Author, validate, and locally render animated Mermaid diagrams with the Mermotion CLI.
---

# Mermotion

Use Mermotion when a user wants an ordinary Mermaid diagram with optional declarative motion. Read
[the motion language reference](references/motion-language.md) before authoring or changing motion.

- Keep each `.mmd` file valid Mermaid. When adding motion to an existing diagram, preserve its
  source unless the user also asks to change the diagram.
- Put optional motion in a same-name `.motion` sibling. Use the canonical syntax and IDs from the
  Mermaid source. Never insert Mermotion syntax into Mermaid.
- Never target generated SVG DOM IDs or CSS selectors, and never invent YAML, JSON, keyframes,
  agent-only syntax, or new motion keywords.
- Keep diagram data local. Do not upload it or create hosted resources.

## CLI workflow

Use an installed `mermotion` command. If it is unavailable, use `pnpm dlx mermotion@0.1.0` in its
place. Do not assume the Mermotion source repository is present.

1. Validate the pair with `mermotion validate path/to/diagram.mmd`.
2. Validate and check canonical formatting with
   `mermotion motion check path/to/diagram.mmd` and
   `mermotion motion fmt path/to/diagram.motion --check`.
3. Check rendered target binding with `mermotion render path/to/diagram.mmd --check`. This is the
   authoritative check for whether semantic IDs resolve against Mermaid's SVG.
4. Render an exact frame with
   `mermotion render path/to/diagram.mmd -o frame.svg --at 1.2s`. Use a `.png` output path for a
   raster frame.
5. Render the animation with
   `mermotion render path/to/diagram.mmd -o animation.gif --loop forever --hold 500ms`. Use
   `--loop once` for a one-shot GIF or an integer such as `--loop 3` for a total play count. The
   final hold applies only to looping GIFs.
6. Open and inspect the exported SVG, PNG, or GIF. A successful command alone is not visual proof.

Rendering runs in a local, network-disabled Chromium realm. If rendering reports that its browser
is unavailable, run `mermotion setup` once and retry. Parsing, formatting, compilation, and sampling
do not require that setup.
