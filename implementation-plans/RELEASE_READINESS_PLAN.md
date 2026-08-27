# 1.0 Release Readiness Implementation Plan

`PLAN_STATUS: IN_PROGRESS`

`CURRENT_TICKET: P13-074`

`BLOCKED_BY: NONE`

`DEPENDS_ON: implementation-plans/done/POKEMON_CONTESTS_PLAN.md, implementation-plans/done/DEFERRED_MECHANICS_CLOSURE_PLAN.md, implementation-plans/done/GM_CAMPAIGN_TOOLKIT_PLAN.md`

`DESIGN_AUTHORITY: DESIGN.md`

`PRODUCT_PHASE: ALPHA`

## Owner start gate

This ledger was converted from the reviewed scope draft and registered in the authoritative plan table on 2026-08-26 **by explicit owner instruction to write the Plan 13 ledger; that instruction registers scope and does not authorize implementation**. The owner start gate is a recorded blocker for the purposes of the autonomous-continuation rule in `AGENTS.md`:

- No ticket, code change, migration, fixture, document edit, version mint, or tag in this plan may begin while `BLOCKED_BY: OWNER_START_GATE` is present.
- The gate is lifted only by the owner: replace `BLOCKED_BY: OWNER_START_GATE` with `BLOCKED_BY: NONE`, set `CURRENT_TICKET: P13-001`, add a decision-log entry recording the start, and synchronize `implementation-plans/plan-order.md` and `AGENTS.md`.
- Until then, agents must treat this plan as registered but held, and must not count it as unfinished work that compels continuation.

## Goal

Mint Rotom Table 1.0 from the core-complete trusted-table liveplay product by defining and proving release-boundary guarantees: version identity, supported campaign-database upgrades, backup and restore, complete-catalog regression, distribution and repository presentation, licensing and fan-content notices, release notes and provenance-recorded artifacts, and the deliberate atomic transition out of `ALPHA`.

This is a release-readiness and certification plan, not a new gameplay subsystem. It may repair defects exposed by its release matrices through the authorities that own them, but it may not create parallel mechanics, persistence, sheets, launch, realtime, or browser authority.

## Product outcome

At 1.0 acceptance, every statement below is proven, not asserted:

1. An operator can state exactly which Rotom Table version they run — from package metadata, the server, and the UI — and every surface agrees.
2. An operator holding any promised pre-1.0 campaign input upgrades it with one documented procedure, or receives a fail-closed rejection with no partial writes.
3. An operator can back up, restore, restart, and integrity-audit a campaign at the release boundary with no direct JSON or database surgery.
4. The complete app-owned canonical catalog and every closed mechanics registry replay green at the release commit without reading documentary sources.
5. A newcomer reading the repository sees one coherent, truthful trusted-table product: current landing material, documentation, screenshots, metadata, and support boundaries.
6. The owner has explicitly reviewed and recorded licensing and fan-content dispositions for everything the repository ships.
7. Operators and GMs can read release notes stating guarantees, retired seams, compatibility boundaries, known limitations, and recovery procedures.
8. The release build is reproducible from the tagged commit, and its checksums verify against the recorded provenance.
9. 1.0 acceptance rests on bounded full-repository validation plus traced desktop and mobile production-liveplay journeys spanning the complete trusted-table loop.
10. `PRODUCT_PHASE` leaves `ALPHA` exactly once, atomically with the version, tag, notes, and machine-readable acceptance record.

## Current baseline (activation-verified 2026-08-26)

Verified against the repository at commit `84c4659e10bec5f39eea674e6439d24ac978e6ee` during draft conversion; the machine-readable inventory is `data/release-readiness/release-baseline.v1.json` (SHA-256 `096e039949d67c926ec82ac860f22569280937da0aa0e4a4576589267b430d11`, 20 rows).

- Plans 1–12 are complete and archived; Plan 12 final acceptance records 96/96 tickets and 40/40 footprint rows. `PRODUCT_PHASE` is `ALPHA` and exists only inside plan ledgers — no runtime surface reports a phase.
- **No release identity exists anywhere.** `package.json` has no version field, the repository has zero git tags, no changelog or release notes are tracked, and `GET /api/health` reports only `{ ok, service }`.
- The campaign SQLite authority is at `LATEST_STORAGE_SCHEMA_VERSION = 56` with a contiguous v1–v56 migration chain. Plan 12 certified fresh installs, exact-byte v50→v56 upgrades, v51–v55 historical heads, and v57 refusal; the full v1–v55 historical matrix was explicitly deferred to this plan. A documented JSON-era campaign import (`npm run migrate:sqlite`) exists with a pre-migration backup.
- The supported shape today: Node 24.x (`engines >=24 <25`, `.nvmrc 24`), production Nitro build (`npm run build` / `npm run start`), private Linux VPS under systemd behind an outer gate with `ROTOM_CAMPAIGN_ROOT` storage and `ROTOM_ENABLE_HOSTED_WRITES`, Playwright-certified Desktop Chrome and Pixel 7 projects, and a SQLite/WAL-safe backup runbook. Local `nuxt dev` hosting is deprecated.
- Runtime PTU authority is exactly the fourteen `data/reference/*.json` files plus `shared/ruleset/natures.ts#PTU_NATURE_CHART`. `scripts/quality-gate.sh` aggregates every per-domain completeness, drift, privacy, accessibility, performance, type, unit, browser, and build gate; CI runs on GitHub Actions.
- A scope-limited MIT `LICENSE`, `NOTICE.md`, `docs/fan-project-notice.md`, `SECURITY.md`, and `CONTRIBUTING.md` are tracked, but no reviewed release-boundary licensing or notice disposition exists.
- Tracked documentary/provenance trees: `books/` (1050 files), `ptu-data/` (23), `encounter_tables/` (4 retired legacy tables), `trainer_sizes/` (1459, including third-party sprite assets), `pokesheet.pdf`, `notepad/` (1). `README.md` still brands the app as Nuxt 3 with campaign-JSON persistence and leads with local hosting. Campaign databases, env files, Playwright evidence, and `.pi` artifacts are git-ignored; the tree is clean at the recorded commit.

## Scope

This plan owns:

- adoption of the frozen release baseline plus the release-gate rubric, version-surface inventory, supported-platform matrix, supported-upgrade-input index, distribution inventory, licensing inventory, known-limitation register, and their drift gates;
- the release identity authority: version policy, single-source version, server and UI reporting, build-time provenance, agreement gates, release-candidate discipline, checksum and provenance record generation, and tag rehearsal;
- the campaign upgrade guarantee: full historical-head matrix v1–v55, exact-byte preservation samples, JSON-era import certification, rejection and interruption matrices, rollback boundary, and the operator upgrade guide;
- release-boundary backup and restore certification on the supported deployment shape, including restore-then-upgrade, mid-session safety, the aggregate integrity audit, and the 1.0 runbook revision;
- complete-catalog regression: canonical census, aggregated zero-gap regression, documentary-read prohibition proof, mechanics-registry finality sweep, golden-journey revalidation, and the 1.0 release golden journey;
- distribution and repository presentation review with explicit owner dispositions for documentary trees, licensing, and notices;
- release notes, changelog, the reproducible release command, built-artifact audits, clean-host and full-release rehearsals;
- final acceptance: bounded full validation, traced desktop/mobile production liveplay, the release restore drill, the zero-unresolved-row sweep, the owner go/no-go, the atomic 1.0 transaction, released-identity verification, and archival;
- defect repairs surfaced by release matrices, executed only through the authorities that own the defective behavior.

## Explicit non-goals

- New core mechanics, gameplay subsystems, content packs, setting packs, supplements, or playtest material.
- Reinterpreting canonical PTU facts from books, markdown, PDFs, parser output, websites, or wikis.
- Public authentication, multi-tenancy, federation, matchmaking, or public-service hardening.
- Replacing SQLite, ordinary sheets, maps, Encounter Documents, liveplay commands, settlement, campaign attention, or domain realtime.
- A desktop installer, npm-published package, hosted SaaS offering, mobile-native application, or app-store distribution; the distributable is the tagged source repository plus the documented production build.
- Artifact signing or attestation infrastructure beyond checksums and the provenance record (activation decision 8).
- Claiming legal approval through automation; licensing, notice, documentary-tree, and go/no-go dispositions require explicit owner review.

## Completion states for release-gate rows

Every release-gate row registered under the P13-002 rubric must end in exactly one reviewed state:

