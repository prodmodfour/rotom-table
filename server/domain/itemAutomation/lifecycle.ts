import type {
  MoveCombatStageEffectOperation,
} from '#shared/moveAutomation/effects'
import type { EncounterLifecycleTriggerHandler } from '../moveAutomation/reduceLifecycle'

/**
 * Clear every authoritative Combat Stage and Accuracy stage at encounter end.
 * The operation is lifecycle-event authored (not Move authored), which keeps
 * source-sensitive stage protection such as Guard Spec out of cleanup.
 */
export const createItemCombatStageEncounterLifecycleHandler = (): EncounterLifecycleTriggerHandler => ({
  id: 'handler.item-combat-stage-encounter-cleanup',
  resolve: ({ event }) => {
    if (event.kind !== 'encounter-end') return []
    const operation: MoveCombatStageEffectOperation = {
      id: `item-combat-stage-cleanup.${event.eventId}`,
      kind: 'combat-stage',
      source: { kind: 'lifecycle-event', id: event.eventId },
      recipients: { kind: 'area-targets' },
      phase: 'cleanup',
      reasonCode: 'item.combat-stages.encounter-ended',
      payload: {
        action: 'reset',
        stage: 'all',
        selectedStage: null,
        value: null,
        stageSource: null,
        rounding: null,
      },
    }
    return [{
      effectId: null,
      reasonCode: 'item.combat-stages.encounter-ended',
      operations: [operation],
      emittedEvents: [],
    }]
  },
})

/** @deprecated P8-035 separates scene and encounter boundaries; retain import compatibility only. */
export const createItemCombatStageSceneLifecycleHandler = createItemCombatStageEncounterLifecycleHandler
