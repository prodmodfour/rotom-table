This is a Nuxt 4 and three.js project.

## Implementation plan completion

- Active execution snapshot: Plans 1–12 are `DONE` and archived. Plan 11 ([Deferred Mechanics Closure](implementation-plans/done/DEFERRED_MECHANICS_CLOSURE_PLAN.md)) completed all 92 tickets and 29/29 closure rows; Plan 12 ([GM Campaign Toolkit](implementation-plans/done/GM_CAMPAIGN_TOOLKIT_PLAN.md)) completed all 96 tickets and 40/40 footprint rows.
- Read `implementation-plans/plan-order.md` before implementation work and follow its dependency order.
- The authoritative archived ledgers for Plans 11 and 12 are `implementation-plans/done/DEFERRED_MECHANICS_CLOSURE_PLAN.md` and `implementation-plans/done/GM_CAMPAIGN_TOOLKIT_PLAN.md`; each registered numbered plan's `PLAN_STATUS` and `CURRENT_TICKET` remain authoritative.
- The recorded finish line is the 1.0 release definition in `implementation-plans/plan-order.md`. The Plan 13 [1.0 Release Readiness](implementation-plans/drafts/RELEASE_READINESS_PLAN.md) scope is registered for review but is not a numbered ledger, is not activated, and imposes no execution obligation. Prospective rows and registered drafts remain scope intent only until converted into reviewed numbered ledgers registered in the authoritative plan table and explicitly started by the owner.
- Keep any active numbered plan and `implementation-plans/plan-order.md` synchronized whenever ticket counts, current execution, dependencies, or plan status change.
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

- Whenever work touches visible or interactive UI—including Vue/Nuxt pages and components, CSS, layout, responsive behavior, accessibility presentation, interaction states, or three.js visuals—load and follow the global `ui-design-workflow` skill before editing.
- For substantive visible changes, use the skill's resource-capped Codex image-generation wrapper to create and inspect a target-state mockup before implementation unless the user explicitly opts out. Load the skill even when a provably non-visual UI-adjacent change does not require image generation.
- Rotom-specific design authority layered on the skill: `DESIGN.md` is normative; for encounter UI also read `docs/encounter-workspace/design-system.md`, `data/encounter-workspace/design-tokens.v1.json`, and the relevant `Encounter*` primitives, and run `npm run check:encounter-design` for encounter design-system changes.
- Product contexts are Field Guide, Workshop, and Live Encounter; identify the audience and authorised projection before choosing visible data. The mockup renderer's Rotom visual direction lives in `.pi/ui-mockup-style.md` (auto-injected by the wrapper).

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
- `data/reference/contests.json`

The similarly named files under `ptu-data/data/`, checked-in books/markdown, parser inputs, PDFs, websites, wikis, and other external sources are documentary or provenance material only. They are not runtime sources of truth and must not be used to silently supplement, override, or reinterpret the canonical JSON.

Do not use web search to establish PTU identities, inventories, rule text, or mechanics. If required canonical data is absent or ambiguous, fail closed and add or repair an app-owned `data/reference/*.json` source through a reviewed, source-hash-bound migration before implementing runtime semantics. Runtime code must consume the app-owned JSON, never documentary text or parser output.