- **Certified** — proven by executable, replayable evidence bound to fixture or artifact hashes.
- **Approved** — the row required an explicit owner disposition, and that disposition is recorded in the ledger or a reviewed artifact.
- **Documented boundary** — a reviewed known limitation registered in P13-009 and rendered into the release notes; never valid for core-mechanic, licensing, migration, or critical-usability rows.
- **Repaired** — a defect exposed by a release matrix was fixed through the authority that owns the behavior and then re-certified there.
- **Blocked** — required evidence, authority, or an owner decision is missing. Temporary work state; forbidden at final acceptance.

A row is not complete because prose says so. Certification means the bound command or fixture replays green at the release commit.

## Non-negotiable release rules

1. A release promise must be executable evidence, not prose alone.
2. Upgrade and restore tests operate on copies and commit atomically or not at all.
3. No release command may access documentary PTU sources at runtime or package private campaign material.
4. Frozen prior-plan evidence changes only through a contiguous reviewed successor chain.
5. Complete-catalog regression may reveal defects but may not silently change canonical identities or mechanics.
6. Product phase, version, tag, notes, checksums, provenance, and machine-readable acceptance must agree.
7. Zero unresolved `Blocked`, deferred, definition-missing, visible-with-reason core mechanic, licensing, migration, or critical usability row may pass 1.0 acceptance.
8. Local hosting remains deprecated; supported workflows must pass production-build liveplay.
9. Release identity is minted through the version policy exactly once per release; no out-of-band version, tag, or phase edits.
10. Licensing, notice, documentary-tree, and go/no-go dispositions are explicit owner decisions; automation may inventory and flag but never approve.

## Activation decision record

The ten activation questions from the scope draft, resolved against repository evidence on 2026-08-26. The baseline artifact binds the observed sources; dispositions reserved to the owner are structured as explicit review tickets and fail closed until recorded.

1. **Version identity.** Semantic versioning `MAJOR.MINOR.PATCH` with one source of truth: the `package.json` version field. A shared release-identity module derives every other surface: server identity reporting (health/version), a GM-discoverable UI surface, build provenance, release notes, and annotated git tags `vMAJOR.MINOR.PATCH` on `main` (origin `github.com/prodmodfour/rotom-table`). Trunk-based policy: no long-lived release branches; post-1.0 fixes tag `v1.0.x` from `main`. Release-candidate discipline: plumbing ships as `1.0.0-rc.N`; `1.0.0` is minted exactly once inside the P13-084 release transaction. Today no version surface exists at all (baseline rows `no-package-version`, `no-git-tags`, `no-changelog`, `versionless-health`), so all surfaces are new and start in agreement.
2. **Supported upgrade inputs.** Three promised families: (a) fresh or empty campaign roots; (b) any campaign SQLite database produced by this app at schema versions 1–55, upgrading through the contiguous chain to the release schema — Plan 12 certified v50 exact-byte and v51–v55 heads; this plan generates deterministic head fixtures for v1–v55 by prefix-application of the chain plus seeded representative data at reviewed boundary heads; (c) documented JSON-era campaign roots through the existing `npm run migrate:sqlite` import with its pre-migration backup. Unknown, corrupt, partial, or future-version inputs are rejected before any write.
3. **Migration beyond v56.** The release targets schema v56. New migrations are permitted only as reviewed defect repairs surfaced by release matrices; any successor extends the same contiguous chain and re-runs the full upgrade matrix and backup/restore certification at the new head before acceptance. Downgrade is unsupported by design: the rollback boundary is the pre-upgrade backup restored exactly (P13-029), documented in the upgrade guide and release notes.
4. **Supported 1.0 matrix.** Private Linux x86-64 VPS running the production Nitro build (`npm run build` / `npm run start`) under systemd behind an outer access gate, with campaign storage under `ROTOM_CAMPAIGN_ROOT`, hosted writes via `ROTOM_ENABLE_HOSTED_WRITES=1`, and the local production-like workspace for rehearsal; Node 24.x with npm per `engines`; browsers certified as the Playwright Desktop Chrome and Pixel 7 projects against the production build; database backup via the SQLite online `.backup` API or stopped-service copy per `docs/private-vps-backups.md`. Local `nuxt dev` hosting stays deprecated and outside the support promise.
5. **Complete-catalog cohorts.** Catalog completeness is data-level and exhaustive: one aggregated release regression binds every existing per-domain completeness, drift, migration, and fixture audit across the fourteen canonical files plus natures, and a canonical census artifact records per-file row counts and SHA-256 hashes. Runtime proof is journey-level and bounded: the reviewed golden campaigns from Plans 6–12 replayed at the release commit, plus one new 1.0 release golden journey spanning onboarding → campaign play → encounter → settlement → breeding → contest → GM preparation → launch → restart → restore. Per-canonical-row end-to-end liveplay is explicitly out of scope as unbounded; per-row legality remains owned by the domain audits.
6. **Distribution boundary.** The distributable is the tagged source repository plus the documented production build produced from it; no npm package, installer, or hosted artifact. Always included: app code, app-owned `data/`, docs, deploy templates, schemas, public assets, and the reviewed `.pi/ui-mockup-style.md` contributor configuration. Always excluded: campaign databases, env files and secrets, Playwright reports/results/traces, generated `.pi/logs/`, `.pi/artifacts/`, and `.pi/refactor-loop.lock/` state, and local backup/campaign/log/run directories (already git-ignored; re-audited in P13-059). Documentary and provenance trees (`books/`, `ptu-data/`, `encounter_tables/`, `trainer_sizes/`, `pokesheet.pdf`, `notepad/`) are currently tracked and are bound by source-hash provenance in reviewed migrations; their release disposition (retain-labelled versus prune) is an explicit owner decision in P13-058 — no silent removal, because pruning would break provenance-hash bindings without a reviewed successor chain. The built `.output` bundle must scan clean of secrets and campaign material (P13-072).
7. **Licensing dispositions.** Present today: scope-limited MIT `LICENSE`, `NOTICE.md`, `docs/fan-project-notice.md`, `SECURITY.md`, `CONTRIBUTING.md`. This plan inventories npm and Python dependencies (P13-060), fonts, sprites, and media including the `trainer_sizes/` and `public/` third-party assets (P13-061), and PTU-derived data and documentary text, then obtains one explicit owner disposition per family — fan-content posture, PTU text posture, sprite/media posture, dependency attributions, license scope (P13-062). Automation inventories and flags; the owner approves; unresolved items fail the release gate under rule 7.
8. **Build provenance.** Mandatory: a clean-tree annotated tag on a commit with green CI; recorded Node and npm versions; `npm ci` lockfile integrity; a machine-readable provenance record (commit SHA, tag, builder versions, build command, environment posture) generated by the release command; SHA-256 checksums of the release build output; and the bounded quality-gate result at the release commit. Optional and deferred: signing and attestation — no signing authority exists in the repository and minting one is not a 1.0 requirement.
9. **Known limitations versus blockers.** Acceptable documented boundaries (P13-009 register, rendered into notes in P13-070): the trusted-table GM/Player picker is not public authentication; the supported deployment is a single private VPS per campaign group; Chromium-family browser certification only; supplements and expansion packs are post-1.0; local hosting is deprecated; downgrades are unsupported beyond restored backups. Release blockers: any rule-7 row. The register is the boundary contract — anything failing a gate that is not on the register is a blocker until explicitly reviewed.
10. **Ticket structure.** 86 tickets across 8 phases. The release-rehearsal slice is gated at the Phase 7 exit (P13-076): a complete rc-identity rehearsal on a clean host must pass before Phase 8 final acceptance begins. The owner holds two explicit in-plan decisions besides dispositions: the go/no-go review (P13-083) and the start gate on this ledger. The machine-readable acceptance artifact is `data/release-readiness/final-acceptance.v1.json`; the atomic release transaction (P13-084) mints version, tag, notes, checksums, provenance, `PRODUCT_PHASE`, and acceptance together in one reviewed release commit.

## Target architecture

```text
frozen Plans 1-12 authority (schema v56, canonical reference, quality gates)
  -> release baseline + rubric + inventories (drift-gated artifacts)
  -> release identity authority
       (single-source version, server/UI reporting, build provenance)
  -> release guarantee matrices
       (historical upgrades v1-v55 + JSON-era import,
        backup/restore/restart, complete-catalog regression,
        golden-journey revalidation + 1.0 release journey)
  -> distribution and notices review
       (repository presentation, tracked-tree dispositions,
        licensing/attribution inventories, owner approvals)
  -> release notes + changelog + reproducible release command + checksums
  -> clean-host install and full-release rehearsal (rc identity)
  -> bounded full validation + traced desktop/mobile production liveplay
  -> owner go/no-go
  -> atomic 1.0 transaction
       (version mint, tag, notes, provenance, PRODUCT_PHASE, acceptance)
  -> released-identity verification -> archived ledger + post-1.0 boundary
```

