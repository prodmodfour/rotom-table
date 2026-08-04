# Encounter Workspace architecture

The Encounter Workspace is a role-projected, revision-bound view over existing battlefield and mechanics authority plus an optional first-class Encounter Document. It does not replace map, sheet, command, or automation runtimes. It makes their accepted state legible through one bounded interaction model.

## Runtime boundary

`LiveTableSnapshot` remains the compatibility authority. The server performs two steps:

1. `projectMapBackedEncounterWorkspace(...)` applies the GM, player-owner, public, or diagnostic privacy policy to the generic Encounter Presentation projection.
2. `buildMapBackedEncounterWorkspace(...)` combines that projection with revision-aligned map, sheet, turn, side, scene, and environment facts.

The client receives only `EncounterWorkspaceViewModel`. It must not infer hidden participants, authorization, private diagnostics, exact geometry, or response options from CSS or locally loaded campaign data.

The schema is bounded and versioned in `shared/encounterWorkspace/model.ts`. Its source identity binds the workspace, map revision, presentation projection, and generation time. A workspace cannot combine different map slugs or revisions.

## Audience projections

- **GM** receives visible map participants, all projected actions, director authority, and exact geometry. Hidden-count metadata is permitted only when explicitly supplied by the visibility authority.
- **Player owner** receives an explicit visibility set and an explicit controlled subset. Action offers are retained only for controlled actors. Exact geometry is opt-in by policy.
- **Public** receives an explicit visibility set, public pending state, no action offers, no diagnostics, no hidden counts, and no exact positions when geometry is disabled.
- **Diagnostic** is server-gated and structurally separate from ordinary GM output. It may include diagnostics and private contribution evidence.

Accepted events that reference a participant outside the projected visibility set are converted to a generic “Encounter state changed” fact. Participant IDs, labels, changes, VFX cells, history details, and announcements from the private event are discarded.

## First-class Encounter Document boundary

The map-backed slice established which authoring facts have no truthful battlefield or mechanics owner. A schema-v1 Encounter Document now owns encounter identity/lifecycle/recipe, reveal orchestration, presentation-only cast roles, reserves/waves, objectives/clocks/phases, stakes/notes, and encounter presentation defaults. It references one map but does not copy geometry, side definitions, initiative, scene state, sheets, HP, conditions, resources, pending interactions, action legality, or accepted mechanics history.

A workspace requested by encounter ID resolves the document before loading its linked battlefield. Every participant reference is checked against the revision-aligned map and contradictory references fail closed. Map-only workspaces remain an explicit compatibility case and continue to declare their five authoring limitations. See ADR 016.

Documents and replay-safe Director receipts are stored by SQLite migration 19; atomic Builder launch receipts are stored by migration 20. Document updates use compare-and-swap revisions and append durable `encounter:<id>` plus `encounters` events in the same transaction. Those map-access events carry only encounter/map identity, revision, and operation identity—never hidden IDs, story text, private options, sheets, or mechanics payloads. Clients treat them as refresh signals and adopt a new role projection. GM exports are strict digest-bearing schema-v1 document backups served with private/no-store headers.

## Interaction state

The client state is split deliberately:

- `selection.ts` keeps current actor, selected actor, inspected participant, target preview, tactical focus, and DOM focus origin independent.
- `stateMachine.ts` is a pure state machine for `observe → choose → target/wait → resolve/recover`.
- `decisionPriority.ts` elects one visual and focus owner in this order: system recovery, authorized decision, public waiting state, targeting, accepted result, action choice, current actor, idle.
- `acceptedQueue.ts` merges local HTTP, realtime, replay, and snapshot delivery by stable presentation identity. It rejects conflicting duplicates and orders accepted facts by revision and causal coordinates.

Server acceptance, not local animation, advances mechanics. Motion may present accepted state but cannot mutate it.

## Action, decision, and resolution presentation

`actionDock.ts` provides deterministic source-agnostic filtering, grouping, bounded in-memory recency, and presentation labels. `decision.ts` maps only projected action requirements and identities into generic choices, while preserving authorized pending choices verbatim. The browser enforces cardinality and projected disabled state but does not infer mechanical target legality.

The action declaration endpoint re-authorizes offer, actor, action, and base revision. A declaration receipt does not claim mechanics execution. Pending response commands continue through the durable exact-command response journal. Uncertain retries reuse the identical body and operation ID; abandonment clears the journal only after a matching validated server terminal receipt.

