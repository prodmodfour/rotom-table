# 1.0 Release Readiness — Draft Scope

`DRAFT_STATUS: REGISTERED_FOR_REVIEW`

`PLAN_ORDER_INTENT: 13`

`NUMBERED_LEDGER_REGISTERED: false`

`ACTIVATED: false`

`EXECUTION_OBLIGATION: false`

`OWNER_START_REQUIRED: true`

`DEPENDS_ON: implementation-plans/done/POKEMON_CONTESTS_PLAN.md, implementation-plans/done/DEFERRED_MECHANICS_CLOSURE_PLAN.md, implementation-plans/done/GM_CAMPAIGN_TOOLKIT_PLAN.md`

`PRODUCT_PHASE_TARGET: 1.0`

## Registration boundary

This document records reviewed scope intent only. It is not a numbered implementation ledger, contains no executable tickets, and does not authorize work. Before implementation, an owner must review the activation questions, convert the accepted scope into a numbered Plan 13 ledger, register that ledger in `implementation-plans/plan-order.md`, and explicitly lift its owner start gate. Until then it imposes no autonomous-continuation obligation.

## Goal

Mint Rotom Table 1.0 from the core-complete trusted-table liveplay product by defining and proving release-boundary guarantees: version identity, supported campaign-database upgrades, backup and restore, distributable and repository presentation, legal and fan-content notices, complete-catalog regression, release notes and tags, and the deliberate transition out of `ALPHA`.

This is a release-readiness and certification plan, not a new gameplay subsystem. It may repair defects exposed by its release matrices through the authorities that own them, but it may not create parallel mechanics, persistence, sheets, launch, realtime, or browser authority.

## Accepted baseline at registration

- Plans 1–12 are complete and archived. Plan 12 closes at 96/96 tickets with all 40 GM Campaign Toolkit footprint rows final: 20 Native, 4 Migrated, 5 Preserved, 10 Retired, and 1 Documentary.
- The campaign SQLite authority is at schema version 56 with contiguous migrations, transaction-safe operations, audited online backup/restore behavior, and production liveplay acceptance.
- The product remains `ALPHA`; no 1.0 version, release tag, release notes, or release-boundary support promise has yet been minted.
- Runtime PTU authority remains the fourteen app-owned `data/reference/*.json` files plus `shared/ruleset/natures.ts#PTU_NATURE_CHART`. Books, PDFs, parser trees, websites, wikis, and legacy campaign files remain documentary or provenance material only.
- Public authentication, multi-tenancy, federation, and public-service hardening remain outside the trusted-table product thesis.

## Scope commitments

1. **Versioning and release identity.** Define one reviewed version policy, identify every user-visible and machine-readable version surface, set the 1.0 version exactly once, and prove build/runtime/reporting agreement.
2. **Campaign upgrade guarantee.** Declare the supported pre-1.0 campaign-database inputs, exercise every promised upgrade path through schema v56 or its reviewed release successor, reject unsupported/corrupt inputs without partial writes, and document rollback boundaries.
3. **Release-boundary backup and restore.** Certify SQLite/WAL-safe backup, restore, restart, integrity audit, and exact recovery on the supported deployment shape with no direct JSON or database repair requirement.
4. **Canonical and full-catalog regression.** Bind the complete canonical catalogs and all final mechanics registries to deterministic golden journeys, migration checks, privacy checks, and zero-gap proofs without reading documentary sources at runtime.
5. **Distribution and repository presentation.** Review install/start/upgrade documentation, repository landing material, support boundaries, screenshots, package metadata, ignored/private artifacts, and production deployment instructions for one coherent trusted-table release.
6. **License and fan-content notices.** Inventory shipped code, assets, fonts, data, and acknowledgements; obtain an explicit reviewed disposition for licensing and fan-content notices; fail the release gate on any unresolved item.
7. **Release notes and changelog.** Produce operator- and GM-readable upgrade notes covering storage, backup, retired seams, compatibility boundaries, known limitations, and recovery procedures.
8. **Build provenance and release artifacts.** Define reproducible release commands, artifact checksums, tag conventions, and a source-to-build evidence record. Secrets, campaign data, local databases, traces, and private UI artifacts must never enter distributable artifacts.
9. **Production acceptance.** Run bounded full-repository validation plus traced desktop/mobile production-liveplay golden journeys spanning onboarding, campaign play, encounters, settlement, breeding, contests, GM preparation, restart, and restore.
10. **Phase transition.** Change `PRODUCT_PHASE` out of `ALPHA` only in the final atomic acceptance step after every release gate passes; record the 1.0 acceptance machine-readably and archive the numbered ledger.