## Release rehearsal slice

> From a clean clone of the release-candidate commit, one operator following only the published documentation installs, builds, and starts the supported production shape; upgrades a copied pre-1.0 campaign backup through the certified chain; restores and restarts it exactly; opens desktop and mobile liveplay against it; and runs the release command to produce a checksummed, provenance-recorded, locally rc-tagged rehearsal release — with every version surface agreeing and no private material in any artifact.

The slice must be complete at the Phase 7 exit before Phase 8 final acceptance begins.

## Plan update protocol

- Work tickets strictly in order within a phase; do not open a later phase before the earlier phase's exit gate passes.
- Update each ticket's status marker and `CURRENT_TICKET` as work proceeds; record evidence on the ticket when it completes.
- Keep `implementation-plans/plan-order.md` and `AGENTS.md` synchronized whenever ticket counts, current execution, dependencies, or plan status change.
- Follow the workspace validation discipline: focused tests during implementation, bounded workers, full suites only at integration milestones and closure.
- Record every material decision — especially every owner disposition — in the decision log.

## Progress snapshot

| Phase | Tickets | Done |
| --- | --- | ---: |
| 1 — Activation adoption, rubric, inventories, gates | P13-001–P13-010 | 10/10 |
| 2 — Versioning and release identity | P13-011–P13-020 | 10/10 |
| 3 — Campaign upgrade guarantee | P13-021–P13-032 | 12/12 |
| 4 — Release-boundary backup and restore | P13-033–P13-042 | 10/10 |
| 5 — Complete-catalog regression and mechanics finality | P13-043–P13-052 | 10/10 |
| 6 — Distribution, presentation, licensing, notices | P13-053–P13-066 | 14/14 |
| 7 — Release notes, artifacts, and rehearsal | P13-067–P13-076 | 7/10 |
| 8 — Final acceptance and the 1.0 transition | P13-077–P13-086 | 0/10 |
| **Total** | | **73/86** |

## Tickets

### Phase 1 — Activation adoption, release rubric, inventories, and gates

- [x] **P13-001 — Adopt and freeze the release baseline** — `DONE`
  - Verify `data/release-readiness/release-baseline.v1.json` (20 rows, SHA-256 above) against the live repository; promote its generator into a checked script with a `--check` mode.
  - Register the baseline in a drift gate so silent changes to inventoried release surfaces fail validation.
  - Evidence: `scripts/release-readiness/generate-phase-1.mjs --check` verifies the pinned commit census, 20 unique rows, historical facts, and exact frozen SHA-256.
- [x] **P13-002 — Define the release-gate rubric** — `DONE`
  - Bind every release-gate row (identity, upgrade, backup, catalog, distribution, licensing, notes, provenance, acceptance, transition) to one reviewed final state from the completion-state vocabulary with a zero-gap rule.
  - Forbid closing any row by prose alone or by downgrading a guarantee to narrative documentation.
  - Evidence: `data/release-readiness/release-gate-rubric.v1.json` registers 67 rows across all 10 required families and enforces the final-state vocabulary and zero-gap rules.
- [x] **P13-003 — Build the version-surface inventory** — `DONE`
  - Enumerate every surface that must carry or report release identity: package metadata, server reporting, UI presentation, build provenance, docs badges, notes, tags — with agreement rules between them.
  - Record the inventory machine-readably; absence of a required surface is a failing row, not a gap.
  - Evidence: `data/release-readiness/version-surface-inventory.v1.json` records nine mandatory agreement surfaces and an absence-is-failure rule.
- [x] **P13-004 — Fix the supported-platform matrix** — `DONE`
  - Encode activation decision 4 (OS/deployment shape, Node range, npm, browser projects, backup methods, env gates) as a reviewed fixture.
  - Everything outside the matrix is explicitly unsupported; the fixture is the single source for docs and rehearsals.
  - Evidence: `data/release-readiness/supported-platform-matrix.v1.json` fixes the Linux x86-64, Node 24, npm, Nitro/systemd, Chromium, env-gate, and SQLite backup contract.
- [x] **P13-005 — Fix the supported-upgrade-input index** — `DONE`
  - Encode activation decision 2's three input families with fixture identities: v1–v55 historical heads, exact-byte boundary samples, JSON-era roots, and the rejection corpus (corrupt, partial, future-version, non-database).
  - Bind the index to the rubric so every promised input maps to a certification row.
  - Evidence: `data/release-readiness/supported-upgrade-inputs.v1.json` explicitly indexes all 55 historical heads, fresh/JSON-era families, byte boundaries, and the rejection corpus.
- [x] **P13-006 — Draft the distribution and exclusion inventory** — `DONE`
  - Classify every tracked tree (runtime, canonical, documentary/provenance, deploy, docs, evidence, tooling) and record the always-excluded register from activation decision 6.
  - Mark anomaly candidates (working notes, PDFs, third-party asset trees) for the Phase 6 owner dispositions; take no disposition here.
  - Evidence: `data/release-readiness/distribution-inventory.v1.json` records eight classes, the always-excluded register, and six unresolved anomaly families without taking an owner decision.
- [x] **P13-007 — Draft the licensing and attribution inventory** — `DONE`
  - Enumerate disposition families: license scope, fan-content posture, PTU-derived data and documentary text, sprites/media/fonts, npm and Python dependencies, existing notices.
  - Record every family as explicitly `UNRESOLVED` pending owner review; automation may flag but not approve.
  - Evidence: `data/release-readiness/licensing-attribution-inventory.v1.json` records seven explicitly `UNRESOLVED` owner-review families and forbids automated approval.
- [x] **P13-008 — Define release evidence schemas and check commands** — `DONE`
  - Define the artifact schemas for certifications, rehearsal records, dossier, and final acceptance under `data/release-readiness/`.
  - Register bounded `check:release-readiness*` commands without widening full-suite requirements.
  - Evidence: four JSON schemas, `evidence-command-index.v1.json`, and focused package commands are registered under `data/release-readiness/`.
- [x] **P13-009 — Register known limitations and post-1.0 boundaries** — `DONE`
  - Record activation decision 9's documented boundaries as a reviewed register distinguishing boundaries from blockers.
  - Anything failing a gate that is not on the register is a blocker until explicitly reviewed onto it.
  - Evidence: `data/release-readiness/known-limitations.v1.json` contains exactly the six activation-approved boundaries; its freeze policy leaves all unregistered failures blocking.
- [x] **P13-010 — Phase acceptance and drift wiring** — `DONE`
  - All Phase 1 artifacts reviewed, hashed, drift-gated, and registered in the quality path.
  - Phase-exit evidence recorded; rubric shows zero unregistered gate families.
  - Evidence: `data/release-readiness/phase-1-acceptance.v1.json` binds all generated artifact hashes; `npm run check:release-readiness:phase1` passes and is wired into `scripts/quality-gate.sh`.

### Phase 2 — Versioning and release identity

- [x] **P13-011 — Adopt the version policy** — `DONE`
  - Record activation decision 1 as the reviewed policy: semver rules, single source of truth, rc discipline, annotated-tag convention on `main`, post-1.0 fix policy, and the exactly-once mint rule.
  - Bind the policy to the rubric; out-of-band version edits become a failing gate.
  - Evidence: `version-policy.v1.json`, `docs/release/versioning.md`, the mint ledger, and `check-identity.mjs` enforce SemVer, trunk tags, sequential RCs, and immutable tags.
- [x] **P13-012 — Implement the single-source release identity module** — `DONE`
  - Add the `package.json` version field and a shared release-identity module deriving version plus storage schema version; no duplicated version literals anywhere.
  - Dev builds resolve identity without a release; missing identity at release time fails closed.
  - Evidence: `shared/release/identity.ts` derives the version only from package metadata; Nuxt derives schema v56 from the migration authority and marks incomplete dev provenance explicitly.
- [x] **P13-013 — Implement server identity reporting** — `DONE`
  - Extend health/version reporting with version, storage schema version, and build identity, role-safe for every audience.
  - No campaign data, secrets, or private paths in any identity payload.
  - Evidence: `/api/health` and `/api/version` returned the same rc.1 version, schema, commit, tag, command, and builder fields in a production build; focused privacy assertions pass.