The event feed consumes immutable accepted presentation facts and contribution explanations. Correction and motion treatment are presentation-only. See `docs/encounter-workspace/action-decision-resolution.md` for the Phase 6 interaction boundary.

## Progressive spatiality

`spatiality.ts` selects card, relationship, compact tactical, or full tactical presentation from explicit offer/choice requirements. Exact position and footprint are projected together or omitted together. Relationship distance is presentation-only; target eligibility and line of sight remain server-owned.

The full `EncounterTacticalLens` lazily embeds the existing same-origin `/maps/:slug` renderer in a closed revision-bound bridge. This preserves one geometry/movement/VFX/presence implementation. The child re-authorizes a handed-off offer before opening its source workflow, and the cockpit refreshes on child revision drift. Compact, split, picture-in-picture, and full-screen modes are local presentation preferences. See `docs/encounter-workspace/tactical-lens.md`.

## Adoption and recovery

`adoption.ts` defines URL, reload, reconnect, replay-gap, and tab-echo handling.

- Older snapshots are ignored.
- Same-revision exact duplicates settle matching local intents without replacing the workspace.
- Same-revision role/projection changes are adopted without erasing accepted history.
- Newer authority replaces the workspace.
- Replay gaps replace accepted history, clear transient selection and optimistic outbox state, and block commands until reconciliation completes.
- Deep-link participant, decision, history, and tactical identities are adopted only if they occur in the already-authorized projection.

## Preferences

`preferences.ts` persists schema-v1 presentation preferences only: density, type scale, color-vision/contrast modes, motion, panel modes and dimensions, and tactical presentation mode. Parsing is bounded. Malformed, missing, or future-schema data falls back to defaults. Campaign state, sheet state, map facts, options, authorization, command payloads, and automation results are not part of the persisted shape.

Preference changes may alter presentation but never mechanics or projected authorization.

## Routes and compatibility

The map-backed rollout has two explicit boundaries:

- `/play` is the role-filtered Encounter Library, `/play/:encounterId` is the Battle Cockpit, and `/play/:encounterId/tactical` is the canonical full-lens deep link.
- `/maps/:slug` remains the Battlefield Workshop and full compatibility surface; `encounterLens=1` is a same-origin embedded compatibility mode, not a second authority.

`shared/encounterWorkspace/routes.ts` owns path construction and live-play entry policy. Runtime flags are `encounterWorkspaceEnabled`, `encounterWorkspaceDefaultForLivePlay`, and `battlefieldWorkshopEnabled`. The workspace is enabled for explicit access, but it does not become the default live-play entry until staged acceptance. Player library browsing does not require a selected profile; entering `/play/:encounterId` does, matching map control policy.

`GET /api/encounter-workspace/list` returns bounded first-class document summaries plus unclaimed map-compatibility summaries. Document-backed rows expose document identity, recipe, lifecycle, encounter revision, and map revision without duplicating a linked map as a second library item. `GET /api/encounter-workspace/load` resolves role, selected player profile, session access, controlled placements, and audience entirely on the server. The shell exposes navigation, authoritative revision/connection state, turn spine, roster, stage, decision/history rail, and action dock as in-flow landmarks. Region dimensions and collapse modes use presentation preferences only.

## Verification

Focused architecture coverage lives in:

- `tests/server/encounterWorkspaceProjection.test.ts`
- `tests/server/encounterDocumentRepository.test.ts`
- `tests/server/encounterWorkspaceRoutes.test.ts`
- `tests/shared/encounterDocuments.test.ts`
- `tests/shared/encounterWorkspaceArchitecture.test.ts`
- `tests/shared/encounterWorkspaceActions.test.ts`
- `tests/components/encounterWorkspaceActions.test.ts`
- `tests/composables/map-editor/usePendingMoveResponses.test.ts`
- `tests/shared/encounterWorkspaceSpatiality.test.ts`
- `tests/shared/encounterWorkspaceTacticalProtocol.test.ts`
- `tests/components/encounterWorkspaceTactical.test.ts`

These tests cover revision alignment, map adaptation, all four role structures, private-event and private-decision redaction, command blocking, state transitions, focus priority, queue deduplication, snapshot adoption, replay gaps, deep-link authorization, bounded preference persistence, generic action/choice coverage, and exact retry/abandonment recovery.
