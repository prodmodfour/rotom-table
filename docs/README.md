# Rotom Table docs

This directory collects presentation and reviewer documentation for Rotom Table. The goal is to make the project easy to evaluate without changing application behaviour.

## Start here

- [Review guide](review-guide.md) — what to inspect first, key routes, source areas, scripts, and production caveats.
- [Architecture](architecture.md) — high-level Nuxt/Nitro/filesystem-backed architecture.
- [Data model](data-model.md) — maps, sheets, trainers, player profiles, encounter tables, campaign reference overrides, app-owned PTU reference content, generated sheets, and local data hygiene.
- [Group inventory workflow](group-inventory.md) — shared party inventory authority, GM revision-checked saves, linked-trainer transfers, realtime sync, maintenance export, and atomic move-automation item writes.
- [Campaign repositories](campaign-repositories.md) — using `ROTOM_CAMPAIGN_ROOT` to keep private campaign JSON and campaign reference override diffs in a separate Git repository.
- [Player profiles and linked character control](player-profiles.md) — normal player login/profile selection, GM profile management, linked sheet editing, player-visible map control, and reference browsing.
- [Live play authority](live-play-authority.md) — normal `/maps/<slug>` profile-play command direction, setup/edit versus live-play boundaries, revision/idempotency glossary, and the rule forbidding browser-owned whole-map autosave for live gameplay.
- [Move automation contributor guide](move-automation.md) — MoveSpec authoring, evidence, runtime selection, and strict completion checks.
- [Ability automation contributor guide](ability-automation.md) — 483-ability implementation ledger, AbilitySpec modes, event subscriptions, frequency state, evidence, and migration checks.
- [Move automation release acceptance](move-automation-release-acceptance.md) — recorded 776-move automated, production-like browser, privacy, recovery, and runtime-retirement acceptance.
- [Move automation operator recovery and manual QA](move-automation-manual-qa.md) — private live-play canary, uncertainty, restart, backup, and privacy runbook.
- [Local development](local-development.md) — setup commands, checks, optional `just` recipes, and local filesystem behaviour.
- [Autonomous build loop](autonomous-build.md) — ticket-driven Pi build loop for issues #27-#44 and its quality gate.
- [Private VPS hosting scope](private-vps-hosting.md) — initial private trusted-table VPS boundary, non-goals, and links to filesystem/security docs.
- [Private VPS deployment smoke checklist](private-vps-deployment-smoke-checklist.md) — after-deploy private VPS checks for install, validation, built-server start, health, outer-gated profile play, write persistence after restart, Git hygiene, and legacy `/sessions` boundaries.
- [Private VPS live-play smoke checklist](private-vps-live-play-smoke.md) — multi-browser command/revision, SSE reconnect, conflict, refresh, and restart checks for private hosted profile play.
- [Private VPS readiness summary](private-vps-readiness-summary.md) — selected Node 24 runtime, systemd deployment path, hosted-write policy, final validation evidence, and known public-service follow-ups.
- [Private VPS backup runbook](private-vps-backups.md) — before/after-session campaign archives, temporary restore smoke checks, private deployment config notes, retention guidance, and Git hygiene.
- [API route mutation audit](api-route-mutation-audit.md) — non-GET API route classifications, hosted-write coverage, and remaining limitations.
- [Screenshots](screenshots.md) — capture checklist for future screenshots; no missing images are linked.
- [Map rendering performance roadmap](map-rendering-performance-roadmap.md) — no-quality-loss performance constraints, benchmark categories, and staged isometric map optimization plan.
- [Archived legacy live-session documents](archive/live-session/README.md) — obsolete/maintenance-only `/sessions` lobby, socket, roadmap, storage, and runbook notes. Normal multiplayer architecture is documented in [Live play authority](live-play-authority.md).
- [ADR 009: Server-authoritative profile play](adrs/009-server-authoritative-profile-play.md) — decision record for normal `/maps/<slug>` live play using persistent profiles, commands, revisions, idempotency, patches, and database-backed authority instead of browser-owned whole-map autosave.
- [ADR 010: Authoritative move-automation runtime](adrs/010-move-automation-runtime.md) — decision record for semantic completion, server authority, versioned MoveSpecs and bounded handlers, state ownership, durable reactions, ruleset scope, and mechanics-independent VFX.
- [ADR 011: Authoritative ability-automation runtime](adrs/011-authoritative-ability-automation-runtime.md) — decision record for AbilitySpec modes, typed event routing, effective abilities, frequency resources, durable triggers, privacy, and migration.
- [Isometric render scheduler architecture](render-scheduler-architecture.md) — dirty rendering flow, active animation sources, and how to add future invalidation reasons.
- [Performance benchmark scenarios](performance-benchmark-scenarios.md) — empty, typical campaign, and stress map scenarios plus before/after PR metrics to record.
- [Performance benchmark fixtures](performance-benchmark-fixtures.md) — local fixture generator and manual checklist for reproducing benchmark maps without private campaign data.
- [Performance benchmark runbook](performance-benchmark-runbook.md) — step-by-step before/after measurement workflow and debug overlay interpretation guide.
- [Map rendering integrated benchmark pass](performance-benchmark-results.md) — recorded empty, typical, and stress fixture measurements from the current performance implementation.
- [Map rendering no-quality-loss guardrails](performance-no-quality-loss.md) — map rendering performance guardrails confirming no intentional visual-quality or functionality reduction.
- [Map rendering performance readiness](performance-readiness.md) — performance readiness checklist, validation coverage, and no-quality-loss evidence.
- [Performance guardrails](performance-guardrails.md) — reviewer checklist and automated checks that prevent performance work from reducing visual quality or map functionality.
- [Fan project notice](fan-project-notice.md) — unofficial fan-project boundaries.

## Existing technical notes

- [Map v2](maps-v2.md) — current map document shape and render layers.
- [Move animations implementation brief](move-animations.md) — user-facing release note, disable/reduced-motion controls, scope, UX, visual-only boundaries, and expected source areas for the basic move VFX layer.
- [Token cosmetic improvements](cosmetic-improvements.md) — release note, renderer model, ticket plan, and manual QA checklist for idle sprite grounding, persistent sprite isometric shading, and tactical cage affordances.
- [Move animation manual QA checklist](move-animation-manual-qa.md) — repeatable browser review scenarios for hits, misses, crits, self/healing/status/buff/area/pass effects, reduced motion, disabled animations, lifecycle, persistence, and blocker/polish classification.
- [Realtime map action events manual QA](realtime-map-action-events-manual-qa.md) — same-map multi-tab/device checklist for transient splashes, move VFX, move feedback, Poké Ball UI, second-map isolation, duplicate prevention, per-client settings, visual-only persistence, and the latest code-assisted browser smoke result.
- [Move VFX first-playtest follow-up issues](move-vfx-follow-up-issues.md) — first realistic map playtest notes, blocker/polish triage, and small follow-up issue list for readability, accessibility, performance validation, and future bespoke wishes.
- [Pokémon size outliers](pokemon-size-outliers.md) — data notes for sprite/map scale edge cases.