- [x] **P13-014 — Implement the user-visible version surface** — `DONE`
  - A GM-discoverable About/version presentation per the design authority, sourced from the identity module.
  - Role-safe, accessible, and free of private diagnostics; follows the UI design workflow.
  - Evidence: the Settings Workshop exposes a semantic About definition list to GM and Player roles; desktop and 412px production browser checks show rc.1/schema v56/commit, zero overflow, and zero console errors. Image generation was skipped because this was an exact mechanical addition using the established Settings group anatomy.
- [x] **P13-015 — Implement build-time provenance embedding** — `DONE`
  - Capture commit, build command, and builder versions at build time without breaking dev workflows.
  - Missing provenance degrades explicitly in dev and fails closed in the release command, never silently.
  - Evidence: `nuxt.config.ts` embeds commit/tag/command/Node/npm posture; `ROTOM_RELEASE_BUILD=1` rejects incomplete or disagreeing values.
- [x] **P13-016 — Prove version-surface agreement** — `DONE`
  - Tests prove package metadata, server reporting, UI surface, and embedded provenance agree, in dev and production builds.
  - Register the agreement check as a drift gate; disagreement anywhere fails validation.
  - Evidence: `releaseIdentityAgreement.test.ts`, `healthEndpoint.test.ts`, and `check-identity.mjs` pass and are wired into `check:release-readiness`.
- [x] **P13-017 — Mint the release-candidate identity** — `DONE`
  - Set `1.0.0-rc.1` exactly once through the policy; record the mint in the decision log.
  - Guard tests forbid out-of-band edits to the version source.
  - Evidence: the mint authority recorded the exactly-once `NONE → 1.0.0-rc.1` transition in `version-mints.v1.json`; package and lock metadata agree.
- [x] **P13-018 — Implement checksum and provenance record generation** — `DONE`
  - A bounded command produces SHA-256 checksums of the release build output plus the machine-readable provenance record per activation decision 8.
  - Records are deterministic given the same inputs; secrets and campaign material are structurally absent.
  - Evidence: `generate-build-evidence.mjs` generated and rechecked 13,657 sorted file checksums (manifest SHA-256 `85fa6b9b…`) plus allowlisted provenance with no secret/private fields.
- [x] **P13-019 — Rehearse annotated tagging** — `DONE`
  - Rehearse the tag convention with a local annotated rc tag proving tag/commit/version/CI agreement; tag publication remains owner-controlled.
  - Record the rehearsal evidence and the divergence-handling procedure.
  - Evidence: local annotated tag `v1.0.0-rc.1` points to candidate commit `863b1a0e…`; `--require-tag` agreement passes and `docs/release/versioning.md` forbids mutation in favor of a next RC.
- [x] **P13-020 — Version identity acceptance** — `DONE`
  - End-to-end identity agreement in a production build at the rc identity; all Phase 2 rubric rows `Certified`.
  - Phase-exit evidence recorded.
  - Evidence: `data/release-readiness/version-identity-certification.v1.json` binds the candidate commit/tree/tag, build manifest, provenance hash, focused checks, and production desktop/mobile observations; all nine identity rows are `Certified`.

### Phase 3 — Campaign upgrade guarantee

- [x] **P13-021 — Build the historical-head fixture generator** — `DONE`
  - Generate deterministic v1–v55 head databases by prefix-application of the contiguous chain, with seeded representative data at reviewed boundary heads.
  - Fixtures are reproducible, hash-recorded, and never derived from private campaigns.
  - Evidence: `generate-historical-heads.ts --check` reproduces 55 prefix heads and their canonical logical SHA-256 descriptors from synthetic authority only.
- [x] **P13-022 — Certify the full historical upgrade matrix** — `DONE`
  - Every promised head v1–v55 upgrades to the release schema with contiguity, single-application, and post-upgrade integrity audits, under bounded one-worker runs.
  - Failures are defects to repair through owning authorities, never matrix exclusions.
  - Evidence: `releaseHistoricalUpgradeMatrix.test.ts` upgrades all 55 heads through the contiguous v56 chain, verifies idempotence, integrity, and zero FK violations.
- [x] **P13-023 — Certify exact-byte preservation samples** — `DONE`
  - Extend the Plan 12 v50 exact-byte proof pattern to reviewed earlier boundary heads: authority documents survive upgrade byte-exactly where the chain promises preservation.
  - Deviations are contradictions, not tolerances.
  - Evidence: the 11 reviewed heads (v1, v5, v12, v21, v28, v41, v44–v46, v50, v55) preserve seeded map and Trainer JSON bytes exactly.
- [x] **P13-024 — Certify JSON-era campaign import** — `DONE`
  - The documented `migrate:sqlite` path on fixture roots: pre-migration backup created, atomic import, resulting database at the release schema, no documentary reads.
  - Malformed roots fail closed with exact reasons and no partial writes.
  - Evidence: the release wrapper stages, advances, audits, and atomically installs v56; representative, rerun, malformed-root, and interruption fixtures pass.
- [x] **P13-025 — Certify rejection of unsupported inputs** — `DONE`
  - Corrupt files, partial databases, unknown and future schema versions, and non-database files are rejected before any write.
  - Rejection messages state the supported boundary and the recovery procedure.
  - Evidence: `releaseCampaignUpgradeSafety.test.ts` proves byte-exact rejection of non-SQLite, corrupt, partial, schema-zero, and future-v57 inputs.
- [x] **P13-026 — Certify interrupted-upgrade behavior** — `DONE`
  - Injected interruption at every migration boundary leaves the original database intact or the upgrade complete — never partial.
  - Re-running after interruption converges to the release schema exactly once.
  - Evidence: injected post-migration failures at all 56 boundaries roll back their transaction; staged file failure leaves the original digest intact and rerun converges.
- [x] **P13-027 — Certify sidecar and contention behavior** — `DONE`
  - Upgrades with WAL/SHM sidecars present, read-only filesystems, and locked or concurrently opened databases behave fail-closed with no corruption.
  - Document the operator-facing behavior for each case.
  - Evidence: sidecar, permission, and exclusive-lock corpus passes with exact original hashes; recovery is documented in `docs/release/upgrade.md`.
- [x] **P13-028 — Enforce upgrade performance bounds** — `DONE`
  - A reviewed large-campaign fixture upgrades within a recorded budget on the supported shape.
  - The budget is a fixture, not a hope; regressions fail the gate.
  - Evidence: 10,000 maps plus 10,000 Trainer sheets with 512-byte payloads upgrade from v1 within the frozen 15-second one-worker budget.
- [x] **P13-029 — Prove the rollback boundary** — `DONE`
  - A restored pre-upgrade backup returns exact pre-upgrade authority; downgrade attempts on upgraded databases fail closed with explicit guidance.
  - The boundary statement in docs matches the proven behavior verbatim.
  - Evidence: backup and restored database SHA-256 equal the original; CLI downgrade options fail closed; artifact and guide share the verbatim restore-only statement.
- [x] **P13-030 — Write the operator upgrade guide** — `DONE`
  - Supported inputs, procedure, verification, rollback boundary, and troubleshooting, synchronized with the runbooks and the platform matrix.
  - The guide references only certified behavior.
  - Evidence: `docs/release/upgrade.md` documents stopped-service v1–v56, JSON-era, verification, rollback, sidecar, contention, and rejection procedures.
- [x] **P13-031 — Record the upgrade certification artifact** — `DONE`
  - Machine-readable certification binding fixture hashes, matrix outcomes, budgets, and evidence commands.
  - Registered in the drift gate.
  - Evidence: `upgrade-certification.v1.json` binds ten source hashes and all nine upgrade gate rows; the shared certification checker is wired into `check:release-readiness:upgrades`.
- [x] **P13-032 — Upgrade guarantee acceptance** — `DONE`
  - Every supported-upgrade-input row `Certified`; zero partial-write paths anywhere in the matrix.
  - Phase-exit evidence recorded.
  - Evidence: `npm run check:release-readiness:upgrades` passes 13 focused tests plus the 55-head drift generator and certification hash gate under one worker.

### Phase 4 — Release-boundary backup and restore

- [x] **P13-033 — Certify online backup under live writes** — `DONE`
  - The SQLite online `.backup` method under active WAL writes on the supported shape; archive completeness includes the database, residual campaign files, and the settings inventory.
  - Backups taken mid-write restore to a consistent, integrity-clean state.
  - Evidence: `releaseBackupRestoreCertification.test.ts` drives a worker writing WAL authority while Node's SQLite backup API snapshots; fresh-host integrity and JSON/database revision consistency pass.
