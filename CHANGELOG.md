# Changelog

All notable Rotom Table product and operator changes are recorded here.

Rotom Table uses [Semantic Versioning](https://semver.org/). Until the atomic 1.0 release transaction is approved and completed, the repository remains on a release-candidate identity; a pending section is not a released version.

## Changelog convention

- Keep an **Unreleased** section at the top, grouped under `Added`, `Changed`, `Fixed`, `Security`, `Operations`, or `Boundaries` when those headings are useful.
- Add a dated version heading only for an immutable release commit and annotated tag. Never move a released tag or rewrite its entry.
- Describe user-visible capability, data guarantees, operator action, compatibility, and trust boundaries. Do not turn implementation ticket IDs or internal refactor noise into release notes.
- Link migrations, backup/restore steps, known limitations, and security boundaries whenever an operator must act.
- Mark breaking storage or environment changes explicitly. Database rollback means restoring the exact pre-upgrade backup; downgrade is not implied by Semantic Versioning.
- Keep GM/player examples role-safe and synthetic. Changelog entries must not contain campaign data, credentials, private hostnames, or unreleased table material.

## [Unreleased]

No changes have been recorded after the current candidate.

## [1.0.0-rc.5] - 2026-08-27

### Fixed

- Aligned the final evidence verifier with the release writers' documented exact `0640` file mode: owner read/write, group read, and no access for others.
- Added a deterministic source gate for that exact evidence-permission contract and documented the matching `0750` evidence-directory mode.

### Boundaries

- This successor includes the complete rc.4 source scope plus the evidence-permission verifier repair only. The failed rc.4 tag remains immutable and unpublished; its local partial bundle is not release evidence for rc.5.

## [1.0.0-rc.4] - 2026-08-27

### Fixed

- Regenerated the production documentary-read proof after the earlier project-authored visual replacements changed the certified source graph.
- Extended the accepted hash-successor chain for five reviewed release-readiness documentation and package surfaces, preserving immutable prior hashes while certifying their current content.

### Boundaries

- This successor includes the complete rc.3 source scope plus evidence-drift repairs only. The failed rc.3 tag remains immutable and unpublished; it produced no build or release evidence bundle.

### Rehearsal outcome

- The local annotated `v1.0.0-rc.4` tag was created immutably and passed the complete release-readiness aggregate, production build, checksum/provenance generation, and the zero-finding 13,629-file artifact audit. The final verifier then stopped because it rejected group-read on files deliberately written as `0640`; direct verification after correcting that inconsistent predicate proved all remaining hashes, identities, source bindings, and privacy checks. The partial local bundle was not certified as a successful command result, and the fix required rc.5 rather than moving this tag.

## [1.0.0-rc.3] - 2026-08-27

### Fixed

- The release command now invokes the tag-aware identity guard directly, preventing npm from forwarding `--require-tag` into Vitest. This is the only source repair after the immutable `v1.0.0-rc.2` rehearsal stopped before its aggregate gates or evidence generation.

### Boundaries

- This successor includes the complete rc.2 source scope plus the release-command fix. The failed rc.2 tag remains immutable and unpublished; it produced no release evidence bundle.

### Rehearsal outcome

- The local annotated `v1.0.0-rc.3` tag was created immutably and passed identity, upgrade, and backup gates. Release preparation then stopped fail-closed when the aggregate detected a stale documentary-read source-graph hash. Manual continuation also exposed missing accepted successors for hash-bound release surfaces. The run never reached its build, checksum, provenance, artifact-audit, or evidence-generation steps; both drift classes were repaired in rc.4 rather than moving the tag.

## [1.0.0-rc.2] - 2026-08-27

### Added

- Certified app-produced SQLite upgrades from schema heads v1–v55 to the v56 release schema, plus atomic import for documented JSON-era campaign roots.
- Added deterministic online and stopped-service backup archives, hash/manifest-verified fresh-host restore, aggregate integrity audit, and restore-then-upgrade drills.
- Added complete-catalog census, mechanics-finality, privacy, performance, and restart/fresh-host golden-journey evidence across the core trusted-table loop.
- Added operator-visible release identity in Settings and role-safe `/api/health` and `/api/version` responses.
- Added source-distribution classification, private-artifact exclusion, dependency/media provenance, generated third-party notices, and explicit owner disposition records.
- Added the fail-closed release command, deterministic checksum/provenance bundle, built-artifact audit, and clean-host installation certification.

### Changed

- The supported deployment is one private Linux x86-64 VPS per campaign group, using Node 24, a production Nitro build, systemd, loopback origin binding, an outer access gate, and private operator-controlled SQLite storage.
- Runtime PTU authority is limited to the fourteen app-owned `data/reference/*.json` registries plus `shared/ruleset/natures.ts`; documentary trees are never runtime fallback sources.
- Type/category badges, the saving indicator, favicon, and voxel-water visuals now use project-authored Vue/CSS/SVG/canvas work instead of 29 unknown-provenance images.
- Source builds explicitly install development build tooling even when the shell inherits `NODE_ENV=production`; the test authority explicitly uses `NODE_ENV=test`.

### Security

- Production campaign writes remain fail-closed unless the private operator deliberately sets exactly `ROTOM_ENABLE_HOSTED_WRITES=1` behind the required outer gate.
- The systemd template runs as a non-root service account with a read-only host filesystem except for the standard private campaign root.
- The current npm lock passes `npm audit --audit-level=high` with zero findings.

### Boundaries

- The GM/Player picker is a trusted-table role choice, not public authentication.
- Local hosting is deprecated for liveplay; public SaaS, multi-tenancy, public authentication, and non-Chromium certification are outside 1.0 support.
- The limited project license does not grant rights to third-party Pokémon or PTU material. Notices and attribution are not legal clearance.
- The owner explicitly accepts the recommendation-5 residual risk of retaining 1,460 edited Trainer-profile derivatives despite the source do-not-edit warning; the exception is not cured by notice text.

### Rehearsal outcome

- The local annotated `v1.0.0-rc.2` tag was created immutably, but release preparation stopped at its first command because `--require-tag` reached Vitest through the compound npm identity script. No aggregate gate, build, checksum, provenance, artifact audit, or release evidence bundle was represented as passed. The fix required rc.3 rather than moving this tag.

## [1.0.0-rc.1] - 2026-08-27

### Added

- Established `package.json` as the single release-version authority and minted the first release-candidate identity exactly once.
- Added shared package, server, UI, and build-provenance agreement for version `1.0.0-rc.1` and storage schema v56.
- Recorded the annotated `v1.0.0-rc.1` candidate tag as immutable; subsequent candidate changes require a new candidate version and tag.

### Boundaries

- This candidate established identity and provenance foundations; it was not the final 1.0 release and did not authorize publication.

## Pre-1.0 development history

These plan-level milestones describe the capability spine accumulated before the 1.0 release. They are historical development milestones, not separate published Semantic Versioning releases.

### Core mechanics automation

- **Ability Automation** established structured ability behavior and executable coverage.
- **Capability Automation** added reviewed capability semantics and completion checks.
- **Edge Automation** completed Trainer and Poké Edge behavior, including delegated Breeder authority.
- **Feature Automation** completed the reviewed core Feature cohorts.

### Platform and presentation

- **Platform Modernisation and Automation Presentation Contract** moved the application onto the current Nuxt architecture and established consistent mechanics presentation contracts.
- **Encounter UI and UX** delivered the role-projected encounter cockpit, Encounter Documents and Builder, tactical lens, Director workflows, accessibility, performance budgets, and privacy-safe metrics.

### Complete campaign loop

- **Breeding and Egg Lifecycle** delivered production-authoritative breeding preparation, consent boundaries, deterministic outcomes, durable Eggs, recovery, and accessibility.
- **Complete Play Loop** connected inventory, commerce, item use, encounter settlement, rewards, capture, continuation, and campaign-day advancement into server-authoritative liveplay.
- **Guided Character Creation and Campaign Onboarding** added campaign policy, slots, drafts, review, atomic character commit, existing-character intake, and first-encounter handoff.
- **Pokémon Contests** added structured preparation and native Standard, Supercontest, Festival, and Rotation play with role-safe liveplay and atomic settlement.

### Core-completeness closure

- **Deferred Mechanics Closure** resolved the remaining core mechanics rows and certified integrated storage, recovery, accessibility, performance, privacy, documentation, and desktop/mobile journeys with zero core mechanics debt.
- **GM Campaign Toolkit** added deterministic private wild/NPC generation, ordinary-sheet packages, session preparation, immutable Encounter Builder handoffs, recovery, and production liveplay acceptance.

### Release readiness

- **1.0 Release Readiness** freezes version, upgrade, backup/restore, complete-catalog, distribution, licensing/notices, rehearsal, and final-acceptance guarantees. Final `1.0.0` remains pending the explicit owner go/no-go and one atomic release transaction.
