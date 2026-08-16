# Action, decision, resolution, and history surfaces

Phase 6 gives `/play/:encounterId` one source-agnostic interaction vocabulary. The browser presents server-issued contracts; it does not parse rule prose, calculate legality, or manufacture target authority.

## Action dock

`EncounterActionDock.vue` consumes only `EncounterActionOffer[]`. It filters by the selected actor and supports labelled action-group tabs, availability, full-text, runtime-recency, `/` search focus, and numeric shortcuts. Recency is bounded and memory-only. A local presentation key keeps the same action recent across map-revision refreshes, but neither that key nor offer IDs are written into presentation preferences or browser storage.

`EncounterOfferCard.vue` uses the same anatomy for Moves, Maneuvers, Abilities, Capabilities, Edges, Features, Orders, Items, Capture, Movement, and system actions:

- source and action group;
- timing;
- projected costs;
- projected usage/cooldown;
- targeting summary;
- projected outcome copy;
- availability state and server-issued reasons.

Unavailable reasons may identify projected sources. Diagnostic details appear only when the server included them in the diagnostic projection. The card never attempts to repair or override an unavailable offer.

The Inventory group contains only stable, reviewed encounter item offers from a controlled Trainer source. Compact cards show server-projected quantity and base cost. Item decisions show a safe source context label, exact action and consumption costs, server-authored outcome/overheal copy, target-specific consequences, and disabled target cards with textual reasons. Raw inventory-row, operation, definition-hash, and read-set identities are never rendered. An unavailable item remains inspectable so its safe offer and option reasons are visible, but it cannot be submitted.

## Generic decisions

`shared/encounterWorkspace/decision.ts` turns a selected action offer into bounded presentation choices and preserves authorized pending choices unchanged. `EncounterDecisionLayer.vue` renders participant, side, mode, branch, type, stat, skill, Move, Ability, Capability, Feature, Edge, Item, cell, area, direction, destination, and path kinds through one component. It enforces only the server-issued cardinality and disabled-option fields.

Participant candidates come only from the already-visible workspace projection. Their presence is not a claim of mechanical eligibility; final source-owned commands re-authorize targets. The browser intentionally does not infer target legality from HP, fainted state, side, distance, or prose. Exact spatial requirements do not receive fabricated options and remain un-submittable until the tactical lens supplies server-aligned geometry.

An action declaration posts `EncounterActionDeclarationIntent` with offer, actor, action, base revision, and stable option identities. `/api/maps/encounter-actions/declarations` verifies the complete offer identity against a fresh role projection. Its response is an authorization receipt, not a mechanics result. Item receipts alone gain a private, revision-bound command template after declaration; that template is structurally absent from workspace projections. The browser binds only its operation identity and selected option identities, derives participant target IDs from the reviewed target requirements, and submits the template to `/api/items/use`. Item mechanics, source identity, read set, dice, costs, and settlement remain server-owned. Pending item choices use the generic resolution stack and `/api/items/resume`; retries reuse durable operation evidence.

Until each remaining legacy source executor is migrated into the cockpit, non-item receipts explicitly direct final source-owned targeting/mechanics to the Battlefield Workshop; no accepted event is invented.

## Ordered resolution stack

`EncounterResolutionStack.vue` orders pending interactions deterministically and marks one primary visual decision. Public rows contain only waiting copy and an outstanding count. GM/responder rows may contain choices, response identity, pass/cancel controls, and explicitly enabled recovery actions. Private options and retry identities are absent—not hidden with CSS—from public and unauthorized owner structures.

Authorized response commands reuse `usePendingMoveResponses.ts`, including its durable command journal, exact-body retries, revision binding, and source-owned response endpoints. Force-pass and cancellation remain GM-authorized server commands. Unsupported generic recovery verbs fail closed rather than being reinterpreted in the browser.

## Accepted history and recovery

`EncounterEventFeed.vue` renders immutable `AcceptedEncounterPresentation` facts in revision/causal order. It shows headline, source, actor, outcomes, structured state changes, corrections, and contribution explanations. `EncounterContributionExplanation.vue` presents projected contribution order, values, prevention reasons, and applied state without recalculating the result.

Accepted motion cues are finite and reduced-motion aware. They never mutate map, sheet, initiative, or resource state.

A network failure after a response has been journaled is displayed as an uncertain command, never as accepted or rejected. Retry reuses the exact operation ID and request body. Abandonment sends that same journaled command to the server abandonment endpoint and removes it locally only after a matching validated terminal receipt. Invalid or mismatched receipts leave the journal intact.

## Verification

- `tests/shared/encounterWorkspaceActions.test.ts` covers filtering, labelled grouping, revision-stable in-memory recency, all canonical source kinds, all choice kinds, cardinality, projected participant identities, disabled target authority, resources, and spatial fail-closed behavior.
- `tests/components/encounterWorkspaceActions.test.ts` covers keyboard activation, search, recents, item source/quantity/cost anatomy, legal and unavailable target cards, typed previews, confirmation, public/private resolution structures, corrections, contribution rows, retry, and abandonment controls.
- `tests/server/encounterPresentationProjection.test.ts`, `tests/server/declareEncounterAction.test.ts`, and `tests/shared/itemAutomationProjection.test.ts` prove role-projected item offers, declaration-only private templates, exact target/cost previews, and client binding without client-owned mechanics.
- `tests/composables/map-editor/usePendingMoveResponses.test.ts` covers exact journaled response retry and validated server-side abandonment.
- `tests/server/encounterWorkspaceProjection.test.ts` exercises the same private decision across GM, authorized responder, unauthorized owner, and public client projections.
- `tests/e2e/encounter-workspace-shell.spec.ts` exercises dock search, action details, numeric selection, participant choice, revision-bound declaration, accessibility, and desktop/mobile visual snapshots on a production build.
