# Encounter presentation schema and API reference

Schema version: **1**. Snapshot schema version: **3**.

Authoritative types and parsers live in `shared/encounterPresentation/`; this document is explanatory, not a second schema.

## Snapshot

`GET /api/maps/live-state?slug=<map>&profileId=<optional>` returns `LiveTableSnapshot` with:

```text
schemaVersion: 3
map / mapRevision
interactionMode / interactionModeUpdatedAt
pokemonSheets / trainerSheets
encounterPresentation: EncounterPresentationProjection
```

`encounterPresentation` is required and must match the snapshot map slug and revision. It replaces the source-specific `abilityCapabilities` wire field. Its arrays are:

- `offers`: current role-authorized actions, including unavailable actions with safe reasons;
- `passives`: effective passive/triggered facts and optional contribution explanations;
- `affordances`: inventory, terrain, object, shop, campaign, or encounter context;
- `pending`: public existence or authorized choices/recovery views;
- `accepted`: up to 100 retained accepted presentations recovered from durable realtime rows;
- `diagnostics`: populated only for a diagnostic projection.

Clients reject malformed, mismatched, oversized, or unknown-version projections and reconcile from a new snapshot.

## Generic declaration

`POST /api/maps/encounter-actions/declarations`

```json
{
  "profileId": "profile_optional-for-player",
  "intent": {
    "schemaVersion": 1,
    "intentId": "intent:client-identity",
    "offerId": "offer:server-issued",
    "mapSlug": "arena",
    "baseRevision": 12,
    "actorParticipantId": "placement:actor",
    "actionId": "move.declare",
    "selections": []
  }
}
```

The response is the exact current `EncounterActionOffer`. The server rebuilds the caller's role-specific projection and checks offer, map, revision, actor, action, and availability. The response is an authorization acknowledgment for beginning a source-owned workflow, not permission to mutate state. The final Move/Ability/system command reauthorizes all mechanics and revision state.

Expected failures:

- `400`: malformed/unknown contract input;
- `403`: role/profile cannot access the underlying map/action;
- `404`: offer no longer exists for this caller;
- `409`: stale revision, identity mismatch, or safe unavailable reason.

## Pending responses

An authorized `EncounterPendingInteractionView` carries one `responseIdentity` and one or more `EncounterChoiceOffer`s. The client submits an `EncounterInteractionResponseIntent` locally and adapts its exact `resolutionId`, `windowId`, and option IDs to the owning Move/Ability response endpoint. Public pending views contain only status, safe prompt, count, pass/cancel display flags, expiry, and announcement; they never contain choices or response identity.

Decisions are `choose`, `pass`, `cancel`, or GM-only `force-pass`. Only `choose` carries selections.

## Accepted commands and realtime

`LivePlayCommandAccepted` may omit `presentation` only when replaying a durable pre-contract row. New authoritative command execution always adds it before operation-result persistence and realtime append.

`live-play-command-accepted` includes the same optional compatibility field and strictly requires presentation operation/map/revisions to match its envelope. Native Ability realtime (`ability-resolution-accepted`) carries a map-public generic presentation with a redacted Ability identity. Clients deduplicate on `presentationId`; visual hints may replay at most once while map/sheet state remains patch/snapshot-owned.

On reconnect:

1. durable realtime cursor replay delivers retained rows in sequence;
2. duplicates return the same presentation and are ignored by the presentation runtime;
3. a replay gap requests the aggregate snapshot;
4. snapshot `accepted` history is reconstructed from the latest retained durable rows;
5. corrections link to the corrected presentation and rollback change IDs.

## Core parser exports

- `parseRuleSourceRef`
- `parseEncounterParticipantPresentationRef`
- `parseEncounterActionOffer`
- `parseEncounterPassiveSummary`
- `parseEncounterContextualAffordance`
- `parseEncounterChoiceOffer`
- `parseEncounterPendingInteractionView`
- `parseEncounterActionDeclarationIntent`
- `parseEncounterInteractionResponseIntent`
- `parseEncounterContributionExplanation`
- `parseAcceptedEncounterPresentation`
- `parseEncounterPresentationProjection`
- `projectEncounterPresentation`
- `encounterPresentationStableJson`
- `computeEncounterPresentationSha256`

Parsers exact-check fields, detach/freeze JSON, enforce closed enums and cross-field identity, and fail closed. Optional decorative copy may be null; unknown mechanic-bearing kinds are never ignored.

## Budgets

The canonical values are `ENCOUNTER_PRESENTATION_LIMITS`. Important ceilings include 2,048 offers/passives/changes, 512 options per choice and contribution rows, 256 pending interactions, 4,096 spatial/path cells, 32 JSON depth, 262,144 JSON nodes, 200-character IDs, 160-character labels, and 1,048,576 encoded bytes. The catalog-scale test projects 512 offers within a two-second test budget and the one-MiB transport ceiling.

## Compatibility policy

- Missing generic accepted presentation is tolerated only for rows written before schema rollout.
- Snapshot generic projection is not optional.
- Source-specific Move presentation remains a read adapter for old VFX during migration.
- The old wire-level Ability capability bundle is removed; a local adapter derives its temporary control shape from generic offers/passives.
- Shop checkout is explicitly classified `out-of-encounter`; it has its own multi-document revision contract and is not forced into a map-revision accepted presentation.
