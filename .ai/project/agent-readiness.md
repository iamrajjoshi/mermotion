# Agent readiness record

- Assessed state and date: empty Mermotion directory before product code, September 4, 2026
- Scanner: `@kodus/agent-readiness@0.1.3`, registry git head `ca868b1f6eeda329fa0d9ea280dd34c3d86c30a5`
- Registry integrity: `sha512-nZUeaTbRsbGWuqhjts69mBJTDp8AhSxTQcol+S6HzHiCuQvD3x/D+t03hKu/Y2w8F4befzo3YF6luXido2N6EA==`
- Command: `npx --yes @kodus/agent-readiness@0.1.3 <repo> --format json --no-web --no-color`
- AI/network behavior: `--ai` was not used; no project content was sent to an LLM endpoint
- Result: Level 1, with zero passing non-skipped checks because the target was intentionally empty
- Decision: not ready before bootstrap, as expected
- Reassessment: the same command was rerun after M1-U1. It remained Level 1, now at 7 of
  8 recognized checks toward Level 2. The scanner recognized the lockfile, runtime pin,
  dev command, unit and browser tests, README, contributing guide, EditorConfig, CI build
  and test steps, fresh lockfile, and Dependabot.

## Scanner limits

The report is a structural inventory, not proof that an agent can change the product. Version
`0.1.3` produced these known false negatives and misleading counts:

- it does not recognize Oxfmt or Oxlint;
- it did not detect `strict: true` in the shared TypeScript configuration;
- it did not recognize `AGENTS.md` or `docs/architecture/` even though both are present;
- it did not see the indirect `pnpm lint` call inside CI's `pnpm verify` step;
- its 471-test count includes dependency files; Mermotion itself currently has 91 Vitest tests and
  38 Playwright scenarios, run in both Chromium and Firefox for 76 browser-test executions.

Containers, environment templates, deployment, ownership, and a release license are omitted
because this delivery is a local-first static prototype in a new, unpublished repository. We
will add those only when the hosting and ownership decisions exist. The executable proof in
`.ai/project/state.md` and the fresh-agent canary are the readiness gate for this delivery.
