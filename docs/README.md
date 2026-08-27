# Rotom Table documentation

Rotom Table 1.0 is a Nuxt 4, SQLite-authoritative, liveplay-only trusted-table application. Choose the path that matches your role; development hosting and archived seams are not production instructions.

## Operators — deploy, upgrade, recover

Read these in order for the supported Linux x86-64 private VPS shape:

1. [Private VPS hosting boundary](private-vps-hosting.md)
2. [Deployment smoke checklist](private-vps-deployment-smoke-checklist.md)
3. [1.0 campaign upgrade guide](release/upgrade.md)
4. [Backup, restore, retention, and rollback](private-vps-backups.md)
5. [Production liveplay smoke](private-vps-live-play-smoke.md)
6. [Security and outer access gate](../SECURITY.md)

Release identity and compatibility:

- [Versioning, tags, and provenance](release/versioning.md)
- [Private VPS readiness summary](private-vps-readiness-summary.md)
- [API mutation audit](api-route-mutation-audit.md)
- [Campaign repository/private-root layout](campaign-repositories.md)

Use `npm run upgrade:campaign`, `backup:campaign`, `restore:campaign`, and `audit:campaign` only as documented. Local Nuxt development is not a supported liveplay host.

## GMs — prepare and run the table

- [Complete Play Loop GM guide](complete-play-loop-gm-guide.md) — sheets, inventory, encounters, settlement, continuation, and recovery.
- [GM Campaign Toolkit](gm-campaign-toolkit/README.md) and [GM guide](gm-campaign-toolkit/gm-guide.md) — campaign tables, deterministic wild/NPC packages, session preparation, Builder launch, and recovery.
- [Pokémon Contests](contests/README.md) — ordinary, Trainer Participant, and Battle Contest workflows.
- [Deferred mechanics closure](deferred-mechanics-closure.md) — ranged weapons, item actions, Skill Checks, and Battle Contest integration.
- [Group inventory](group-inventory.md) — shared custody, transfers, revisions, and realtime behavior.
- [Player profiles](player-profiles.md) — profile creation, character links, and token control.
- [Ability recovery/manual QA](ability-automation-manual-qa.md) and [Move recovery/manual QA](move-automation-manual-qa.md).

## Players — trusted-table expectations

- [Complete Play Loop player guide](complete-play-loop-player-guide.md)
- [Player profiles and linked-character control](player-profiles.md)
- [Liveplay authority](live-play-authority.md) — commands, revisions, retries, and setup versus live boundaries.
- [Contest documentation](contests/README.md)

The GM/Player picker is role projection for a known table, not public authentication. Player views must never rely on GM diagnostics or private evidence.

## Contributors — architecture and gates

Start with:

- [Contributing](../CONTRIBUTING.md)
- [Architecture](architecture.md)
- [Data model](data-model.md)
- [Liveplay authority](live-play-authority.md)
- [Encounter presentation contract](encounter-presentation-contract.md) and [schema/API reference](encounter-presentation-api.md)
- [Complete Play Loop contributor guide](complete-play-loop-contributor-guide.md)
- [GM Campaign Toolkit contributor guide](gm-campaign-toolkit/contributor-guide.md)

Mechanics authorities:

- [Move automation](move-automation.md) and [release acceptance](move-automation-release-acceptance.md)
- [Ability automation](ability-automation.md) and [release acceptance](ability-automation-release-acceptance.md)
- [Encounter presentation release acceptance](automation-presentation-contract/release-acceptance.md)
- [Breeding contributor guide](breeding/contributor-guide.md) and [GM/player guide](breeding/gm-and-player-guide.md)
- [Contests](contests/README.md)

Architecture decisions:

- [ADR 009 — Server-authoritative profile play](adrs/009-server-authoritative-profile-play.md)
- [ADR 010 — Move automation runtime](adrs/010-move-automation-runtime.md)
- [ADR 011 — Ability automation runtime](adrs/011-authoritative-ability-automation-runtime.md)
- [ADR 012 — Encounter presentation](adrs/012-server-authoritative-encounter-presentation-contract.md)

Release checks are machine-owned under `data/release-readiness/` and `scripts/release-readiness/`. Canonical mechanics data comes only from the fourteen `data/reference/*.json` authorities and `shared/ruleset/natures.ts`; documentary trees and parser inputs are not runtime fallback sources.

## Design, accessibility, and performance

- [Screenshot workflow](screenshots.md)
- [Map v2](maps-v2.md)
- [Render scheduler architecture](render-scheduler-architecture.md)
- [Performance roadmap](map-rendering-performance-roadmap.md)
- [Benchmark scenarios](performance-benchmark-scenarios.md), [fixtures](performance-benchmark-fixtures.md), [runbook](performance-benchmark-runbook.md), and [results](performance-benchmark-results.md)
- [No-quality-loss guardrails](performance-no-quality-loss.md), [readiness](performance-readiness.md), and [review guardrails](performance-guardrails.md)
- [Move animations](move-animations.md), [manual QA](move-animation-manual-qa.md), and [realtime action-event QA](realtime-map-action-events-manual-qa.md)
- [Token cosmetics](cosmetic-improvements.md)
- [Pokémon size outliers](pokemon-size-outliers.md)

## Notices and repository boundaries

- [Fan-project notice](fan-project-notice.md)
- [Repository notice](../NOTICE.md)
- [Security](../SECURITY.md)
- [Contributing/data hygiene](../CONTRIBUTING.md)

Never commit campaign databases, profiles, environment files, backup archives, release evidence, or screenshots containing private campaign material.

## Historical material

Documents under [archive/live-session/](archive/live-session/README.md) describe the retired/direct-only `/sessions` seam and are historical maintenance references. They do not define current profile-based liveplay architecture. Any document explicitly marked roadmap, legacy, archived, or historical is context—not a supported operator procedure.
