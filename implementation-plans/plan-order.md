# Implementation Plan Order

The plans are implemented in the following dependency order. Each plan's own ledger remains authoritative for its tickets and `PLAN_STATUS`; update this index whenever a ticket count, current ticket, plan status, or dependency changes. Finishing one ticket, phase, or plan is only a checkpoint: implementation work must continue in order and must not be treated as complete until every listed plan and every ticket is `DONE`, unless a genuine external blocker is recorded in the authoritative ledgers.

| Order | Implementation plan | Declared status | Current execution state |
| ---: | --- | --- | --- |
| 1 | [Ability Automation](done/ABILITY_AUTOMATION_PLAN.md) | `DONE` | Complete and archived. |
| 2 | [Platform Modernisation and Automation Presentation Contract](done/AUTOMATION_PRESENTATION_CONTRACT_PLAN.md) | `DONE` | Complete and archived. |
| 3 | [Capability Automation](done/CAPABILITY_AUTOMATION_PLAN.md) | `DONE` | Complete and archived. |
| 4 | [Edge Automation](done/EDGE_AUTOMATION_PLAN.md) | `DONE` | Complete and archived: 61 Trainer + 20 Poké rows, with 80 native-complete and Breeder delegated-complete. |
| 5 | [Feature Automation](done/FEATURE_AUTOMATION_PLAN.md) | `DONE` | Complete and archived: 444 native-complete Features across 30 reviewed cohorts. |
| 6 | [Encounter UI and UX](done/ENCOUNTER_UI_UX_PLAN.md) | `DONE` | Complete and archived: role-projected cockpit, Encounter Documents and Builder, tactical lens, Director workflows, accessibility, performance, rollout, and aggregate-only UX metrics. |
| 7 | [Breeding and Egg Lifecycle](done/BREEDING_AND_EGG_LIFECYCLE_PLAN.md) | `DONE` | Complete and archived: production-authoritative Breeding Workshop, durable Egg lifecycle, exact-replay mechanics, migration/recovery, accessibility, and release certification across all 90 tickets. |
| 8 | [Complete Play Loop](done/COMPLETE_PLAY_LOOP_PLAN.md) | `DONE` | Complete and archived: trusted-table liveplay alpha accepted; 100 of 100 tickets complete. |
| 9 | [Guided Character Creation and Campaign Onboarding](done/CHARACTER_CREATION_AND_CAMPAIGN_ONBOARDING_PLAN.md) | `DONE` | Complete and archived: guided policy/slot/draft/review/atomic-commit onboarding, existing-character intake, encounter handoff, accessibility/concurrency/performance acceptance, and golden zero-to-first-encounter journeys across all 100 tickets. |
| 10 | [Pokémon Contests](done/POKEMON_CONTESTS_PLAN.md) | `DONE` | Complete and archived: reviewed Contest authority, structured preparation, native Standard/Supercontest/Festival/Rotation runtime, role-safe liveplay, atomic ribbon/XP/prize settlement, recovery, documentation, and alpha acceptance across all 100 tickets. |
| 11 | [Deferred Mechanics Closure](DEFERRED_MECHANICS_CLOSURE_PLAN.md) | `IN_PROGRESS` | Active: 58 of 92 tickets complete; `CURRENT_TICKET: P11-059`. Generic Skill Checks are native-complete; Trainer Participant Contests now have shared dice, explicit methods, Trainer introductions/appeals, and complete Alternating/Simultaneous paired Voltage and adjacency authority, with performer integrations next. |

## 1.0 release definition

Recorded 2026-08-20 as the authoritative finish line for the first full release.

- **1.0 means core-complete trusted-table liveplay.** Every subsystem of PTU 1.05 core plus published errata is playable end to end in liveplay within the app-owned canonical reference scope: onboarding, the campaign play loop, encounters, breeding, contests, and the GM content pipeline, with no `BLOCKED` canonical row and no mechanics row left in a deferred or visible-with-reason state anywhere in the ledgers.
- **1.0 ships with explicit release guarantees.** A versioned release, documented campaign-database upgrade and migration guarantees, certified backup and restore at the release boundary, release notes, and reviewed repository presentation and fan-content notices.
- **The scope union is the contract, not the plan count.** The prospective boundaries below may merge or split when each ledger is drafted, but 1.0 requires completing the union of their recorded scopes.
- **Explicitly post-1.0.** Supplement content packs (for example Game of Throhs, Blessed and the Damned, and playtest packets) are 1.x expansions bound to new reviewed canonical data. Public authentication, multi-tenancy, public-service hardening, and federation remain product non-goals per the trusted-table thesis.

## Prospective plans toward 1.0

Prospective rows record agreed scope and ordering intent only. They are not authoritative ledgers, contain no tickets, and impose no autonomous-continuation obligation until each is drafted as a reviewed plan ledger and registered in the table above with a declared status. Drafting and registering the next prospective ledger is part of the closing work of its predecessor unless an explicit earlier decision supersedes it.

| Order | Prospective plan | Scope commitment | Depends on |
| ---: | --- | --- | --- |
| 12 | GM Campaign Toolkit | Modernize the legacy JSON encounter-table tooling into liveplay authority and complete Running the Game coverage: wild encounter generation, NPC trainer generation, and session preparation as ordinary campaign work. | Plan 11 (generated NPCs need the closed move, weapon, and item catalogs; Plan 11's converted draft was previously prospective row 11 and is now registered above). |
| 13 | 1.0 Release Readiness | Versioning policy, campaign-database upgrade and migration guarantees, backup/restore certification at the release boundary, release notes and tags, repository presentation, license and fan-content notice review, a full-catalog golden regression, and the `PRODUCT_PHASE` transition out of `ALPHA`. This plan mints 1.0. | Plans 10–12 complete. |
