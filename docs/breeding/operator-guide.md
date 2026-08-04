# Breeding operator guide

## Current rollout state

The breeding source governance and runtime architecture are defined, but the Workshop and durable breeding runtime are not operational until the implementation ledger is complete. Do not represent edits to `eggMoves`, `inheritedMoves`, Gender, Nature, Abilities, `babyTemplate`, inventory, or map metadata as a completed breeding or hatch operation.

The authoritative readiness command is:

```bash
npm run check:breeding-automation-plan
```

A release may claim complete breeding support only when:

```bash
npm run check:breeding-automation-complete
scripts/quality-gate.sh
```

both pass from the current source/build and the plan is archived with all 90 requirements covered.

## Governance health

The non-strict checker verifies:

- all frozen source bytes, SHA-256 values, and Git blobs;
- ruleset and dependent definition-hash links;
- closed source adjudications;
- plan/current-ticket/progress consistency;
- scenario coverage state and dependency gates;
- synthetic fixture privacy and canonical species references;
- required checker and evidence artifacts.

A hash failure is not repaired by editing the expected hash alone. Determine whether the source change is intended, review its semantic impact, create or update the source-bound migration/adjudication, then update every dependent definition and test.

## Source-gap handling

Expected unavailable categories include incomplete species rows, missing Egg Groups or hatch durations, malformed family targets, unknown Ability labels, the unresolved `Facade` Move identity, fossil item identities, Portable Reanimation Machine identity, and the absence of a canonical facility registry.

Operators must not fill these gaps from a website, wiki, PDF, markdown species page, parser output, or client request. Use a reviewed app-owned migration or leave the operation unavailable.

## Runtime operations after rollout

Normal health checks will cover:

- campaign clock revision and last advancement identity;
- projects by lifecycle state and stale consent count;
- Eggs by lifecycle state and source kind;
- pending special adjudications;
- operation collisions, retries, and recoverable uncertain responses;
- parent/source-loss diagnostics that do not mutate accepted Eggs;
- acquisition-history uniqueness and Egg-child link consistency;
- realtime publication lag after committed events.

All diagnostics are aggregate-only or hash/trace-only unless the operator also has GM authority. Do not copy private project or Egg documents into tickets or logs.

## Recovery principles

1. Retry the exact command with the same operation ID and bytes.
2. If the operation exists, return its stored result; do not reroll.
3. If the operation ID has a different command hash, treat it as a collision and investigate.
4. On stale revision, reload the caller's authorized projection before any new command.
5. On reconnect or replay gap, replace local state from an authoritative projection.
6. Never fix a partial-looking hatch by manually creating or linking a child. A valid hatch is atomic; an invalid partial state is a storage incident.
7. Preserve accepted Egg snapshots even when parents are renamed, evolved, traded, or deleted.

## Consent incidents

For a disputed cross-owner project, inspect the consent audit for project ID, parent slug/revision, owner Trainer, consenting profile, scopes, grant/expiry/revocation campaign minutes, operation ID, and command hash. Browser selection, public visibility, or a prior project is not consent.

Revoke only through the authoritative operation. Revocation before Egg acceptance blocks production. Revocation after acceptance does not rewrite the Egg; escalate narrative disputes to the GM while preserving audit evidence.

## Backup and restore

Use only the versioned digest-bearing campaign export. Restore into isolated state first. Validation must reject missing rulesets, duplicate operation IDs with contradictory commands, duplicate Egg-child links, dangling project/Egg/Trainer references, duplicate acquisition keys, and invalid revisions before accepting authority.

After restore, run repository consistency, exact-retry, projection privacy, and checker validation. Do not trigger rerolls or reconstruct lineage from sheet fields.

## Rollback

Rollback disables new Workshop mutations while preserving reads, projects, Eggs, operation receipts, consent, acquisition history, and child links. It never re-enables map metadata or legacy sheet fields as Egg authority. In-flight commands reconcile through stored operation results.

## Escalation evidence

Collect only:

- checker output;
- ruleset/source/provider definition hashes;
- aggregate kind, hashed ID, revision, and lifecycle state;
- operation kind, hashed operation ID, command/result hash match status;
- migration version and invariant failure code;
- bounded timestamps/campaign-clock revisions;
- sanitized stack traces.

Do not collect raw parent sheets, consent profile IDs, trait options, rolls, notes, exports, cookies, tokens, or campaign databases in routine diagnostics.
