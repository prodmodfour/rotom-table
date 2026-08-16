This is a Nuxt 4 and three.js project.

## Implementation plan completion

- Active execution snapshot: Guided Character Creation and Campaign Onboarding is `TODO` (0 of 100 tickets complete; current P9-001; no blocker).
- Read `implementation-plans/plan-order.md` before implementation work and follow its dependency order.
- The authoritative ticket ledger is `implementation-plans/CHARACTER_CREATION_AND_CAMPAIGN_ONBOARDING_PLAN.md`; each plan's `PLAN_STATUS` and `CURRENT_TICKET` remain authoritative.
- Keep the active plan and `implementation-plans/plan-order.md` synchronized whenever ticket counts, current execution, dependencies, or plan status change.
- Completing one ticket, phase, or plan is only a checkpoint. Do not stop, finish the task, or report overall completion while any implementation plan or ticket in the ordered ledgers remains unfinished. Continue autonomously in dependency order until every implementation is `DONE`, unless a genuine external blocker prevents progress; record any such blocker in both authoritative ledgers.

## Validation and resource discipline

This workspace has limited shared memory. Repeated or concurrent TypeScript, Vitest, Vite, Nuxt, and build processes can exhaust it.

- During implementation, prefer focused tests for the behavior being changed. When practical, constrain Vitest with `--maxWorkers=1 --no-file-parallelism`.
- Batch related changes before typechecking. Run typecheck at meaningful integration milestones and once near final acceptance rather than after every edit.
- Reserve the full test suite, production build, and `scripts/quality-gate.sh` for closure unless a broad run is specifically needed to diagnose an integration failure.
- Do not rerun an already-passing suite unless its relevant dependency surface changed. Keep track of validated commands and results across handoffs.
- If memory pressure or an OOM occurs, stop duplicate validation processes, inspect active processes, and resume with one bounded command at a time.

## Liveplay
This is a liveplay-only app. Local hosting is deprecated. All implemented features must work in liveplay.

## UI design workflow

- Whenever work touches visible or interactive UI—including Vue/Nuxt pages and components, CSS, layout, responsive behavior, accessibility presentation, interaction states, or three.js visuals—read and follow `.pi/skills/ui-design-workflow/SKILL.md` before editing.
- For substantive visible changes, use the skill's resource-capped Codex image-generation wrapper to create and inspect a target-state mockup before implementation unless the user explicitly opts out. Load the skill even when a provably non-visual UI-adjacent change does not require image generation.

## Authoritative PTU reference data

Treat only these app-owned JSON files as the canonical runtime reference sources:

- `data/reference/moves.json`
- `data/reference/abilities.json`
- `data/reference/edges.json`
- `data/reference/poke-edges.json`
- `data/reference/capabilities.json`
- `data/reference/features.json`
- `data/reference/conditions.json`
- `data/reference/items.json`
- `data/reference/maneuvers.json`
- `data/reference/pokedex.json`
- `data/reference/stat-rankings.json`
- `data/reference/pokemonExperienceChart.json`
- `data/reference/rules.json`

The similarly named files under `ptu-data/data/`, checked-in books/markdown, parser inputs, PDFs, websites, wikis, and other external sources are documentary or provenance material only. They are not runtime sources of truth and must not be used to silently supplement, override, or reinterpret the canonical JSON.

Do not use web search to establish PTU identities, inventories, rule text, or mechanics. If required canonical data is absent or ambiguous, fail closed and add or repair an app-owned `data/reference/*.json` source through a reviewed, source-hash-bound migration before implementing runtime semantics. Runtime code must consume the app-owned JSON, never documentary text or parser output.


