# Progressive spatiality and the tactical lens

Phase 7 makes the isometric battlefield an on-demand encounter lens instead of a permanent prerequisite.

## Progressive spatiality

`shared/encounterWorkspace/spatiality.ts` selects presentation from authoritative contract fields:

| Contract requirement | Default presentation |
| --- | --- |
| no target, self, item, mode, or non-spatial choice | action/decision card |
| participant or side without exact geometry | relationship view |
| a choice with explicit server-issued spatial previews | compact tactical preview |
| `requiresSpatialInput`, an `input: spatial` offer, or a spatial choice without explicit options | full tactical lens |

The resolver chooses UI only. It does not authorize a participant, infer line of sight, interpret range prose, or execute a command.

## Relationship view

`EncounterRelationshipView.vue` uses only role-projected participants, sides, environment, positions, and token footprints. `EncounterWorkspaceParticipant.footprint` is present only when `canUseExactGeometry` is true and is structurally null with position for public/non-spatial projections.

Displayed PTU grid distance accounts for token base and clearance and uses alternating diagonal distance. Ally/foe is presentation derived from projected side identity. Every candidate remains labelled “Server validates”: the browser does not infer eligibility from side, distance, fainted state, HP, conditions, or text. Line of sight is shown as server validation whenever the offer requires it.

Selecting a relationship row updates transient target preview and supplies the same opaque participant ID as the decision layer. The decision layer retains final confirmation and server-issued cardinality.

## Compact previews

`EncounterCompactSpatialPreview.vue` renders cells, areas, directions, destinations, and paths only from `EncounterChoiceOption.preview.kind === 'spatial'`. It never parses coordinates from option IDs. Preview extraction is bounded to 64 server options. Choosing a preview emits only its opaque option identity.

A spatial choice with no explicit preview cannot be confirmed in the card layer and offers the full tactical lens instead.

## Embedded compatibility renderer

`EncounterTacticalLens.vue` lazily mounts one same-origin iframe of `/maps/:slug?encounterLens=1`. This deliberately reuses the established map page and its isometric renderer rather than creating a second geometry, movement, targeting, VFX, presence, ping, hazard, field, or recovery implementation.

Embedded map mode:

- removes the Workshop navigation rail and duplicate generic presentation panel;
- retains the map renderer, exact targeting overlays, context workflows, movement, VFX, presence, pings, pending-response overlays, hazards, fields, and durable recovery;
- accepts only a closed, revision-bound handoff message;
- re-authorizes the handed-off action offer through the existing declaration bridge before opening its source-owned workflow;
- returns visible token selection and authoritative revision changes to the cockpit;
- causes the cockpit to refresh whenever the embedded map advances beyond its adopted revision.

`shared/encounterWorkspace/tacticalProtocol.ts` bounds and strictly parses this bridge. The parent also verifies `event.origin` and `event.source`; the child does the same. The protocol carries map/revision, selected visible IDs, and an offer ID only. It carries no sheet, mechanics program, command payload, private option, or authority token.

## Layout and navigation

The lens supports compact embedded, split, picture-in-picture, and full-screen presentation modes. These are presentation preferences only. `/play/:encounterId/tactical` redirects to the canonical cockpit deep link with `tactical=1` and `lens=full-screen`; back/return restores the stage without changing mechanics.

Selection and target identities are reconciled against the current workspace projection before handoff. The child rejects mismatched map revisions. Returning to stage attempts to restore the action’s recorded focus origin.

## Performance and reduced motion

The renderer is not mounted until the lens opens and is destroyed when it closes, limiting the cockpit to one additional renderer. Readiness is measured from open until the embedded map reports its authoritative revision and renderer page as ready. The current startup budget is 5 seconds in production-like acceptance.

The existing isometric invalidation scheduler, hidden-tab suspension, frame timing sampler, render-loop tests, smart terrain cutaway, and resource disposal remain authoritative. Reduced-motion media settings apply inside the same-origin child as well as the cockpit. The lens toolbar and compact previews do not require animation or hover.

## Verification

- `tests/shared/encounterWorkspaceSpatiality.test.ts` covers progressive selection, footprint distance, server-owned eligibility, explicit spatial extraction, and startup budgets.
- `tests/shared/encounterWorkspaceTacticalProtocol.test.ts` covers strict bounded bridge payloads and rejects mechanics/unknown fields.
- `tests/components/encounterWorkspaceTactical.test.ts` covers relationship selection, path/destination previews, lazy mounting, modes, and return controls.
- `tests/server/encounterWorkspaceProjection.test.ts` checks exact footprint removal with position in public projections.
- `tests/e2e/encounter-workspace-shell.spec.ts` opens the real production-build Three.js renderer on desktop and mobile, verifies its canvas, mode changes, deep route, return flow, reduced motion, accessibility, and reviewed layout snapshots.
- Existing `tests/utils/isometric/{renderScheduler,renderLoop,frameTimingSampler}.test.ts` retain lower-level renderer scheduling and timing regression coverage.