- [x] **P13-034 — Certify stopped-service backup** — `DONE`
  - The documented stopped-service copy method produces an equivalent restorable archive.
  - Both methods yield archives the restore drill accepts interchangeably.
  - Evidence: stopped copy takes an exclusive lock, copies authority and sidecars, and passes the same manifest-verified restore/restart drill as online archives.
- [x] **P13-035 — Certify restore to a fresh host** — `DONE`
  - A restored archive on a clean supported host recovers campaign authority exactly, including signing secrets, realtime durability rows, and pending private state; restart is inert.
  - No direct JSON or database repair is required at any step.
  - Evidence: synthetic map, private pending response, Toolkit signing secret, residual note, and settings restore exactly; reopen leaves v56 and all tracked bytes/counts unchanged.
- [x] **P13-036 — Certify restore-then-upgrade** — `DONE`
  - A pre-release backup restored onto the release build upgrades through the certified chain and passes the integrity audit.
  - The combined path is documented as the supported recovery-into-1.0 route.
  - Evidence: a v28 archive restores, upgrades atomically through v56, and passes the aggregate release integrity audit.
- [x] **P13-037 — Certify mid-session backup safety** — `DONE`
  - Pending prompts, response windows, and private resolution rows survive backup/restore per the documented WAL-safety rules; the maintenance-export boundary is re-proven at the release baseline.
  - Unsafe copy procedures are documented as explicitly unsupported.
  - Evidence: pending response authority round-trips under active WAL writes; `exportSqliteJson.test.ts` re-proves terminal abandonment for the separate lossy maintenance export.
- [x] **P13-038 — Implement the release-boundary integrity audit** — `DONE`
  - One bounded command aggregating PRAGMA integrity/FK checks and the existing per-domain storage audits across all campaign families.
  - Injected damage fails the audit; the command is registered in the release gates.
  - Evidence: `npm run audit:campaign` checks exact schema, nine storage families, every table/JSON column, signing authority, and the Toolkit audit; malformed JSON and missing-table injection fail.
- [x] **P13-039 — Audit archive contents and privacy handling** — `DONE`
  - Archives contain exactly the documented private material and nothing outside the campaign trust boundary; handling guidance covers storage and transfer of private archives.
  - No secret is required outside the documented settings inventory to fully recover a host.
  - Evidence: release archives reject symlinks/special files and contain exactly database, campaign root, explicit setting labels, manifest, and no private values in reports; archives remain mode 0600.
- [x] **P13-040 — Revise the backup runbook for 1.0** — `DONE`
  - Release-boundary procedure, retention guidance, restore smoke drill, and the restore-then-upgrade route, synchronized with the platform matrix and upgrade guide.
  - The runbook references only certified behavior.
  - Evidence: `docs/private-vps-backups.md` leads with certified online/stopped commands, hash-verified fresh restore, aggregate audit, retention/privacy, and restore-then-upgrade.
- [x] **P13-041 — Record the backup/restore certification artifact** — `DONE`
  - Machine-readable certification binding archive fixtures, drill outcomes, and audit results.
  - Registered in the drift gate.
  - Evidence: `backup-restore-certification.v1.json` binds nine source hashes, synthetic fixture inventory, both methods, drill outcomes, damage corpus, and eight rubric rows.
- [x] **P13-042 — Backup and restore acceptance** — `DONE`
  - Every backup/restore rubric row `Certified` on the supported shape.
  - Phase-exit evidence recorded.
  - Evidence: `npm run check:release-readiness:backup` passes the certification drift gate and 27 bounded tests across release, prior-domain, maintenance-export, and docs coverage.

### Phase 5 — Complete-catalog regression and mechanics finality

- [x] **P13-043 — Record the canonical census** — `DONE`
  - Per-file row counts and SHA-256 hashes for the fourteen canonical reference files plus the nature chart, as a reviewed census artifact in the drift gate.
  - Census changes require a reviewed successor, never a silent regeneration.
  - Evidence: `canonical-census.v1.json` hash-binds 14 JSON files plus `PTU_NATURE_CHART`, with 4,810 rows; its deterministic generator passes `--check`.
- [x] **P13-044 — Aggregate the complete-catalog regression** — `DONE`
  - One bounded release regression command binding every existing per-domain completeness, drift, migration, and fixture audit, producing a zero-gap report artifact.
  - Any canonical row unreachable by its owning audit is a failing gap.
  - Evidence: `check:release-readiness:catalog` aggregates all domain checks; `canonical-audit-reachability.v1.json` and its test visit all 4,810 rows with zero unreachable rows.
- [x] **P13-045 — Prove the documentary-read prohibition** — `DONE`
  - Static and runtime proof that no production code path reads `books/`, `ptu-data/`, `encounter_tables/`, or other documentary trees.
  - The proof is a registered gate, not a one-off grep.
  - Evidence: the obsolete Pokédex books restore route/UI was retired; a 2,677-file static graph check plus `strace` runtime probe loads all 15 canonical authorities with zero documentary opens. This exact mechanical UI removal required no mockup.
- [x] **P13-046 — Sweep mechanics-registry finality** — `DONE`
  - Machine-check that every registry row across Plans 1–12 remains in a reviewed final state: zero `Blocked`, deferred, definition-missing, or visible-with-reason core mechanic rows anywhere.
  - Discovered drift is a defect through the owning authority.
  - Evidence: 2,457/2,457 rows across 11 registries are final; Plan 13 source evolution is recorded as contiguous accepted successors without rewriting archived evidence or mechanics semantics.
- [x] **P13-047 — Re-validate prior golden journeys** — `DONE`
  - The reviewed server-level golden campaigns from Plans 6–12 replay green at the release baseline under bounded runs.
  - Frozen evidence stays frozen; only replay outcomes are recorded.
  - Evidence: seven prior journey files replay 33/33 tests green under one worker; `release-golden-replay-report.v1.json` records outcomes without changing frozen journey evidence.
- [x] **P13-048 — Implement the 1.0 release golden journey** — `DONE`
  - One server-level journey spanning onboarding → campaign play → encounter → settlement → breeding → contest → GM preparation → launch → restart → restore, deterministic and fixture-bound.
  - The journey exercises release-boundary behavior (identity reporting, restored storage) alongside gameplay authority.
  - Evidence: `releaseGoldenJourney.test.ts` executes all ten ordered fixture checkpoints, verifies rc identity/v56, aggregate and Toolkit audits, inert restart, and digest-exact fresh-host restore.
- [x] **P13-049 — Sweep structural privacy audits** — `DONE`
  - Existing structural privacy audits replay green; one aggregate release privacy report binds their outcomes.
  - Any projection regression is a blocker under rule 7.
  - Evidence: 115/115 tests across 19 files and nine projection families pass; `release-privacy-report.v1.json` records zero projection regressions and zero leaks.
- [x] **P13-050 — Sweep performance budgets** — `DONE`
  - Existing reviewed performance budgets replay green at the release baseline under bounded one-worker runs.
  - Budget regressions are defects, not new baselines.
  - Evidence: 88/88 budget tests across 19 files pass under one worker with zero regressions and zero rebased budgets.
- [x] **P13-051 — Record the catalog regression certification artifact** — `DONE`
  - Machine-readable certification binding census hashes, regression outcomes, journey results, and sweep evidence.
  - Registered in the drift gate.
  - Evidence: `catalog-regression-certification.v1.json` binds 14 source artifacts/files and all seven catalog rubric rows; shared certification drift checking passes.
- [x] **P13-052 — Catalog and finality acceptance** — `DONE`
  - Zero-gap report clean; all Phase 5 rubric rows `Certified`.
  - Phase-exit evidence recorded.
  - Evidence: the aggregate records zero canonical, registry, documentary, journey, privacy, performance, or hard gaps; all registered component commands passed in bounded runs.

### Phase 6 — Distribution, repository presentation, licensing, and notices

- [x] **P13-053 — Review and refresh the repository landing** — `DONE`
  - `README.md` states the truthful product: Nuxt 4, SQLite-authoritative, liveplay-only, supported platform matrix, version identity, trusted-table posture; the quick start leads with the supported production shape and labels dev workflows as development-only.
  - Badges and claims match reality; no stale framework, persistence, or hosting statements survive.
  - Evidence: `repository-presentation-certification.v1.json` binds the refreshed landing and `npm run check:release-readiness:presentation` rejects stale framework, persistence, hosting, identity, and support claims.
