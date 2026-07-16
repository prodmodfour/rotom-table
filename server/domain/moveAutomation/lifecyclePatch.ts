import type {
  EncounterLifecyclePatchPayload,
} from '#shared/livePlayCommands'
import type { EncounterState } from '#shared/moveAutomation/encounterState'
import type { EncounterEvent } from '#shared/moveAutomation/events'
import type { TabletopMap } from '~/types/map'
import { deepCloneJson } from '~/utils/serialization'
import type { EncounterLifecycleSheetWrite } from './planInitiativeLifecycle'
import type { EncounterLifecycleReductionResult } from './reduceLifecycle'

export interface EncounterLifecyclePatchProjectionInput {
  readonly events: readonly EncounterEvent[]
  readonly reductions: readonly EncounterLifecycleReductionResult[]
  readonly previousEncounterState: EncounterState
  readonly currentEncounterState: EncounterState
  readonly previousTemporaryHitPoints: TabletopMap['temporaryHitPoints']
  readonly currentTemporaryHitPoints: TabletopMap['temporaryHitPoints']
  readonly previousFieldEffects: NonNullable<TabletopMap['fieldEffects']>
  readonly currentFieldEffects: NonNullable<TabletopMap['fieldEffects']>
  readonly sheetWrites: readonly EncounterLifecycleSheetWrite[]
}

/** Build the bounded map-patch projection shared by initiative and scene boundaries. */
export const encounterLifecyclePatchPayload = (
  input: EncounterLifecyclePatchProjectionInput,
): EncounterLifecyclePatchPayload => ({
  events: input.events.map(event => ({
    eventId: event.eventId,
    kind: event.kind,
    reasonCode: event.reasonCode,
  })),
  effectTransitions: input.reductions.flatMap(reduction => (
    reduction.transitions.map(({ eventId, transition }) => ({
      eventId,
      effectId: transition.effectId,
      kind: transition.kind,
      reasonCode: transition.reasonCode,
    }))
  )),
  fieldTransitions: input.reductions.flatMap(reduction => (
    reduction.fieldTransitions.map(({ eventId, transition }) => ({
      eventId,
      zoneId: transition.zoneId,
      kind: transition.kind,
      reasonCode: transition.reasonCode,
    }))
  )),
  operationIds: input.reductions.flatMap(reduction => (
    reduction.operations.map(operation => operation.id)
  )),
  previousEncounterState: deepCloneJson(input.previousEncounterState),
  currentEncounterState: deepCloneJson(input.currentEncounterState),
  previousTemporaryHitPoints: input.previousTemporaryHitPoints === undefined
    ? null
    : deepCloneJson(input.previousTemporaryHitPoints),
  currentTemporaryHitPoints: input.currentTemporaryHitPoints === undefined
    ? null
    : deepCloneJson(input.currentTemporaryHitPoints),
  previousFieldEffects: deepCloneJson(input.previousFieldEffects),
  currentFieldEffects: deepCloneJson(input.currentFieldEffects),
  sheetChanges: input.sheetWrites.map(write => ({
    kind: write.kind,
    slug: write.slug,
    expectedRevision: write.expectedRevision,
    revision: write.revision,
    placementIds: [...write.placementIds],
    changedFields: [...write.changedFields],
  })),
})
