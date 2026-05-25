# Rotom Table docs

This directory collects presentation and reviewer documentation for Rotom Table. The goal is to make the project easy to evaluate without changing application behaviour.

## Start here

- [Review guide](review-guide.md) — what to inspect first, key routes, source areas, scripts, and production caveats.
- [Architecture](architecture.md) — high-level Nuxt/Nitro/local-first architecture.
- [Data model](data-model.md) — maps, sheets, trainers, encounter tables, app-owned PTU reference content, generated sheets, and local data hygiene.
- [Local development](local-development.md) — setup commands, checks, optional `just` recipes, and local filesystem behaviour.
- [Screenshots](screenshots.md) — capture checklist for future screenshots; no missing images are linked.
- [Track 1 performance roadmap](track-1-performance-roadmap.md) — no-quality-loss performance constraints, benchmark categories, and staged isometric map optimization plan.
- [Isometric render scheduler architecture](render-scheduler-architecture.md) — dirty rendering flow, active animation sources, and how to add future invalidation reasons.
- [Performance benchmark scenarios](performance-benchmark-scenarios.md) — empty, typical campaign, and stress map scenarios plus before/after PR metrics to record.
- [Performance benchmark fixtures](performance-benchmark-fixtures.md) — local fixture generator and manual checklist for reproducing benchmark maps without private campaign data.
- [Performance benchmark runbook](performance-benchmark-runbook.md) — step-by-step before/after measurement workflow and debug overlay interpretation guide.
- [Track 1 integrated benchmark pass](performance-benchmark-results.md) — recorded empty, typical, and stress fixture measurements from the integrated Track 1 branch.
- [Track 1 no-quality-loss audit](performance-no-quality-loss-audit.md) — final Track 1 audit confirming no intentional visual-quality or functionality reduction.
- [Track 1 final implementation review](performance-track-1-final-review.md) — completion readiness checklist, completed chunk PR coverage, and final automation handoff notes.
- [Performance guardrails](performance-guardrails.md) — reviewer checklist and automated checks that prevent performance work from reducing visual quality or map functionality.
- [Fan project notice](fan-project-notice.md) — unofficial fan-project boundaries.

## Existing technical notes

- [Map v2](maps-v2.md) — current map document shape and render layers.
- [Move automation requirements](move-automation-requirements.md) — design notes for map move automation coverage.
- [Pokémon size outliers](pokemon-size-outliers.md) — data notes for sprite/map scale edge cases.