- [x] **P13-054 — Review the documentation index and entry points** — `DONE`
  - `docs/README.md` and entry points present coherent operator, GM, player, and contributor paths at 1.0; retired-seam documents are marked historical.
  - Every referenced command and route exists at the release commit.
  - Evidence: the presentation gate resolves every local link in the three release entry documents and asserts the supported route sources; zero missing links or routes.
- [x] **P13-055 — Refresh screenshots and presentation assets** — `DONE`
  - Current-UI screenshots produced through the documented capture workflow; stale imagery replaced or retired.
  - No screenshot leaks private campaign material.
  - Evidence: three 1440×960 production-build Chromium captures in `docs/screenshots/` are SHA-256-bound by `docs/screenshots.md`; fresh synthetic campaign input, zero private content, and zero capture-page console errors are recorded.
- [x] **P13-056 — Review package and repository metadata** — `DONE`
  - `package.json` name, description, license, engines, private flag, and repository field agree with the release identity and distribution posture.
  - Repository description and topics (owner-applied) are recorded as a disposition if changed.
  - Evidence: package and lock metadata pass the presentation gate; `repository-metadata-disposition.v1.json` records the authenticated remote update from Nuxt 3/JSON/local-first claims to Nuxt 4/SQLite/private-VPS liveplay claims and removes the stale topics.
- [x] **P13-057 — Classify every tracked tree** — `DONE`
  - Apply the P13-006 inventory to the full tracked file set; every tree lands in exactly one class with zero unclassified files.
  - Anomalies (working notes, PDFs, third-party asset trees) are queued for P13-058 with exact contents and provenance-hash consequences.
  - Evidence: `tracked-tree-policy.v1.json` and `tracked-tree-inventory.v1.json` classify 16,864 paths across 47 top-level entries into five classes with zero missing or ambiguous paths; all nine anomalies carry exact path/content-set hashes and the six P13-058 candidates carry explicit prune consequences.
- [x] **P13-058 — Owner disposition: documentary and provenance trees** — `DONE`
  - The owner explicitly decides retain-labelled versus prune for `books/`, `ptu-data/`, `encounter_tables/`, `trainer_sizes/`, `pokesheet.pdf`, and `notepad/`, honoring provenance-hash bindings; execute the recorded decision through reviewed changes only.
  - No silent removal or retention; the decision and its rationale enter the decision log.
  - Evidence: the owner accepted the reviewed recommendation: retain-and-label `books/`, `ptu-data/`, `encounter_tables/`, and `trainer_sizes/`; prune `pokesheet.pdf` and `notepad/`. `documentary-tree-disposition.v1.json` preserves every pre-decision path/content hash and rationale; labels are installed and both pruned paths are absent.
- [x] **P13-059 — Audit ignore rules and private artifacts** — `DONE`
  - Prove ignore-rule completeness for campaign data, env files, evidence artifacts, and local workspaces; prove zero tracked private or secret files; document clean-clone hygiene.
  - The audit is a registered command, not a manual pass.
  - Evidence: `npm run check:release-readiness:private-artifacts` audits 16,875 candidate paths, 29 required ignore probes, 10 reviewed tracked exceptions, disguised SQLite headers, forbidden filenames, owner-pruned tombstones, and strengthened provider-token patterns with zero findings; clean-clone practice is documented in `docs/release/source-tree-hygiene.md`.
- [x] **P13-060 — Inventory dependency licenses** — `DONE`
  - npm and Python dependency license report with flagged copyleft, unknown, and incompatible entries.
  - Flags feed P13-062; the report is reproducible.
  - Evidence: `dependency-license-report.v1.json` uniquely inventories all 971 npm lock instances and six Python rows. One missing npm metadata value is hash-resolved to MIT; zero unknown or mandatory incompatible-copyleft rows remain, while 22 MPL/attribution/dual-license/unpinned-Python owner-review flags feed P13-062.
- [x] **P13-061 — Inventory fonts, sprites, and media assets** — `DONE`
  - Provenance and posture for every shipped visual, audio, and font asset, including `public/` and `trainer_sizes/` third-party material.
  - Unknown-provenance assets are flagged for owner disposition.
  - Evidence: `media-asset-inventory.v1.json` classifies and content-binds all 9,472 source-distribution media files in 14 families plus nine CSS imports and 18 OFL font binaries; zero media files are unclassified. It flags 29 unknown-provenance files, 7,949 files without an explicit redistribution license, and 1,460 edited Trainer profiles conflicting with the source index's do-not-edit warning.
- [x] **P13-062 — Owner disposition: license and notices** — `DONE`
  - The owner explicitly approves or amends the license scope, `NOTICE.md`, the fan-content notice, dependency attributions, and asset postures; recorded per family.
  - Unresolved families fail the release gate under rule 7; automation approves nothing.
  - Evidence: `licensing-notice-disposition.v1.json` records the owner's acceptance of recommendations 1–4 and 6–8 plus the explicit recommendation-5 risk exception. The 29 unknown-source images were replaced with original Vue/CSS/SVG/canvas work; the complete six-package Python graph is exact-version pinned; generated notices preserve all lock-bound npm root notices and OFL texts; all eight families are owner-approved with zero unknown-provenance media. The retained 1,460 edited Trainer profiles remain a named owner-accepted risk, not automated legal clearance. Focused 13-test, typecheck, lint, production build, desktop/mobile Chromium, favicon, and built-notice checks pass.
- [x] **P13-063 — Review support and contribution boundaries** — `DONE`
  - `SECURITY.md`, `CONTRIBUTING.md`, and support expectations state the trusted-table, single-operator reality at 1.0.
  - No implied public-service or commercial support promises.
  - Evidence: `SECURITY.md` and `CONTRIBUTING.md` now state SQLite/private-root authority, outer-gate requirements, development-only local setup, current complete mechanics gates, synthetic-data rules, and owner-reserved distribution decisions. `docs/support.md` fixes the one-private-VPS/current-release best-effort boundary with no SLA, uptime, hosted service, paid support, recovery service, or public-service promise. `npm run check:release-readiness:support` validates five linked entry documents and the supported-platform fixture.
- [x] **P13-064 — Validate production deployment instructions** — `DONE`
  - The VPS runbook, systemd unit, proxy guidance, and env examples are walked through against a clean supported host; every step works as written.
  - Deviations are fixed in the docs or the deploy templates, not tolerated.
  - Evidence: a source-distribution-only Debian 12 x86-64 host exercised Node 24.15/npm 11.12, explicit dev-tool installation, zero-vulnerability audit, typecheck, production build, hardened systemd 252 start/restart, service-account storage permissions, loopback-only health, and Caddy 2.6 authenticated proxy behavior. Four observed deviations were repaired rather than waived: production-environment dependency omission, production-environment test contamination, the Caddy 2.8-only directive spelling, and unintended automatic local TLS. `deployment-instruction-certification.v1.json` binds 14 deployment authorities, and `npm run check:release-readiness:deployment` passes.
- [x] **P13-065 — Record the distribution manifest and exclusion audit** — `DONE`
  - Machine-readable manifest binding tree classifications, dispositions, exclusion audit results, and notice locations.
  - Registered in the drift gate.
  - Evidence: `distribution-manifest.v1.json` binds all 16,874 source-distribution paths to the final tracked-tree policy and category/rule counts, all six documentary decisions, all eight licensing families, the one named recommendation-5 risk, zero private/secret/exclusion findings, dependency/media summaries, the deployment certification, and nine notice locations. The manifest transparently excludes only its own bytes from the tracked aggregate to avoid self-reference; its generator compares its full deterministic content. `npm run check:release-readiness:distribution` now checks both tree classification and the manifest.
- [x] **P13-066 — Distribution and notices acceptance** — `DONE`
  - Every distribution and licensing rubric row `Certified` or `Approved`; zero `UNRESOLVED` disposition families.
  - Phase-exit evidence recorded.
  - Evidence: `distribution-notices-certification.v1.json` closes all ten distribution/licensing rubric rows (eight `Certified`/`Repaired`, two owner `Approved`) and binds 16 source authorities. The final 16,874-path manifest has nine notice locations, zero exclusion findings, zero unknown dependency licenses, zero unknown-provenance media, zero unresolved families, and exactly one non-cleared 1,460-file recommendation-5 owner-accepted risk. Phase 6 passes through `npm run check:release-readiness:distribution-acceptance`.

### Phase 7 — Release notes, artifacts, and rehearsal