## Explicit non-goals

- New core mechanics, content packs, setting packs, supplements, or playtest material.
- Reinterpreting canonical PTU facts from books, markdown, PDFs, parser output, websites, or wikis.
- Public authentication, multi-tenancy, federation, matchmaking, or public-service hardening.
- Replacing SQLite, ordinary sheets, maps, Encounter Documents, liveplay commands, settlement, campaign attention, or domain realtime.
- A desktop installer, hosted SaaS offering, mobile-native application, or app-store distribution unless separately reviewed into the numbered ledger.
- Claiming legal approval through automation; notice and licensing dispositions require explicit owner review.

## Non-negotiable release rules

1. A release promise must be executable evidence, not prose alone.
2. Upgrade and restore tests operate on copies and commit atomically or not at all.
3. No release command may access documentary PTU sources at runtime or package private campaign material.
4. Frozen prior-plan evidence changes only through a contiguous reviewed successor chain.
5. Full-catalog regression may reveal defects but may not silently change canonical identities or mechanics.
6. Product-phase, version, tag, notes, and machine-readable acceptance must agree.
7. Zero unresolved `Blocked`, deferred, definition-missing, visible-with-reason core mechanic, licensing, migration, or critical usability row may pass 1.0 acceptance.
8. Local hosting remains deprecated; supported workflows must pass production-build liveplay.

## Activation questions for numbered-ledger conversion

1. What exact semantic version, package/runtime version surfaces, tag convention, and release branch policy will 1.0 use?
2. Which historical campaign schema versions are promised upgrade inputs, and what fixtures represent each supported boundary?
3. Does the release migrate beyond schema v56, and if so, what rollback and restored-backup guarantees apply?
4. Which operating system, Node version, browser projects, deployment topology, and database backup method form the supported 1.0 matrix?
5. What complete-catalog golden cohorts and end-to-end campaigns prove the full app-owned canonical scope without making the matrix unbounded?
6. Which repository files, generated artifacts, local UI evidence, campaign databases, and deployment secrets are included or excluded from distribution?
7. What exact license, third-party attribution, font, asset, and fan-content notice dispositions require owner approval?
8. What constitutes reproducible build provenance and which checksums/signatures are mandatory versus optional?
9. Which known limitations are acceptable for 1.0, and how are non-core or explicitly post-1.0 boundaries distinguished from release blockers?
10. What ticket count, phase structure, owner start gate, acceptance artifacts, and final phase-transition transaction will govern the numbered ledger?

No activation question may be silently resolved by implementation. Ambiguous support, licensing, canonical, migration, or distribution authority fails closed during conversion.

## Required evidence families

- Version-surface inventory and immutable release rubric.
- Supported-upgrade fixture index, fresh-install matrix, interrupted-upgrade matrix, and rollback proof.
- Backup/restore/restart certification with integrity and privacy audits.
- Full-catalog deterministic regression and zero-gap source-bound report.
- Distribution manifest, private-file exclusion audit, dependency/asset attribution inventory, and reviewed notice disposition.
- Release-note, operator-guide, GM-guide, and repository-presentation acceptance.
- Desktop/mobile production-liveplay traces across the complete trusted-table journey.
- Full quality-gate result, artifact checksums, release tag evidence, phase-transition record, and machine-readable final acceptance.

## Draft definition of done

A future numbered Plan 13 may close only when all accepted tickets and release rows are final, every promised database upgrade and restore path passes, complete-catalog golden regression is green, distribution contains no private authority, licensing and fan-content notices have explicit reviewed dispositions, full validation and production liveplay pass, version/tag/notes/build provenance agree, `PRODUCT_PHASE` transitions deliberately, 1.0 acceptance is recorded machine-readably, and the ledger is archived.

## Registration record

- **2026-08-26 — Scope registered by Plan 12 closure.** The Plan 12 final ticket registered this draft against the authoritative 1.0 release definition. Registration does not activate Plan 13, does not create a numbered ledger, and does not authorize implementation.
