# Agent readiness record

- Assessed state and date: empty Mermotion directory before product code, September 4, 2026
- Scanner: `@kodus/agent-readiness@0.1.3`, registry git head `ca868b1f6eeda329fa0d9ea280dd34c3d86c30a5`
- Registry integrity: `sha512-nZUeaTbRsbGWuqhjts69mBJTDp8AhSxTQcol+S6HzHiCuQvD3x/D+t03hKu/Y2w8F4befzo3YF6luXido2N6EA==`
- Command: `npx --yes @kodus/agent-readiness@0.1.3 <repo> --format json --no-web --no-color`
- AI/network behavior: `--ai` was not used; no project content was sent to an LLM endpoint
- Result: Level 1, with zero passing non-skipped checks because the target was intentionally empty
- Decision: not ready before bootstrap, as expected
- M1-U1 reassessment: the same command was rerun after M1-U1. It remained Level 1, now at 7 of
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
- its 471-test count included dependency files; at that checkpoint, Mermotion had 91 Vitest tests and
  38 Playwright scenarios, run in both Chromium and Firefox for 76 browser-test executions.

## Current interpretation

The scan is a historical inventory, not a current test report. Mermotion now has an MIT license, 206
passing Vitest tests, and 71 Playwright scenarios run in Chromium and Firefox for 142 browser-test
executions. The exact current commands and results live in `.ai/project/state.md`.

Containers, deployment manifests, and environment templates remain intentional omissions. Mermotion
has no hosted tier, application server, or server-side configuration; local files, IndexedDB, and
explicit exports are the product boundary.