- [x] **P13-067 — Write the changelog spine** — `DONE`
  - A maintained `CHANGELOG.md` recording plan-level history from inception to 1.0 and the convention for future entries.
  - Entries reference guarantees and boundaries, not internal ticket noise.
  - Evidence: `CHANGELOG.md` records all 13 plan-level milestones, the immutable `1.0.0-rc.1` identity foundation, current unreleased release guarantees and boundaries, and a future SemVer/tag/privacy convention. It deliberately does not claim final `1.0.0` before the owner-authorized atomic transaction and contains no implementation ticket IDs. `npm run check:release-readiness:changelog` passes.
- [x] **P13-068 — Write operator release notes** — `DONE`
  - Storage and upgrade guarantees, backup/restore procedures, retired seams, environment and settings requirements, and recovery boundaries.
  - Every statement traces to a certified gate.
  - Evidence: `docs/releases/1.0.0.md` contains nine operator sections covering supported deployment, identity/health, source install, schema-v56 authority, supported SQLite/JSON upgrade paths, deterministic backup/restore, retired fallback seams, notice boundaries, and post-deploy acceptance. Each section links its runbook and certified machine authority; the document remains explicitly candidate-only and owner-controlled. `npm run check:release-readiness:release-notes` verifies 15 certification traces, required commands/boundaries, identity agreement, credential/IP hygiene, and every local link.
- [x] **P13-069 — Write GM and player release notes** — `DONE`
  - Capability highlights across the complete trusted-table loop, workflow boundaries, and role expectations.
  - Player-safe: no GM-private mechanics leakage in examples.
  - Evidence: `docs/releases/1.0.0.md` adds five traced GM sections and five traced player sections spanning Field Guide, Workshop, Live Encounter, onboarding, settlement/continuation, breeding, Contests, deterministic private preparation, reconnect/revision behavior, and role expectations. The player example uses only an owned active Pokémon and visible target and explicitly excludes hidden targets, unrevealed stat blocks, generation seeds, GM notes, and private rewards. The notes gate rejects all six GM-only projection field families and validates every evidence/runbook link.
- [x] **P13-070 — Freeze the known-limitations section** — `DONE`
  - The P13-009 register rendered into the notes verbatim and owner-accepted.
  - Boundaries and blockers cannot be blurred after freeze.
  - Evidence: the six activation-decision-9 statements are rendered verbatim and in register order under `docs/releases/1.0.0.md#known-limitations-frozen`. `known-limitations.v1.json` now records `OWNER_ACCEPTED_FROZEN`, its owner-acceptance basis, and the exact render target. The notes gate enforces exact row count/text/order and the rule that only these rows may close as `Documented boundary`; all unlisted failures remain blockers.
- [x] **P13-071 — Implement the release command** — `DONE`
  - One reproducible command: clean-tree check, version agreement, bounded gate summary, production build, checksum generation, provenance record, notes-presence check.
  - Fails closed on any missing input; produces the release evidence bundle deterministically.
  - Evidence: `npm run release:prepare` accepts no arguments or bypasses and sequences supported-platform, clean-tree, annotated-tag/identity, bounded aggregate, clean-after-gates, provenance-bound build, checksums, built-artifact audit, deterministic gate summary, five-file bundle manifest, exact evidence recheck, and final clean-tree proof. `release-command-certification.v1.json` binds 12 authorities; `npm run check:release-readiness:release-command` passes, and a dirty-tree invocation exits before gates. End-to-end tagged execution remains the P13-074 rehearsal rather than being falsely claimed here.
- [x] **P13-072 — Audit the built artifact** — `DONE`
  - The `.output` bundle scans clean of secrets, campaign databases, private traces, and documentary-tree runtime dependence.
  - The scan is a registered command bound into the release command.
  - Evidence: the production `.output` snapshot contained 13,629 files (379,044,254 bytes), 24 lock-reviewed runtime package instances, the exact generated third-party notice, zero forbidden paths/secrets/SQLite headers/unreviewed JSON/symlinks/unknown dependencies/packaged documentary files, and zero documentary runtime dependence; 11 bundled files contain only permitted immutable documentary provenance labels. `npm run check:release-readiness:artifact-audit` also proves one clean synthetic bundle and six fail-closed injections (database, credential, documentary file, unknown package, private JSON, browser trace). The dynamic `npm run release:audit-artifact` is mandatory inside `release:prepare`; `built-artifact-audit-certification.v1.json` closes the rubric row.
- [x] **P13-073 — Rehearse the clean-host install** — `DONE`
  - Fresh clone → documented install → production build → start → smoke on the supported shape, using only published documentation.
  - Friction is fixed in docs or tooling; the rehearsal is repeatable.
  - Evidence: a new disposable Debian 12 x86-64 container with systemd 252 as PID 1 cloned the 16,872-path commit from a read-only source-only Git bundle, installed 830 exact-lock packages under inherited `NODE_ENV=production`, found zero high vulnerabilities, passed deployment/typecheck/build, produced 13,629 output files, and passed service-account/systemd restart/loopback health/schema-v56/fail-closed-write/SSE/external-WAL/built-notice/Caddy 401-vs-200/source-clean checks. The one observed friction—a truly fresh image lacked Git while docs gave no exact installation step—was repaired with explicit Debian Git/CA/curl prerequisites, not waived. `clean-host-install-certification.v1.json` binds 17 passing results and `npm run check:release-readiness:clean-host` passes.
- [ ] **P13-074 — Rehearse the full release** — `TODO`
  - The complete release-rehearsal slice at the rc identity: gates, release command, local annotated rc tag, checksums, provenance, upgrade-restore drill, desktop and mobile liveplay smoke.
  - Publication of tags and notes remains owner-controlled.
- [ ] **P13-075 — Record the release-rehearsal certification artifact** — `TODO`
  - Machine-readable rehearsal record binding command outputs, checksums, and evidence hashes.
  - Registered in the drift gate.
- [ ] **P13-076 — Release rehearsal acceptance (slice gate)** — `TODO`
  - The release rehearsal slice passes end to end; all Phase 7 rubric rows `Certified`.
  - Phase 8 may not begin before this gate passes.

### Phase 8 — Final acceptance and the 1.0 transition

- [ ] **P13-077 — Pass bounded full repository validation** — `TODO`
  - `scripts/quality-gate.sh` green at the release baseline under the bounded-worker discipline.
  - Failures are defects through owning authorities; no gate weakening.
- [ ] **P13-078 — Pass desktop production liveplay acceptance** — `TODO`
  - Traced desktop golden journey across the complete trusted-table loop on the production build.
  - Zero critical usability defects; traces retained as evidence.
- [ ] **P13-079 — Pass mobile production liveplay acceptance** — `TODO`
  - Traced mobile (Pixel 7 project) golden journey on the production build.
  - Zero critical usability defects; traces retained as evidence.
- [ ] **P13-080 — Pass the release restore drill** — `TODO`
  - Production-shape backup, restore, restart, and integrity audit at the release candidate.
  - Exact recovery; no manual repair anywhere.
- [ ] **P13-081 — Sweep the zero-unresolved-row gate** — `TODO`
  - Rule-7 aggregate: zero `Blocked`, deferred, definition-missing, visible-with-reason core mechanic, licensing, migration, or critical usability rows across all ledgers, registries, and rubric families.
  - Machine-checked, not asserted.
- [ ] **P13-082 — Compile the 1.0 acceptance dossier** — `TODO`
  - One machine-readable pre-acceptance record binding every certification artifact, evidence hash, gate outcome, and disposition.
  - The dossier is the input to the go/no-go, not a retrospective.
- [ ] **P13-083 — Owner go/no-go review** — `TODO`
  - The owner reviews the dossier, dispositions, notes, boundaries, and the release transaction plan, and records an explicit go or no-go in the decision log.
  - No-go returns to the failing phase; go authorizes exactly one release transaction.
- [ ] **P13-084 — Execute the atomic 1.0 release transaction** — `TODO`
  - One reviewed release commit mints `1.0.0` exactly once, finalizes notes and changelog, generates checksums and the provenance record, transitions `PRODUCT_PHASE` out of `ALPHA`, and records `data/release-readiness/final-acceptance.v1.json`; the commit is annotated-tagged `v1.0.0`.
  - Agreement across version, tag, notes, provenance, phase, and acceptance is proven by the P13-016 gate before the transaction closes.
- [ ] **P13-085 — Verify the released identity** — `TODO`
  - On the supported deployment shape at the tagged commit: reported version, tag, notes, schema version, and build provenance agree; the tag-commit rebuild reproduces the recorded checksums per policy.
  - Divergence reopens the release under rule 9; the tag is never mutated.
