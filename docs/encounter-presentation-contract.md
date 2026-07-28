# Encounter presentation contract contributor guide

The encounter presentation contract is the required client seam for automated live-play sources. Start with [ADR 012](adrs/012-server-authoritative-encounter-presentation-contract.md) and the shared exports in `shared/encounterPresentation/`.

## Adding or changing a source

1. **Classify it** in `data/encounter-presentation/action-source-inventory.json` using a closed `sourceKind` and one or more interaction roles. Run `npm run generate:encounter-presentation-inventory` only for command inventory changes and review the JSON diff.
2. **Keep mechanics source-owned.** Eligibility, targets, costs, rolls, effects, and persistence remain in the Move/Ability/system runtime. A presentation adapter reads accepted mechanics; it never plans mechanics.
3. **Project the role correctly.** Add or update an adapter in `server/domain/encounterPresentation/`. Build from already-authorized maps/sheets and explicit policy inputs. Never inspect hidden sheet prose after projection.
4. **Use stable identities.** Generate bounded IDs with `encounterPresentationStableId`. Offers include map revision, actor, source, action descriptor, timing, cost, targeting summary, usage, and safe availability.
5. **Model choices, not forms.** Use a closed `EncounterChoiceKind`, server-issued option IDs, cardinality, ordering, defaults, confirmation, pass/cancel/expiry, and exact `responseIdentity`. Public views contain no options.
6. **Explain unavailability safely.** Choose a catalog code with `encounterAvailabilityReason`; do not invent labels. Diagnostic detail is diagnostic-only.
7. **Emit accepted facts.** Adapt the committed result to outcomes, typed changes, optional contribution explanations, causal order, headline/splash, VFX hints, announcements, history, and corrections. Do not parse combat-log prose.
8. **Wire durable replay.** The presentation belongs in the terminal operation result and durable realtime row. Duplicate reads return the original presentation. Snapshot history is reconstructed from retained rows.
9. **Provide all test layers.** Add strict parser/privacy tests, adapter/use-case tests, a Nuxt component test where Nuxt context matters, and browser/axe coverage for a new interaction primitive.
10. **Update governance.** Run the checker and update API/manual-QA docs if visibility, recovery, or operator behavior changes.

## Role selection

| Rule behavior | Role |
| --- | --- |
| effective always-on value | `passive-provider` |
| intentional declaration | `activated-action` |
| exists only in inventory/terrain/object context | `contextual-affordance` |
| accepted checkpoint applies without a response | `triggered-automatic` |
| authorized user may accept/pass | `triggered-optional` |
| time-sensitive competing response | `interrupt-reaction` |
| modifies another action through a choice | `choice-only` |
| requires cell/area/path/direction/destination | `spatial-choice` |
| non-encounter workshop/training operation | `campaign-operation` |
| traces/hashes/recovery evidence | `diagnostic-only` |

Passives do not become buttons. A source may have several roles.

## Privacy checklist

- Is each participant already visible to this role?
- Are offers limited to controlled actors, except GM/diagnostic views?
- Can a public prompt reveal a hidden Ability, item, owner, target, or option?
- Are `private: true` contribution rows removed and replaced by at most a generic explanation row?
- Is `diagnosticDetail` null outside diagnostic projection?
- Are GM recovery actions absent from owner/public views?
- Does accepted realtime reveal only map-public source identity?
- Do browser assertions inspect serialized output and visible text for forbidden IDs/content?

## Choice and retry checklist

- IDs identify the exact interaction, resolution, window, retry, choice, and options.
- `minimum <= maximum <= available option count`.
- Defaults are unique selectable options within cardinality.
- `choose` has selections; pass/cancel/force-pass have none.
- Disabled options carry exactly one safe unavailable reason.
- Spatial previews are descriptive; the server recomputes geometry.
- Duplicate submission and reconnect return the same terminal result and do not reroll or respent.

## Accepted-fact checklist

- `previousRevision < revision` and identity matches the operation/realtime envelope.
- Every participant referenced by outcomes, changes, VFX, or history exists in actor/affected participants.
- Prevention/immunity names a safe source; hidden evidence is projected as “Private rule”.
- Correction rollback IDs reference changes in the same correction presentation.
- Visual hints include a text label and `reducedMotionKind`.
- Announcements have an explicit priority and dedupe key.
- Collections and encoded payload remain under `ENCOUNTER_PRESENTATION_LIMITS`.

## Commands

```bash
npm run check:encounter-presentation
npm run lint
npm run typecheck
npx vitest run tests/shared/encounterPresentationContracts.test.ts \
  tests/server/encounterPresentationProjection.test.ts
npm run test:nuxt
npm run test:e2e
```

The full release gate is `bash scripts/quality-gate.sh`.