- [ ] **P13-086 — Archive the ledger and record the post-1.0 boundary** — `TODO`
  - Archive this ledger to `implementation-plans/done/`, synchronize `plan-order.md` and `AGENTS.md`, and record that 1.x expansion scopes remain intent-only until reviewed into numbered ledgers.
  - The finish line defined in `plan-order.md` is met; no autonomous-continuation obligation survives archival.

## Phase exit gates

### Phase 1 exit
- Baseline adopted and drift-gated; rubric, version-surface inventory, platform matrix, upgrade-input index, distribution and licensing inventories, evidence schemas, and the limitation register exist as reviewed artifacts; P13-001–P13-010 `DONE`.

### Phase 2 exit
- Single-source release identity reports in agreement across package, server, UI, and build provenance at the rc identity, with drift gates and checksum/provenance generation in place; P13-011–P13-020 `DONE`.

### Phase 3 exit
- Every promised upgrade input — v1–v55 heads, exact-byte samples, JSON-era roots — certifies through the release schema with rejection, interruption, contention, budget, and rollback proofs and the operator guide; P13-021–P13-032 `DONE`.

### Phase 4 exit
- Both backup methods, fresh-host restore, restore-then-upgrade, mid-session safety, the aggregate integrity audit, and the 1.0 runbook are certified on the supported shape; P13-033–P13-042 `DONE`.

### Phase 5 exit
- Canonical census recorded; the complete-catalog regression reports zero gaps; documentary-read prohibition, mechanics finality, golden journeys, privacy, and performance sweeps are green; P13-043–P13-052 `DONE`.

### Phase 6 exit
- Repository presentation, docs, screenshots, metadata, tree classifications, ignore audits, and inventories are reviewed with explicit owner dispositions recorded for documentary trees, licensing, and notices — zero `UNRESOLVED` families; P13-053–P13-066 `DONE`.

### Phase 7 exit
- Notes, changelog, and limitations are frozen; the release command, artifact audit, clean-host install, and the full release-rehearsal slice pass at the rc identity; P13-067–P13-076 `DONE`.

### Phase 8 exit
- Full validation, desktop and mobile traced liveplay, the restore drill, the zero-unresolved-row sweep, the dossier, the owner go, the atomic 1.0 transaction, released-identity verification, and archival are complete; P13-077–P13-086 `DONE`.

## Final definition of done

- All 86 tickets are `DONE` and every release-gate rubric row is `Certified`, `Approved`, `Documented boundary` (register-listed only), or `Repaired` — zero `Blocked` rows.
- Every promised campaign upgrade and restore path passes; complete-catalog golden regression is green; distribution contains no private authority; licensing and fan-content notices have explicit reviewed owner dispositions.
- Full repository validation and traced desktop/mobile production liveplay pass at the release candidate.
- Version, tag, notes, checksums, build provenance, `PRODUCT_PHASE`, and the machine-readable `data/release-readiness/final-acceptance.v1.json` agree through one atomic release transaction, verified on the supported deployment shape.
- The ledger is archived, both authoritative indexes are synchronized, and the post-1.0 boundary is recorded.

## Decision log

- **2026-08-26 — Draft converted to numbered ledger.** The registered scope draft was reviewed against repository evidence at commit `84c4659e10bec5f39eea674e6439d24ac978e6ee` and converted. The activation baseline (`data/release-readiness/release-baseline.v1.json`, SHA-256 `096e039949d67c926ec82ac860f22569280937da0aa0e4a4576589267b430d11`, 20 rows) and the ten-question activation decision record above are the activation evidence. Ticket count fixed at 86 across 8 phases. Owner-reserved decisions are structured as explicit tickets (P13-058, P13-062, P13-083) plus the start gate; they fail closed until recorded.
- **2026-08-26 — Owner start gate recorded.** The owner instruction that produced this ledger authorized writing and registering Plan 13, not implementing it. `BLOCKED_BY: OWNER_START_GATE` stands until the owner records an explicit start; the autonomous-continuation rule must not treat this plan as compelling work while the gate stands.
- **2026-08-27 — Owner start gate lifted.** The owner's explicit instruction to complete Plan 13 authorizes implementation. `BLOCKED_BY` is now `NONE`, execution begins at P13-001, and the ledger, plan order, and agent instructions are synchronized.
- **2026-08-27 — Release candidate identity minted.** The reviewed mint authority performed the exactly-once `NONE → 1.0.0-rc.1` transition. Package/lock/shared/server/UI/build surfaces agree; local annotated tag `v1.0.0-rc.1` records the Phase 2 rehearsal candidate at `863b1a0ee7b86a393a23936012b47aa704496fbc`. Publication remains owner-controlled and tag mutation is forbidden.
- **2026-08-27 — Second release candidate stopped fail-closed.** The append-only mint authority performed `1.0.0-rc.1 → 1.0.0-rc.2`; local annotated tag `v1.0.0-rc.2` (tag object `a3960297…`) immutably records commit `611d3d42765942dfa139dc23e10c30defff14635`, while rc.1 remains unmoved. `release:prepare` stopped at its first tag-aware identity command because npm forwarded `--require-tag` through the compound script into Vitest. No aggregate gate, build, checksum, provenance, artifact audit, or evidence bundle was recorded as passed; the tag is retained and not moved.
- **2026-08-27 — Third release candidate minted for the repaired rehearsal.** P13-074 performed the required sequential `1.0.0-rc.2 → 1.0.0-rc.3` mint after changing the release command to invoke `check-identity.mjs --require-tag` directly. Package, lock, notes, changelog, generated inventories, and current gates derive or agree with rc.3. A new local annotated tag will identify the reviewed repair commit; both earlier tags remain immutable and publication remains owner-controlled.
- **2026-08-27 — Phase 6 presentation/classification checkpoint and owner disposition gate.** P13-053–P13-057 completed: repository and documentation entry points are truthful, three privacy-reviewed screenshots are hash-bound, package plus authenticated GitHub metadata now state Nuxt 4/SQLite/private-VPS liveplay, and all 16,864 distribution paths are uniquely classified. The six documentary/provenance candidates are exact path/content-set bound with prune consequences; per rule 10 automation takes no disposition. Execution is blocked at P13-058 by `OWNER_DECISION_P13_058` until the owner chooses `retain-and-label` or `prune` for each candidate.
- **2026-08-27 — P13-058 owner documentary-tree disposition applied.** The owner explicitly accepted the reviewed recommendation: retain-and-label `books/`, `ptu-data/`, `encounter_tables/`, and runtime-required `trainer_sizes/`; prune the unused `pokesheet.pdf` and `notepad/`. Labels state runtime and license boundaries, pre-prune hashes remain recorded, no runtime authority changed, and the P13-058 blocker is lifted.
- **2026-08-27 — P13-059–P13-061 inventory checkpoint and licensing gate.** Registered checks prove zero tracked private/secret artifacts, classify 971 npm instances plus the reviewed Python families, and uniquely bind all 9,472 shipped media files plus 18 runtime font binaries. The inventories surface no mandatory dependency copyleft conflict, but they do surface unknown sprite redistribution rights, 29 unknown-provenance files, 1,460 edited Trainer profiles against an explicit source warning, and an unpinned Python graph. Rule 10 therefore blocks execution at P13-062 under `OWNER_DECISION_P13_062`; automation records facts and takes no legal disposition.
- **2026-08-27 — P13-062 owner licensing/notices disposition implemented.** The owner instructed implementation of recommendations 1–4 and 6–8 and explicitly declined recommendation 5 while accepting its risk. The limited MIT/fan-project/PTU-outside-grant posture is retained; primary sprite families remain with source and artist attribution plus redistribution uncertainty; all 29 unknown-source images are removed and replaced by project-authored Vue/CSS/SVG/canvas work; npm/OFL notices are preserved in the built distribution; the six-package Python helper graph is exact-pinned; and all notices are expanded. The 1,460 edited Trainer profiles remain under a named, content-bound owner-accepted exception that neither automation nor notice language represents as legal clearance. All eight disposition families are approved and the owner gate is lifted.
- **2026-08-27 — Phase 6 distribution and notices accepted.** The supported source-build/systemd/Caddy path was exercised on a clean Linux x86-64 host and four deviations were repaired. The final 16,874-path source manifest binds tree classification, all owner dispositions, zero private/secret exclusion findings, dependency/media inventories, deployment evidence, and nine notice locations. All ten distribution/licensing rubric rows are final with zero `UNRESOLVED` families; the recommendation-5 Trainer-profile exception remains explicit and is not represented as legal clearance.
